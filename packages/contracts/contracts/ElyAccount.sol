// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IElyiaRouter} from "./interfaces/IElyiaRouter.sol";
import {IMorphoLike} from "./interfaces/IExternal.sol";

/// @title ElyAccount
/// @author Elyia
/// @notice Ely's bounded agent account. A minimal smart account owned by one user. The owner can do
///         anything and withdraw at any time. The owner may grant one AGENT key (the opt-in Ely keeper)
///         a policy: allowlisted (target, action) pairs, per-token per-transaction and daily caps, an
///         allowed-token set and an expiry. Agent actions are typed (swap via ElyiaRouter, ERC-4626
///         deposit/redeem, Morpho-style supply/withdraw); every output is forced back into this account.
/// @dev The agent can never: transfer or approve tokens, call arbitrary targets, change the policy,
///      sign ERC-1271 messages, or withdraw. Revocation bumps `policyEpoch`, which voids every
///      permission and cap at once. Deployed as EIP-1167 clones by ElyAccountFactory. NOT AUDITED.
contract ElyAccount is EIP712, ReentrancyGuard, IERC1271 {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------------------------------------
    // Constants
    // ---------------------------------------------------------------------------------------------

    address internal constant NATIVE = address(0);

    /// @notice Action selectors an agent policy may allowlist on a target.
    bytes4 public constant ACTION_ROUTER_SWAP = IElyiaRouter.swap.selector;
    bytes4 public constant ACTION_VAULT_DEPOSIT = IERC4626.deposit.selector;
    bytes4 public constant ACTION_VAULT_REDEEM = IERC4626.redeem.selector;
    bytes4 public constant ACTION_LEND_SUPPLY = IMorphoLike.supply.selector;
    bytes4 public constant ACTION_LEND_WITHDRAW = IMorphoLike.withdraw.selector;

    /// @notice Replay-safe ERC-1271 wrapper: the owner signs `ElyAccountMessage(hash)` in this
    ///         account's EIP-712 domain, so a signature for one account never validates on another.
    bytes32 public constant MESSAGE_TYPEHASH = keccak256("ElyAccountMessage(bytes32 hash)");

    /// @notice The factory allowed to initialize clones.
    address public immutable factory;

    // ---------------------------------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------------------------------

    /// @notice The account owner. Fixed at creation.
    address public owner;
    /// @notice Current agent key, `address(0)` when none.
    address public agent;
    /// @notice Agent powers end after this unix time.
    uint64 public agentValidUntil;
    /// @notice Bumped on every policy change or revocation; old permissions live under old epochs.
    uint64 public policyEpoch;
    bool private _initialized;

    struct TokenRule {
        address token; // address(0) = native HYPE
        uint128 perTxCap; // max the agent may spend in one action (0 = receive-only)
        uint128 dailyCap; // max the agent may spend per UTC day
    }

    struct CallRule {
        address target;
        bytes4 action; // one of the ACTION_* selectors
    }

    struct Limit {
        bool allowed;
        uint128 perTxCap;
        uint128 dailyCap;
    }

    struct Spend {
        uint64 day;
        uint192 amount;
    }

    mapping(uint64 epoch => mapping(address target => mapping(bytes4 action => bool))) internal _callAllowed;
    mapping(uint64 epoch => mapping(address token => Limit)) internal _limit;
    mapping(uint64 epoch => mapping(address token => Spend)) internal _spent;
    /// @dev Morpho-style markets are permissionless; lending is pinned to owner-approved market ids.
    mapping(uint64 epoch => mapping(bytes32 marketId => bool)) internal _marketAllowed;

    // ---------------------------------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------------------------------

    event Initialized(address indexed owner);
    event Executed(address indexed target, uint256 value, bytes4 selector);
    event Withdrawn(address indexed token, address indexed to, uint256 amount);
    event AgentPolicySet(address indexed agent, uint64 validUntil, uint64 indexed epoch);
    event AgentCallAllowed(uint64 indexed epoch, address indexed target, bytes4 action);
    event AgentTokenRule(uint64 indexed epoch, address indexed token, uint128 perTxCap, uint128 dailyCap);
    event AgentMarketAllowed(uint64 indexed epoch, bytes32 indexed marketId);
    event AgentRevoked(address indexed agent, uint64 indexed epoch);
    /// @notice Audit log of every agent action.
    event AgentAction(
        address indexed agent,
        bytes4 indexed action,
        address indexed target,
        address tokenIn,
        uint256 amountIn,
        address tokenOut,
        uint256 amountOut
    );

    // ---------------------------------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------------------------------

    error NotOwner();
    error NotAgent();
    error AlreadyInitialized();
    error NotFactory();
    error ZeroAddress();
    error BadPolicy();
    error CallNotAllowed(address target, bytes4 action);
    error TokenNotAllowed(address token);
    error PerTxCapExceeded(address token, uint256 amount, uint256 cap);
    error DailyCapExceeded(address token, uint256 spent, uint256 cap);
    error BadRecipient();
    error IntegratorFeeNotAllowed();
    error InsufficientOutput(uint256 amountOut, uint256 minAmountOut);
    error OverSpent(address token, uint256 spent, uint256 allowed);
    error NativeTransferFailed();
    error LengthMismatch();
    error MarketNotAllowed(bytes32 marketId);

    // ---------------------------------------------------------------------------------------------
    // Construction (implementation) and initialization (clones)
    // ---------------------------------------------------------------------------------------------

    constructor(address factory_) EIP712("ElyAccount", "1") {
        factory = factory_;
        // Lock the implementation itself.
        _initialized = true;
    }

    /// @notice Called once by the factory in the same transaction that creates the clone.
    function initialize(address owner_) external {
        if (msg.sender != factory) revert NotFactory();
        if (_initialized) revert AlreadyInitialized();
        if (owner_ == address(0)) revert ZeroAddress();
        _initialized = true;
        owner = owner_;
        emit Initialized(owner_);
    }

    receive() external payable {}

    // ---------------------------------------------------------------------------------------------
    // Modifiers
    // ---------------------------------------------------------------------------------------------

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyAgent() {
        if (msg.sender != agent || msg.sender == address(0) || block.timestamp > agentValidUntil) revert NotAgent();
        _;
    }

    // ---------------------------------------------------------------------------------------------
    // Owner powers
    // ---------------------------------------------------------------------------------------------

    /// @notice Arbitrary call by the owner.
    function execute(address target, uint256 value, bytes calldata data)
        external
        payable
        onlyOwner
        nonReentrant
        returns (bytes memory result)
    {
        result = _call(target, value, data);
    }

    /// @notice Arbitrary batch of calls by the owner.
    function executeBatch(address[] calldata targets, uint256[] calldata values, bytes[] calldata data)
        external
        payable
        onlyOwner
        nonReentrant
    {
        if (targets.length != values.length || targets.length != data.length) revert LengthMismatch();
        for (uint256 i; i < targets.length; ++i) {
            _call(targets[i], values[i], data[i]);
        }
    }

    /// @notice Withdraw `amount` of `token` (address(0) = HYPE) to the owner. Always available.
    function withdraw(address token, uint256 amount) external onlyOwner nonReentrant {
        _sendToOwner(token, amount);
    }

    /// @notice Withdraw the whole balance of each token to the owner.
    function withdrawAll(address[] calldata tokens) external onlyOwner nonReentrant {
        for (uint256 i; i < tokens.length; ++i) {
            address t = tokens[i];
            uint256 bal = t == NATIVE ? address(this).balance : IERC20(t).balanceOf(address(this));
            if (bal != 0) _sendToOwner(t, bal);
        }
    }

    /// @notice Replace the agent policy. Voids every previous permission, cap and spend counter.
    /// @param agent_ The agent key.
    /// @param validUntil Expiry (unix seconds), must be in the future.
    /// @param calls Allowlisted (target, action) pairs.
    /// @param tokens Allowed tokens with caps; a token the agent may receive but not spend has caps 0.
    /// @param markets Morpho-style market ids (keccak256(abi.encode(MarketParams))) the agent may lend to.
    function setAgentPolicy(
        address agent_,
        uint64 validUntil,
        CallRule[] calldata calls,
        TokenRule[] calldata tokens,
        bytes32[] calldata markets
    )
        external
        onlyOwner
        nonReentrant
    {
        if (agent_ == address(0) || agent_ == address(this) || agent_ == owner) revert BadPolicy();
        if (validUntil <= block.timestamp) revert BadPolicy();
        uint64 epoch = ++policyEpoch;
        agent = agent_;
        agentValidUntil = validUntil;
        emit AgentPolicySet(agent_, validUntil, epoch);

        for (uint256 i; i < calls.length; ++i) {
            CallRule calldata c = calls[i];
            if (c.target == address(0) || c.target == address(this) || c.target.code.length == 0) revert BadPolicy();
            if (!_isAction(c.action)) revert BadPolicy();
            _callAllowed[epoch][c.target][c.action] = true;
            emit AgentCallAllowed(epoch, c.target, c.action);
        }
        for (uint256 i; i < tokens.length; ++i) {
            TokenRule calldata t = tokens[i];
            if (t.perTxCap > t.dailyCap) revert BadPolicy();
            _limit[epoch][t.token] = Limit({allowed: true, perTxCap: t.perTxCap, dailyCap: t.dailyCap});
            emit AgentTokenRule(epoch, t.token, t.perTxCap, t.dailyCap);
        }
        for (uint256 i; i < markets.length; ++i) {
            _marketAllowed[epoch][markets[i]] = true;
            emit AgentMarketAllowed(epoch, markets[i]);
        }
    }

    /// @notice Instantly revoke the agent and every permission.
    function revokeAgent() external onlyOwner {
        address old = agent;
        uint64 epoch = ++policyEpoch;
        agent = address(0);
        agentValidUntil = 0;
        emit AgentRevoked(old, epoch);
    }

    // ---------------------------------------------------------------------------------------------
    // Agent powers (bounded)
    // ---------------------------------------------------------------------------------------------

    /// @notice Swap through an allowlisted ElyiaRouter. Recipient must be this account; no integrator fee.
    function agentSwap(address router, IElyiaRouter.SwapParams calldata params)
        external
        onlyAgent
        nonReentrant
        returns (uint256 amountOut)
    {
        _requireCall(router, ACTION_ROUTER_SWAP);
        if (params.recipient != address(this)) revert BadRecipient();
        if (params.integrator != address(0) || params.integratorFeeBps != 0) revert IntegratorFeeNotAllowed();
        _requireAllowedToken(params.tokenOut);
        _spend(params.tokenIn, params.amountIn);

        uint256 inBefore = _balance(params.tokenIn);
        uint256 outBefore = _balance(params.tokenOut);
        if (params.tokenIn == NATIVE) {
            IElyiaRouter(router).swap{value: params.amountIn}(params);
        } else {
            IERC20(params.tokenIn).forceApprove(router, params.amountIn);
            IElyiaRouter(router).swap(params);
            IERC20(params.tokenIn).forceApprove(router, 0);
        }
        amountOut = _checkFlows(params.tokenIn, inBefore, params.amountIn, params.tokenOut, outBefore, params.minAmountOut);
        emit AgentAction(
            msg.sender, ACTION_ROUTER_SWAP, router, params.tokenIn, params.amountIn, params.tokenOut, amountOut
        );
    }

    /// @notice Deposit into an allowlisted ERC-4626 vault; shares go to this account.
    function agentVaultDeposit(address vault, uint256 assets, uint256 minShares)
        external
        onlyAgent
        nonReentrant
        returns (uint256 shares)
    {
        _requireCall(vault, ACTION_VAULT_DEPOSIT);
        address asset = IERC4626(vault).asset();
        _requireAllowedToken(vault);
        _spend(asset, assets);

        uint256 inBefore = _balance(asset);
        uint256 outBefore = _balance(vault);
        IERC20(asset).forceApprove(vault, assets);
        IERC4626(vault).deposit(assets, address(this));
        IERC20(asset).forceApprove(vault, 0);
        shares = _checkFlows(asset, inBefore, assets, vault, outBefore, minShares);
        emit AgentAction(msg.sender, ACTION_VAULT_DEPOSIT, vault, asset, assets, vault, shares);
    }

    /// @notice Redeem shares of an allowlisted ERC-4626 vault; assets come back to this account.
    function agentVaultRedeem(address vault, uint256 shares, uint256 minAssets)
        external
        onlyAgent
        nonReentrant
        returns (uint256 assets)
    {
        _requireCall(vault, ACTION_VAULT_REDEEM);
        address asset = IERC4626(vault).asset();
        _requireAllowedToken(asset);
        _spend(vault, shares);

        uint256 inBefore = _balance(vault);
        uint256 outBefore = _balance(asset);
        IERC4626(vault).redeem(shares, address(this), address(this));
        assets = _checkFlows(vault, inBefore, shares, asset, outBefore, minAssets);
        emit AgentAction(msg.sender, ACTION_VAULT_REDEEM, vault, vault, shares, asset, assets);
    }

    /// @notice Supply the loan token to an allowlisted Morpho-style market on behalf of this account.
    function agentLendSupply(address morpho, IMorphoLike.MarketParams calldata market, uint256 assets)
        external
        onlyAgent
        nonReentrant
        returns (uint256 supplied)
    {
        _requireCall(morpho, ACTION_LEND_SUPPLY);
        _requireMarket(market);
        _spend(market.loanToken, assets);
        uint256 before = _balance(market.loanToken);
        IERC20(market.loanToken).forceApprove(morpho, assets);
        IMorphoLike(morpho).supply(market, assets, 0, address(this), "");
        IERC20(market.loanToken).forceApprove(morpho, 0);
        supplied = before - _balance(market.loanToken);
        if (supplied > assets) revert OverSpent(market.loanToken, supplied, assets);
        emit AgentAction(msg.sender, ACTION_LEND_SUPPLY, morpho, market.loanToken, supplied, address(0), 0);
    }

    /// @notice Withdraw from an allowlisted Morpho-style market; assets always return to this account.
    function agentLendWithdraw(address morpho, IMorphoLike.MarketParams calldata market, uint256 assets, uint256 shares)
        external
        onlyAgent
        nonReentrant
        returns (uint256 withdrawn)
    {
        _requireCall(morpho, ACTION_LEND_WITHDRAW);
        _requireMarket(market);
        _requireAllowedToken(market.loanToken);
        uint256 before = _balance(market.loanToken);
        IMorphoLike(morpho).withdraw(market, assets, shares, address(this), address(this));
        withdrawn = _balance(market.loanToken) - before;
        if (withdrawn == 0) revert InsufficientOutput(0, 1);
        emit AgentAction(msg.sender, ACTION_LEND_WITHDRAW, morpho, address(0), 0, market.loanToken, withdrawn);
    }

    // ---------------------------------------------------------------------------------------------
    // ERC-1271 (owner only, replay-safe)
    // ---------------------------------------------------------------------------------------------

    /// @notice EIP-712 digest the owner signs to approve `hash` for this account.
    function replaySafeHash(bytes32 hash) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(MESSAGE_TYPEHASH, hash)));
    }

    /// @inheritdoc IERC1271
    /// @dev Only the owner's signature over `replaySafeHash(hash)` is valid. The agent can never sign.
    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4) {
        address o = owner;
        if (o != address(0) && SignatureChecker.isValidSignatureNow(o, replaySafeHash(hash), signature)) {
            return IERC1271.isValidSignature.selector;
        }
        return 0xffffffff;
    }

    // ---------------------------------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------------------------------

    /// @notice True when the current agent may call `action` on `target`.
    function isCallAllowed(address target, bytes4 action) external view returns (bool) {
        return _callAllowed[policyEpoch][target][action];
    }

    /// @notice Current rule for `token` and how much the agent already spent today.
    function tokenRule(address token)
        external
        view
        returns (bool allowed, uint128 perTxCap, uint128 dailyCap, uint256 spentToday)
    {
        uint64 epoch = policyEpoch;
        Limit memory lim = _limit[epoch][token];
        Spend memory s = _spent[epoch][token];
        spentToday = s.day == uint64(block.timestamp / 1 days) ? s.amount : 0;
        return (lim.allowed, lim.perTxCap, lim.dailyCap, spentToday);
    }

    /// @notice True when the current agent may lend to `marketId`.
    function isMarketAllowed(bytes32 marketId) external view returns (bool) {
        return _marketAllowed[policyEpoch][marketId];
    }

    /// @notice True when an agent is set and not expired.
    function agentActive() external view returns (bool) {
        return agent != address(0) && block.timestamp <= agentValidUntil;
    }

    // ---------------------------------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------------------------------

    function _isAction(bytes4 a) internal pure returns (bool) {
        return a == ACTION_ROUTER_SWAP || a == ACTION_VAULT_DEPOSIT || a == ACTION_VAULT_REDEEM
            || a == ACTION_LEND_SUPPLY || a == ACTION_LEND_WITHDRAW;
    }

    function _requireCall(address target, bytes4 action) internal view {
        if (!_callAllowed[policyEpoch][target][action]) revert CallNotAllowed(target, action);
    }

    function _requireMarket(IMorphoLike.MarketParams calldata market) internal view {
        bytes32 id = keccak256(abi.encode(market));
        if (!_marketAllowed[policyEpoch][id]) revert MarketNotAllowed(id);
    }

    function _requireAllowedToken(address token) internal view {
        if (!_limit[policyEpoch][token].allowed) revert TokenNotAllowed(token);
    }

    /// @dev Charges `amount` of `token` against the per-tx and daily caps of the current epoch.
    function _spend(address token, uint256 amount) internal {
        uint64 epoch = policyEpoch;
        Limit memory lim = _limit[epoch][token];
        if (!lim.allowed) revert TokenNotAllowed(token);
        if (amount > lim.perTxCap) revert PerTxCapExceeded(token, amount, lim.perTxCap);
        uint64 day = uint64(block.timestamp / 1 days);
        Spend storage s = _spent[epoch][token];
        uint256 already = s.day == day ? s.amount : 0;
        uint256 total = already + amount;
        if (total > lim.dailyCap) revert DailyCapExceeded(token, total, lim.dailyCap);
        s.day = day;
        s.amount = uint192(total);
    }

    /// @dev Verifies the account spent at most `maxIn` of `tokenIn` and received >= `minOut` of `tokenOut`.
    function _checkFlows(
        address tokenIn,
        uint256 inBefore,
        uint256 maxIn,
        address tokenOut,
        uint256 outBefore,
        uint256 minOut
    ) internal view returns (uint256 received) {
        uint256 inAfter = _balance(tokenIn);
        uint256 spent = inBefore > inAfter ? inBefore - inAfter : 0;
        if (spent > maxIn) revert OverSpent(tokenIn, spent, maxIn);
        uint256 outAfter = _balance(tokenOut);
        received = outAfter > outBefore ? outAfter - outBefore : 0;
        if (received == 0 || received < minOut) revert InsufficientOutput(received, minOut);
    }

    function _balance(address token) internal view returns (uint256) {
        return token == NATIVE ? address(this).balance : IERC20(token).balanceOf(address(this));
    }

    function _call(address target, uint256 value, bytes calldata data) internal returns (bytes memory result) {
        bool ok;
        (ok, result) = target.call{value: value}(data);
        if (!ok) {
            assembly ("memory-safe") {
                revert(add(result, 32), mload(result))
            }
        }
        emit Executed(target, value, data.length >= 4 ? bytes4(data[:4]) : bytes4(0));
    }

    function _sendToOwner(address token, uint256 amount) internal {
        address to = owner;
        if (token == NATIVE) {
            (bool ok,) = to.call{value: amount}("");
            if (!ok) revert NativeTransferFailed();
        } else {
            IERC20(token).safeTransfer(to, amount);
        }
        emit Withdrawn(token, to, amount);
    }
}
