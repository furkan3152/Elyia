// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IElyiaRouter} from "./interfaces/IElyiaRouter.sol";
import {IWrappedNative, IV2Router, IV3SwapRouterV1, IV3SwapRouter02, IPermit2} from "./interfaces/IExternal.sol";

/// @title ElyiaRouter
/// @author Elyia
/// @notice Stateless multi-venue swap router for Elysium. Splits an input across routes, each route
///         a chain of hops on allowlisted venues (Uniswap V3-style routers, Uniswap V2-style routers,
///         WETH9-style wrappers). `minAmountOut` and `deadline` are enforced on the total, net of fees.
/// @dev Security model:
///      - Funds are only ever pulled from `msg.sender` (ERC-20 allowance, Permit2 signature or Permit2
///        allowance). The owner can never move a user's allowance.
///      - The router holds no funds between transactions: every entry point snapshots the balance of
///        each token it touches and reverts if any balance ends above its snapshot (`FundsLeftInRouter`).
///      - Venues are allowlisted by the owner and typed; each venue receives an exact allowance that is
///        reset to zero right after the call. Outputs are measured by balance differences, never by
///        trusting return values.
///      - Protocol fee is capped at 30 bps (default 0); integrator fees need owner registration and are
///        capped at 50 bps. Fees are pushed in the same transaction.
///      - `nonReentrant` on every state-changing entry point; `whenNotPaused` on every user flow.
///      NOT AUDITED.
contract ElyiaRouter is IElyiaRouter, Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------------------------------------
    // Constants and immutables
    // ---------------------------------------------------------------------------------------------

    /// @notice Native HYPE sentinel.
    address internal constant NATIVE = address(0);
    /// @notice Amount sentinel for multicall actions: use everything this call brought into the router.
    uint256 public constant CONTRACT_BALANCE = type(uint256).max;
    /// @notice Hard cap of the protocol fee, in bps.
    uint16 public constant MAX_PROTOCOL_FEE_BPS = 30;
    /// @notice Hard cap of any integrator fee, in bps.
    uint16 public constant MAX_INTEGRATOR_FEE_BPS = 50;
    uint256 internal constant BPS = 10_000;
    /// @notice Maximum split legs per swap.
    uint256 public constant MAX_ROUTES = 8;
    /// @notice Maximum hops per leg.
    uint256 public constant MAX_HOPS = 4;
    /// @notice Maximum distinct tokens (incl. native) one call may touch.
    uint256 public constant MAX_TRACKED_TOKENS = 16;

    /// @notice Canonical Permit2.
    IPermit2 public immutable PERMIT2;

    // ---------------------------------------------------------------------------------------------
    // Storage (configuration only; the router never stores user balances)
    // ---------------------------------------------------------------------------------------------

    /// @inheritdoc IElyiaRouter
    mapping(address venue => VenueKind) public venueKind;
    /// @notice Registered integrators and their maximum fee in bps (0 = not registered).
    mapping(address integrator => uint16) public integratorMaxFeeBps;
    /// @notice Protocol fee in bps taken from the gross output. Default 0.
    uint16 public protocolFeeBps;
    /// @notice Receiver of the protocol fee.
    address public feeRecipient;

    // ---------------------------------------------------------------------------------------------
    // Multicall actions
    // ---------------------------------------------------------------------------------------------

    /// @notice Multicall operation codes. `data` encodings:
    ///  PULL                   (address token, uint256 amount)                        ERC-20 transferFrom(msg.sender)
    ///  PULL_PERMIT2           (IPermit2.PermitTransferFrom permit, uint256 amount, bytes signature)
    ///  PULL_PERMIT2_ALLOWANCE (address token, uint160 amount)
    ///  WRAP                   (address wrapper, uint256 amount | CONTRACT_BALANCE)
    ///  UNWRAP                 (address wrapper, uint256 amount | CONTRACT_BALANCE)
    ///  SWAP                   (SwapParams) - input taken from the router's in-call balance
    ///  VAULT_DEPOSIT          (address vault, uint256 assets | CONTRACT_BALANCE, address receiver, uint256 minShares)
    ///  VAULT_REDEEM           (address vault, uint256 shares | CONTRACT_BALANCE, address receiver, uint256 minAssets)
    ///  SWEEP                  (address token, address recipient, uint256 minAmount)
    enum Op {
        PULL,
        PULL_PERMIT2,
        PULL_PERMIT2_ALLOWANCE,
        WRAP,
        UNWRAP,
        SWAP,
        VAULT_DEPOSIT,
        VAULT_REDEEM,
        SWEEP
    }

    struct Action {
        Op op;
        bytes data;
    }

    /// @dev In-memory per-call ledger of touched tokens and their starting balances.
    struct Ledger {
        address[] tokens;
        uint256[] start;
        uint256 len;
    }

    // ---------------------------------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------------------------------

    event Swap(
        address indexed sender,
        address indexed recipient,
        address indexed tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        uint256 protocolFee,
        address integrator,
        uint256 integratorFee
    );
    event Wrapped(address indexed wrapper, uint256 amount);
    event Unwrapped(address indexed wrapper, uint256 amount);
    event Pulled(address indexed from, address indexed token, uint256 amount);
    event VaultDeposited(address indexed sender, address indexed vault, address indexed receiver, uint256 assets, uint256 shares);
    event VaultRedeemed(address indexed sender, address indexed vault, address indexed receiver, uint256 shares, uint256 assets);
    event Swept(address indexed token, address indexed recipient, uint256 amount);
    event VenueSet(address indexed venue, VenueKind kind);
    event ProtocolFeeSet(uint16 feeBps, address indexed recipient);
    event IntegratorSet(address indexed integrator, uint16 maxFeeBps);
    event Rescued(address indexed token, address indexed to, uint256 amount);

    // ---------------------------------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------------------------------

    error DeadlineExpired();
    error ZeroAddress();
    error ZeroAmount();
    error SameToken();
    error BadRouteCount();
    error BadHopCount();
    error BrokenPath();
    error AmountMismatch();
    error VenueNotAllowed(address venue);
    error BadHop();
    error NoOutput();
    error InsufficientOutput(uint256 amountOut, uint256 minAmountOut);
    error InsufficientBalance(address token, uint256 available, uint256 needed);
    error FeeTooHigh();
    error IntegratorNotAllowed();
    error UnexpectedValue();
    error NativeTransferFailed();
    error FundsLeftInRouter(address token);
    error TooManyTokens();
    error UnexpectedNative();
    error PermitMismatch();
    error RenounceDisabled();

    // ---------------------------------------------------------------------------------------------
    // Constructor and admin
    // ---------------------------------------------------------------------------------------------

    /// @param initialOwner Owner (the deployer's wallet). Can set fees, venues, pause and rescue dust.
    /// @param permit2 Canonical Permit2 address on this chain.
    /// @param venues Initial allowlisted venues.
    /// @param kinds Kind of each initial venue.
    constructor(address initialOwner, address permit2, address[] memory venues, VenueKind[] memory kinds)
        Ownable(initialOwner)
    {
        if (permit2 == address(0)) revert ZeroAddress();
        if (venues.length != kinds.length) revert AmountMismatch();
        PERMIT2 = IPermit2(permit2);
        for (uint256 i; i < venues.length; ++i) {
            _setVenue(venues[i], kinds[i]);
        }
    }

    /// @notice Allowlist, retype or remove (`NONE`) a venue.
    function setVenue(address venue, VenueKind kind) external onlyOwner {
        _setVenue(venue, kind);
    }

    /// @notice Set the protocol fee (<= 30 bps) and its recipient.
    function setProtocolFee(uint16 feeBps, address recipient) external onlyOwner {
        if (feeBps > MAX_PROTOCOL_FEE_BPS) revert FeeTooHigh();
        if (feeBps != 0 && recipient == address(0)) revert ZeroAddress();
        protocolFeeBps = feeBps;
        feeRecipient = recipient;
        emit ProtocolFeeSet(feeBps, recipient);
    }

    /// @notice Register (maxFeeBps > 0) or unregister (0) an integrator.
    function setIntegrator(address integrator, uint16 maxFeeBps) external onlyOwner {
        if (integrator == address(0)) revert ZeroAddress();
        if (maxFeeBps > MAX_INTEGRATOR_FEE_BPS) revert FeeTooHigh();
        integratorMaxFeeBps[integrator] = maxFeeBps;
        emit IntegratorSet(integrator, maxFeeBps);
    }

    /// @notice Kill switch: stops every swap and multicall. Admin and rescue keep working.
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Lift the kill switch.
    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Recover dust sent to the router by mistake. The router holds no user funds between
    ///         transactions, so this can only ever touch stray balances.
    function rescue(address token, address to, uint256 amount) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        _send(token, to, amount);
        emit Rescued(token, to, amount);
    }

    /// @notice Renouncing is disabled so the kill switch can never be orphaned.
    function renounceOwnership() public view override onlyOwner {
        revert RenounceDisabled();
    }

    // ---------------------------------------------------------------------------------------------
    // User entry points
    // ---------------------------------------------------------------------------------------------

    /// @inheritdoc IElyiaRouter
    function swap(SwapParams calldata params)
        external
        payable
        nonReentrant
        whenNotPaused
        returns (uint256 amountOut)
    {
        Ledger memory l = _openLedger();
        SwapParams memory p = params;
        _checkSwapFunding(p);
        if (p.tokenIn != NATIVE) {
            _track(l, p.tokenIn);
            IERC20(p.tokenIn).safeTransferFrom(msg.sender, address(this), p.amountIn);
        }
        amountOut = _swap(l, p);
        _settle(l);
    }

    /// @notice Swap pulling `tokenIn` from msg.sender with a Permit2 signature (no prior approval
    ///         to this router needed). The permit owner is always msg.sender.
    function swapWithPermit2(
        SwapParams calldata params,
        IPermit2.PermitTransferFrom calldata permit,
        bytes calldata signature
    ) external nonReentrant whenNotPaused returns (uint256 amountOut) {
        Ledger memory l = _openLedger();
        SwapParams memory p = params;
        if (p.tokenIn == NATIVE || permit.permitted.token != p.tokenIn) revert PermitMismatch();
        _checkSwapFunding(p);
        _track(l, p.tokenIn);
        PERMIT2.permitTransferFrom(
            permit, IPermit2.SignatureTransferDetails({to: address(this), requestedAmount: p.amountIn}), msg.sender, signature
        );
        amountOut = _swap(l, p);
        _settle(l);
    }

    /// @notice Batch of actions in one transaction, e.g. native HYPE -> wrap -> swap -> ERC-4626
    ///         deposit, or Permit2 pull -> swap -> deposit. Funds only come from msg.sender (msg.value
    ///         or pulls). Everything brought in must leave by the end of the call.
    /// @param deadline Unix time after which the batch reverts.
    function multicall(uint256 deadline, Action[] calldata actions) external payable nonReentrant whenNotPaused {
        if (block.timestamp > deadline) revert DeadlineExpired();
        Ledger memory l = _openLedger();
        for (uint256 i; i < actions.length; ++i) {
            _dispatch(l, actions[i]);
        }
        _settle(l);
    }

    /// @dev Only accepts native HYPE from an allowlisted wrapper during a call (unwraps). Both storage
    ///      reads are warm at that point, so this fits in the 2300 gas stipend of WETH9's `transfer`.
    receive() external payable {
        if (!_reentrancyGuardEntered() || venueKind[msg.sender] != VenueKind.WRAPPER) revert UnexpectedNative();
    }

    // ---------------------------------------------------------------------------------------------
    // Multicall dispatch
    // ---------------------------------------------------------------------------------------------

    function _dispatch(Ledger memory l, Action calldata a) internal {
        Op op = a.op;
        if (op == Op.PULL) {
            (address token, uint256 amount) = abi.decode(a.data, (address, uint256));
            if (token == NATIVE) revert BadHop();
            if (amount == 0) revert ZeroAmount();
            _track(l, token);
            IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
            emit Pulled(msg.sender, token, amount);
        } else if (op == Op.PULL_PERMIT2) {
            (IPermit2.PermitTransferFrom memory permit, uint256 amount, bytes memory sig) =
                abi.decode(a.data, (IPermit2.PermitTransferFrom, uint256, bytes));
            if (permit.permitted.token == NATIVE) revert BadHop();
            if (amount == 0) revert ZeroAmount();
            _track(l, permit.permitted.token);
            PERMIT2.permitTransferFrom(
                permit, IPermit2.SignatureTransferDetails({to: address(this), requestedAmount: amount}), msg.sender, sig
            );
            emit Pulled(msg.sender, permit.permitted.token, amount);
        } else if (op == Op.PULL_PERMIT2_ALLOWANCE) {
            (address token, uint160 amount) = abi.decode(a.data, (address, uint160));
            if (token == NATIVE) revert BadHop();
            if (amount == 0) revert ZeroAmount();
            _track(l, token);
            PERMIT2.transferFrom(msg.sender, address(this), amount, token);
            emit Pulled(msg.sender, token, amount);
        } else if (op == Op.WRAP) {
            (address wrapper, uint256 amount) = abi.decode(a.data, (address, uint256));
            _requireVenue(wrapper, VenueKind.WRAPPER);
            if (amount == CONTRACT_BALANCE) amount = _available(l, NATIVE);
            _requireAvailable(l, NATIVE, amount);
            _track(l, wrapper);
            IWrappedNative(wrapper).deposit{value: amount}();
            emit Wrapped(wrapper, amount);
        } else if (op == Op.UNWRAP) {
            (address wrapper, uint256 amount) = abi.decode(a.data, (address, uint256));
            _requireVenue(wrapper, VenueKind.WRAPPER);
            _track(l, wrapper);
            if (amount == CONTRACT_BALANCE) amount = _available(l, wrapper);
            _requireAvailable(l, wrapper, amount);
            IWrappedNative(wrapper).withdraw(amount);
            emit Unwrapped(wrapper, amount);
        } else if (op == Op.SWAP) {
            SwapParams memory p = abi.decode(a.data, (SwapParams));
            _track(l, p.tokenIn);
            if (p.amountIn == CONTRACT_BALANCE) {
                if (p.routes.length != 1) revert BadRouteCount();
                p.amountIn = _available(l, p.tokenIn);
                p.routes[0].amountIn = p.amountIn;
            }
            _requireAvailable(l, p.tokenIn, p.amountIn);
            _swap(l, p);
        } else if (op == Op.VAULT_DEPOSIT) {
            (address vault, uint256 assets, address receiver, uint256 minShares) =
                abi.decode(a.data, (address, uint256, address, uint256));
            _vaultDeposit(l, vault, assets, receiver, minShares);
        } else if (op == Op.VAULT_REDEEM) {
            (address vault, uint256 shares, address receiver, uint256 minAssets) =
                abi.decode(a.data, (address, uint256, address, uint256));
            _vaultRedeem(l, vault, shares, receiver, minAssets);
        } else {
            // Op.SWEEP (abi decoding already rejects out-of-range enum values)
            (address token, address recipient, uint256 minAmount) = abi.decode(a.data, (address, address, uint256));
            if (recipient == address(0)) revert ZeroAddress();
            _track(l, token);
            uint256 amount = _available(l, token);
            if (amount < minAmount) revert InsufficientOutput(amount, minAmount);
            if (amount != 0) _send(token, recipient, amount);
            emit Swept(token, recipient, amount);
        }
    }

    // ---------------------------------------------------------------------------------------------
    // Swap core
    // ---------------------------------------------------------------------------------------------

    /// @dev Validates the parts of a standalone swap that depend on how funds arrive.
    function _checkSwapFunding(SwapParams memory p) internal view {
        if (p.tokenIn == NATIVE) {
            if (msg.value != p.amountIn) revert UnexpectedValue();
        } else if (msg.value != 0) {
            revert UnexpectedValue();
        }
        if (p.amountIn == CONTRACT_BALANCE) revert ZeroAmount();
    }

    function _swap(Ledger memory l, SwapParams memory p) internal returns (uint256 net) {
        if (block.timestamp > p.deadline) revert DeadlineExpired();
        if (p.recipient == address(0)) revert ZeroAddress();
        if (p.tokenIn == p.tokenOut) revert SameToken();
        if (p.amountIn == 0) revert ZeroAmount();
        uint256 nRoutes = p.routes.length;
        if (nRoutes == 0 || nRoutes > MAX_ROUTES) revert BadRouteCount();

        if (p.integrator == address(0)) {
            if (p.integratorFeeBps != 0) revert IntegratorNotAllowed();
        } else if (p.integratorFeeBps > integratorMaxFeeBps[p.integrator]) {
            revert IntegratorNotAllowed();
        }

        uint256 sum;
        for (uint256 i; i < nRoutes; ++i) {
            sum += p.routes[i].amountIn;
        }
        if (sum != p.amountIn) revert AmountMismatch();

        _track(l, p.tokenOut);
        uint256 gross;
        for (uint256 i; i < nRoutes; ++i) {
            gross += _route(l, p.routes[i], p.tokenIn, p.tokenOut);
        }

        uint256 protocolFee = (gross * protocolFeeBps) / BPS;
        uint256 integratorFee = (gross * p.integratorFeeBps) / BPS;
        net = gross - protocolFee - integratorFee;
        if (net < p.minAmountOut) revert InsufficientOutput(net, p.minAmountOut);

        if (protocolFee != 0) _send(p.tokenOut, feeRecipient, protocolFee);
        if (integratorFee != 0) _send(p.tokenOut, p.integrator, integratorFee);
        if (p.recipient != address(this)) _send(p.tokenOut, p.recipient, net);

        emit Swap(msg.sender, p.recipient, p.tokenIn, p.tokenOut, p.amountIn, net, protocolFee, p.integrator, integratorFee);
    }

    function _route(Ledger memory l, Route memory r, address tokenIn, address tokenOut) internal returns (uint256 amount) {
        uint256 nHops = r.hops.length;
        if (nHops == 0 || nHops > MAX_HOPS) revert BadHopCount();
        amount = r.amountIn;
        if (amount == 0) revert ZeroAmount();
        address current = tokenIn;
        for (uint256 i; i < nHops; ++i) {
            Hop memory h = r.hops[i];
            if (h.tokenIn != current || h.tokenIn == h.tokenOut) revert BrokenPath();
            amount = _hop(l, h, amount);
            current = h.tokenOut;
        }
        if (current != tokenOut) revert BrokenPath();
    }

    function _hop(Ledger memory l, Hop memory h, uint256 amountIn) internal returns (uint256 amountOut) {
        _track(l, h.tokenOut);
        uint256 before = _balanceOf(h.tokenOut);

        if (h.kind == HopKind.WRAP) {
            _requireVenue(h.venue, VenueKind.WRAPPER);
            if (h.tokenIn != NATIVE || h.tokenOut != h.venue || h.fee != 0) revert BadHop();
            IWrappedNative(h.venue).deposit{value: amountIn}();
        } else if (h.kind == HopKind.UNWRAP) {
            _requireVenue(h.venue, VenueKind.WRAPPER);
            if (h.tokenIn != h.venue || h.tokenOut != NATIVE || h.fee != 0) revert BadHop();
            IWrappedNative(h.venue).withdraw(amountIn);
        } else {
            if (h.tokenIn == NATIVE || h.tokenOut == NATIVE) revert BadHop();
            IERC20 tokenIn = IERC20(h.tokenIn);
            if (h.kind == HopKind.V2) {
                _requireVenue(h.venue, VenueKind.V2_ROUTER);
                if (h.fee != 0) revert BadHop();
                address[] memory path = new address[](2);
                path[0] = h.tokenIn;
                path[1] = h.tokenOut;
                tokenIn.forceApprove(h.venue, amountIn);
                IV2Router(h.venue).swapExactTokensForTokens(amountIn, 0, path, address(this), block.timestamp);
            } else if (h.kind == HopKind.V3_V1) {
                _requireVenue(h.venue, VenueKind.V3_ROUTER_V1);
                if (h.fee == 0) revert BadHop();
                tokenIn.forceApprove(h.venue, amountIn);
                IV3SwapRouterV1(h.venue).exactInputSingle(
                    IV3SwapRouterV1.ExactInputSingleParams({
                        tokenIn: h.tokenIn,
                        tokenOut: h.tokenOut,
                        fee: h.fee,
                        recipient: address(this),
                        deadline: block.timestamp,
                        amountIn: amountIn,
                        amountOutMinimum: 0,
                        sqrtPriceLimitX96: 0
                    })
                );
            } else {
                // HopKind.V3_02
                _requireVenue(h.venue, VenueKind.V3_ROUTER_02);
                if (h.fee == 0) revert BadHop();
                tokenIn.forceApprove(h.venue, amountIn);
                IV3SwapRouter02(h.venue).exactInputSingle(
                    IV3SwapRouter02.ExactInputSingleParams({
                        tokenIn: h.tokenIn,
                        tokenOut: h.tokenOut,
                        fee: h.fee,
                        recipient: address(this),
                        amountIn: amountIn,
                        amountOutMinimum: 0,
                        sqrtPriceLimitX96: 0
                    })
                );
            }
            // Never leave an allowance behind, even if the venue pulled less than approved.
            tokenIn.forceApprove(h.venue, 0);
        }

        amountOut = _balanceOf(h.tokenOut) - before;
        if (amountOut == 0) revert NoOutput();
    }

    // ---------------------------------------------------------------------------------------------
    // Vaults
    // ---------------------------------------------------------------------------------------------

    function _vaultDeposit(Ledger memory l, address vault, uint256 assets, address receiver, uint256 minShares) internal {
        _requireVenue(vault, VenueKind.VAULT);
        if (receiver == address(0)) revert ZeroAddress();
        address asset = IERC4626(vault).asset();
        if (asset == NATIVE || asset == vault) revert BadHop();
        _track(l, asset);
        _track(l, vault);
        if (assets == CONTRACT_BALANCE) assets = _available(l, asset);
        if (assets == 0) revert ZeroAmount();
        _requireAvailable(l, asset, assets);

        uint256 sharesBefore = IERC20(vault).balanceOf(receiver);
        IERC20(asset).forceApprove(vault, assets);
        IERC4626(vault).deposit(assets, receiver);
        IERC20(asset).forceApprove(vault, 0);
        uint256 shares = IERC20(vault).balanceOf(receiver) - sharesBefore;
        if (shares == 0 || shares < minShares) revert InsufficientOutput(shares, minShares);
        emit VaultDeposited(msg.sender, vault, receiver, assets, shares);
    }

    function _vaultRedeem(Ledger memory l, address vault, uint256 shares, address receiver, uint256 minAssets) internal {
        _requireVenue(vault, VenueKind.VAULT);
        if (receiver == address(0)) revert ZeroAddress();
        address asset = IERC4626(vault).asset();
        if (asset == NATIVE || asset == vault) revert BadHop();
        _track(l, vault);
        _track(l, asset);
        if (shares == CONTRACT_BALANCE) shares = _available(l, vault);
        if (shares == 0) revert ZeroAmount();
        _requireAvailable(l, vault, shares);

        uint256 assetsBefore = IERC20(asset).balanceOf(receiver);
        IERC4626(vault).redeem(shares, receiver, address(this));
        uint256 assets = IERC20(asset).balanceOf(receiver) - assetsBefore;
        if (assets == 0 || assets < minAssets) revert InsufficientOutput(assets, minAssets);
        emit VaultRedeemed(msg.sender, vault, receiver, shares, assets);
    }

    // ---------------------------------------------------------------------------------------------
    // Ledger (sweep checks)
    // ---------------------------------------------------------------------------------------------

    function _openLedger() internal view returns (Ledger memory l) {
        l.tokens = new address[](MAX_TRACKED_TOKENS);
        l.start = new uint256[](MAX_TRACKED_TOKENS);
        // Native is always tracked; msg.value is already in the balance.
        l.tokens[0] = NATIVE;
        l.start[0] = address(this).balance - msg.value;
        l.len = 1;
    }

    /// @dev Snapshots `token` the first time it is touched in this call.
    function _track(Ledger memory l, address token) internal view {
        for (uint256 i; i < l.len; ++i) {
            if (l.tokens[i] == token) return;
        }
        if (l.len == MAX_TRACKED_TOKENS) revert TooManyTokens();
        l.tokens[l.len] = token;
        l.start[l.len] = _balanceOf(token);
        ++l.len;
    }

    /// @dev Amount of `token` this call brought into the router (pre-existing dust is never usable).
    function _available(Ledger memory l, address token) internal view returns (uint256) {
        for (uint256 i; i < l.len; ++i) {
            if (l.tokens[i] == token) {
                uint256 bal = _balanceOf(token);
                return bal > l.start[i] ? bal - l.start[i] : 0;
            }
        }
        return 0;
    }

    function _requireAvailable(Ledger memory l, address token, uint256 amount) internal view {
        if (amount == 0) revert ZeroAmount();
        uint256 avail = _available(l, token);
        if (avail < amount) revert InsufficientBalance(token, avail, amount);
    }

    /// @dev Reverts if any touched token ends above its starting balance.
    function _settle(Ledger memory l) internal view {
        for (uint256 i; i < l.len; ++i) {
            if (_balanceOf(l.tokens[i]) > l.start[i]) revert FundsLeftInRouter(l.tokens[i]);
        }
    }

    // ---------------------------------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------------------------------

    function _setVenue(address venue, VenueKind kind) internal {
        if (venue == address(0) || venue == address(this)) revert ZeroAddress();
        if (kind != VenueKind.NONE && venue.code.length == 0) revert VenueNotAllowed(venue);
        venueKind[venue] = kind;
        emit VenueSet(venue, kind);
    }

    function _requireVenue(address venue, VenueKind kind) internal view {
        if (venueKind[venue] != kind) revert VenueNotAllowed(venue);
    }

    function _balanceOf(address token) internal view returns (uint256) {
        return token == NATIVE ? address(this).balance : IERC20(token).balanceOf(address(this));
    }

    function _send(address token, address to, uint256 amount) internal {
        if (token == NATIVE) {
            (bool ok,) = to.call{value: amount}("");
            if (!ok) revert NativeTransferFailed();
        } else {
            IERC20(token).safeTransfer(to, amount);
        }
    }
}
