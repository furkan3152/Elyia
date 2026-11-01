// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IElyiaRouter} from "./interfaces/IElyiaRouter.sol";
import {IV3PoolOracle} from "./interfaces/IExternal.sol";

/// @title ElyOrders
/// @author Elyia
/// @notice Conditional orders for Elysium AMMs: limit, stop-loss, take-profit, DCA and TWAP.
///         Makers (EOAs or ElyAccounts via ERC-1271) sign EIP-712 orders; funds stay in the maker's
///         wallet behind an allowance to this contract. Any keeper may execute through ElyiaRouter
///         once the condition holds. Output always goes to the maker and must meet `minAmountOut`.
/// @dev Condition: an optional Uniswap V3 pool oracle. With `twapWindow > 0` the TWAP tick and the spot
///      tick must both satisfy the trigger and stay within `maxDeviationTicks` of each other (sanity
///      bound against single-block manipulation). Keeper tip is paid in `tokenIn`, at most the maker's
///      signed `maxTip` and never more than 1% of `amountIn`. No owner, no admin, no upgrade path.
///      NOT AUDITED.
contract ElyOrders is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum OrderKind {
        LIMIT,
        STOP_LOSS,
        TAKE_PROFIT,
        DCA,
        TWAP
    }

    /// @param maker Owner of the funds and receiver of the output.
    /// @param tokenIn ERC-20 sold (native HYPE is not supported as input; use WHYPE).
    /// @param tokenOut Token bought (`address(0)` = native HYPE).
    /// @param amountIn Amount sold per execution.
    /// @param minAmountOut Minimum received per execution, net of router fees (the limit price).
    /// @param maxTip Maximum keeper tip per execution, in `tokenIn`.
    /// @param oracle Uniswap V3 pool used for the trigger, or `address(0)` for none.
    /// @param triggerTick Trigger in the oracle pool's tick space (price of token1 in token0).
    /// @param triggerAbove True: execute when tick >= triggerTick; false: when tick <= triggerTick.
    /// @param twapWindow TWAP window in seconds; 0 = spot tick only.
    /// @param maxDeviationTicks Max |spot - TWAP| allowed when `twapWindow > 0`.
    /// @param kind Order type (validated for consistency).
    /// @param executions Number of executions (1 for limit/stop/TP, >= 2 for DCA/TWAP).
    /// @param interval Minimum seconds between executions.
    /// @param startTime Earliest execution time.
    /// @param deadline Order expiry.
    /// @param nonce Maker-chosen nonce; `invalidateNonces` voids every nonce below a floor.
    struct Order {
        address maker;
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 minAmountOut;
        uint256 maxTip;
        address oracle;
        int24 triggerTick;
        bool triggerAbove;
        uint32 twapWindow;
        uint24 maxDeviationTicks;
        OrderKind kind;
        uint32 executions;
        uint32 interval;
        uint64 startTime;
        uint64 deadline;
        uint256 nonce;
    }

    struct OrderState {
        uint32 executed;
        uint64 lastExecutedAt;
        bool cancelled;
    }

    bytes32 public constant ORDER_TYPEHASH = keccak256(
        "Order(address maker,address tokenIn,address tokenOut,uint256 amountIn,uint256 minAmountOut,uint256 maxTip,address oracle,int24 triggerTick,bool triggerAbove,uint32 twapWindow,uint24 maxDeviationTicks,uint8 kind,uint32 executions,uint32 interval,uint64 startTime,uint64 deadline,uint256 nonce)"
    );

    /// @notice Hard cap of the keeper tip relative to `amountIn`.
    uint256 public constant MAX_TIP_BPS = 100;
    uint256 internal constant BPS = 10_000;
    address internal constant NATIVE = address(0);

    /// @notice The router every execution goes through.
    IElyiaRouter public immutable router;

    mapping(bytes32 orderHash => OrderState) public orderState;
    /// @notice Orders with `nonce < minNonce[maker]` are void.
    mapping(address maker => uint256) public minNonce;

    event OrderExecuted(
        bytes32 indexed orderHash,
        address indexed maker,
        address indexed keeper,
        OrderKind kind,
        uint32 execution,
        uint256 amountIn,
        uint256 amountOut,
        uint256 tip
    );
    event OrderCancelled(bytes32 indexed orderHash, address indexed maker);
    event NoncesInvalidated(address indexed maker, uint256 newMinNonce);

    error BadOrder();
    error BadSignature();
    error OrderCancelledOrInvalidated();
    error NotStarted();
    error Expired();
    error FullyExecuted();
    error TooSoon();
    error TipTooHigh();
    error ConditionNotMet();
    error OracleDeviation();
    error OracleCallFailed();
    error NotMaker();
    error NonceTooLow();
    error InsufficientOutput(uint256 amountOut, uint256 minAmountOut);
    error FundsLeft();

    constructor(IElyiaRouter router_) EIP712("ElyOrders", "1") {
        if (address(router_) == address(0)) revert BadOrder();
        router = router_;
    }

    // ---------------------------------------------------------------------------------------------
    // Maker controls
    // ---------------------------------------------------------------------------------------------

    /// @notice Cancel one order. Only the maker (for an ElyAccount: through its owner's `execute`).
    function cancel(Order calldata order) external {
        if (msg.sender != order.maker) revert NotMaker();
        bytes32 h = hashOrder(order);
        orderState[h].cancelled = true;
        emit OrderCancelled(h, msg.sender);
    }

    /// @notice Void every order of msg.sender with `nonce < newMinNonce`. Can only increase.
    function invalidateNonces(uint256 newMinNonce) external {
        if (newMinNonce <= minNonce[msg.sender]) revert NonceTooLow();
        minNonce[msg.sender] = newMinNonce;
        emit NoncesInvalidated(msg.sender, newMinNonce);
    }

    // ---------------------------------------------------------------------------------------------
    // Execution (any keeper)
    // ---------------------------------------------------------------------------------------------

    /// @notice Execute one fill of `order` through ElyiaRouter along `routes`.
    /// @param routes Keeper-chosen split routes; venues are enforced by the router's allowlist.
    /// @param tip Keeper tip in `tokenIn`, at most `order.maxTip`.
    /// @return amountOut Amount the maker received.
    function execute(
        Order calldata order,
        bytes calldata signature,
        IElyiaRouter.Route[] calldata routes,
        uint256 tip
    ) external nonReentrant returns (uint256 amountOut) {
        bytes32 h = hashOrder(order);
        OrderState memory st = orderState[h];
        _validate(order, st);
        if (!SignatureChecker.isValidSignatureNow(order.maker, _hashTypedDataV4(h), signature)) revert BadSignature();
        if (tip > order.maxTip) revert TipTooHigh();
        _checkCondition(order);

        // Effects before interactions.
        uint32 n = st.executed + 1;
        orderState[h].executed = n;
        orderState[h].lastExecutedAt = uint64(block.timestamp);

        amountOut = _fill(order, routes, tip);
        emit OrderExecuted(h, order.maker, msg.sender, order.kind, n, order.amountIn, amountOut, tip);
    }

    // ---------------------------------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------------------------------

    /// @notice EIP-712 struct hash of `order` (the key of `orderState`).
    function hashOrder(Order calldata o) public pure returns (bytes32) {
        bytes memory a = abi.encode(
            ORDER_TYPEHASH, o.maker, o.tokenIn, o.tokenOut, o.amountIn, o.minAmountOut, o.maxTip, o.oracle, o.triggerTick
        );
        bytes memory b = abi.encode(
            o.triggerAbove,
            o.twapWindow,
            o.maxDeviationTicks,
            uint8(o.kind),
            o.executions,
            o.interval,
            o.startTime,
            o.deadline,
            o.nonce
        );
        return keccak256(bytes.concat(a, b));
    }

    /// @notice Full EIP-712 digest the maker signs.
    function orderDigest(Order calldata o) external view returns (bytes32) {
        return _hashTypedDataV4(hashOrder(o));
    }

    /// @notice EIP-712 domain separator.
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    /// @notice Whether the price condition holds right now (does not check time, nonce or signature).
    function conditionMet(Order calldata o) external view returns (bool ok) {
        if (o.oracle == address(0)) return true;
        (bool success, int24 spot, int24 twap) = _readOracle(o);
        if (!success) return false;
        if (o.twapWindow != 0) {
            uint256 dev = spot > twap ? uint256(int256(spot) - int256(twap)) : uint256(int256(twap) - int256(spot));
            if (dev > o.maxDeviationTicks) return false;
            return _meets(o, spot) && _meets(o, twap);
        }
        return _meets(o, spot);
    }

    // ---------------------------------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------------------------------

    /// @dev Pulls tip + amountIn from the maker, swaps through the router to the maker, verifies.
    function _fill(Order calldata order, IElyiaRouter.Route[] calldata routes, uint256 tip)
        internal
        returns (uint256 amountOut)
    {
        IERC20 tokenIn = IERC20(order.tokenIn);
        uint256 selfBefore = tokenIn.balanceOf(address(this));
        if (tip != 0) tokenIn.safeTransferFrom(order.maker, msg.sender, tip);
        tokenIn.safeTransferFrom(order.maker, address(this), order.amountIn);

        uint256 makerBefore = _balanceOf(order.tokenOut, order.maker);
        tokenIn.forceApprove(address(router), order.amountIn);
        router.swap(_swapParams(order, routes));
        tokenIn.forceApprove(address(router), 0);

        amountOut = _balanceOf(order.tokenOut, order.maker) - makerBefore;
        if (amountOut < order.minAmountOut) revert InsufficientOutput(amountOut, order.minAmountOut);
        if (tokenIn.balanceOf(address(this)) != selfBefore) revert FundsLeft();
    }

    function _swapParams(Order calldata order, IElyiaRouter.Route[] calldata routes)
        internal
        view
        returns (IElyiaRouter.SwapParams memory p)
    {
        p.tokenIn = order.tokenIn;
        p.tokenOut = order.tokenOut;
        p.amountIn = order.amountIn;
        p.minAmountOut = order.minAmountOut;
        p.recipient = order.maker;
        p.deadline = block.timestamp;
        p.routes = routes;
    }

    function _validate(Order calldata o, OrderState memory st) internal view {
        if (o.maker == address(0) || o.tokenIn == NATIVE || o.tokenIn == o.tokenOut) revert BadOrder();
        if (o.amountIn == 0 || o.minAmountOut == 0 || o.executions == 0) revert BadOrder();
        if (o.maxTip * BPS > o.amountIn * MAX_TIP_BPS) revert TipTooHigh();
        if (o.kind == OrderKind.STOP_LOSS || o.kind == OrderKind.TAKE_PROFIT) {
            if (o.oracle == address(0) || o.executions != 1) revert BadOrder();
        } else if (o.kind == OrderKind.LIMIT) {
            if (o.executions != 1) revert BadOrder();
        } else {
            // DCA / TWAP
            if (o.executions < 2 || o.interval == 0) revert BadOrder();
        }
        if (o.oracle == address(0) && (o.twapWindow != 0 || o.triggerTick != 0)) revert BadOrder();

        if (st.cancelled || o.nonce < minNonce[o.maker]) revert OrderCancelledOrInvalidated();
        if (block.timestamp < o.startTime) revert NotStarted();
        if (block.timestamp > o.deadline) revert Expired();
        if (st.executed >= o.executions) revert FullyExecuted();
        if (st.executed != 0 && block.timestamp < uint256(st.lastExecutedAt) + o.interval) revert TooSoon();
    }

    function _checkCondition(Order calldata o) internal view {
        if (o.oracle == address(0)) return;
        (bool success, int24 spot, int24 twap) = _readOracle(o);
        if (!success) revert OracleCallFailed();
        if (o.twapWindow != 0) {
            uint256 dev = spot > twap ? uint256(int256(spot) - int256(twap)) : uint256(int256(twap) - int256(spot));
            if (dev > o.maxDeviationTicks) revert OracleDeviation();
            if (!_meets(o, twap)) revert ConditionNotMet();
        }
        if (!_meets(o, spot)) revert ConditionNotMet();
    }

    function _meets(Order calldata o, int24 tick) internal pure returns (bool) {
        return o.triggerAbove ? tick >= o.triggerTick : tick <= o.triggerTick;
    }

    /// @dev Reads spot tick from slot0 (first two words, tolerant of fork variants) and the TWAP tick.
    function _readOracle(Order calldata o) internal view returns (bool ok, int24 spot, int24 twap) {
        (bool s0, bytes memory r0) = o.oracle.staticcall(abi.encodeWithSelector(0x3850c7bd)); // slot0()
        if (!s0 || r0.length < 64) return (false, 0, 0);
        (, int256 t) = abi.decode(r0, (uint256, int256));
        if (t < type(int24).min || t > type(int24).max) return (false, 0, 0);
        spot = int24(t);
        if (o.twapWindow == 0) return (true, spot, spot);

        uint32[] memory ago = new uint32[](2);
        ago[0] = o.twapWindow;
        ago[1] = 0;
        try IV3PoolOracle(o.oracle).observe(ago) returns (int56[] memory cum, uint160[] memory) {
            if (cum.length != 2) return (false, 0, 0);
            int56 delta = cum[1] - cum[0];
            int56 window = int56(uint56(o.twapWindow));
            int56 avg = delta / window;
            if (delta < 0 && (delta % window != 0)) avg--;
            if (avg < type(int24).min || avg > type(int24).max) return (false, 0, 0);
            return (true, spot, int24(avg));
        } catch {
            return (false, 0, 0);
        }
    }

    function _balanceOf(address token, address who) internal view returns (uint256) {
        return token == NATIVE ? who.balance : IERC20(token).balanceOf(who);
    }
}
