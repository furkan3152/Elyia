// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title IElyiaRouter
/// @notice Types and entry points of the Elyia multi-venue swap router for Elysium.
/// @dev Shared by ElyAccount and ElyOrders so they can build swaps without importing the router.
interface IElyiaRouter {
    /// @notice What an allowlisted address is to the router. `NONE` means not allowlisted.
    enum VenueKind {
        NONE,
        WRAPPER, // WETH9-style wrapped native (deposit/withdraw)
        V2_ROUTER, // Uniswap V2-style router (swapExactTokensForTokens)
        V3_ROUTER_V1, // Uniswap V3 SwapRouter (exactInputSingle with deadline)
        V3_ROUTER_02, // Uniswap V3 SwapRouter02 (exactInputSingle without deadline)
        VAULT // ERC-4626 vault
    }

    /// @notice One hop of a route.
    enum HopKind {
        WRAP, // native -> wrapper token, venue = wrapper
        UNWRAP, // wrapper token -> native, venue = wrapper
        V2, // tokenIn -> tokenOut on a V2 router
        V3_V1, // tokenIn -> tokenOut on a V3 SwapRouter (v1 ABI) with `fee`
        V3_02 // tokenIn -> tokenOut on a V3 SwapRouter02 with `fee`
    }

    /// @param kind   Hop type; must match the venue's registered kind.
    /// @param venue  Allowlisted venue (router or wrapper).
    /// @param tokenIn  Input token of the hop, `address(0)` = native HYPE.
    /// @param tokenOut Output token of the hop, `address(0)` = native HYPE.
    /// @param fee    V3 pool fee tier (ignored for other kinds; must be 0 there).
    struct Hop {
        HopKind kind;
        address venue;
        address tokenIn;
        address tokenOut;
        uint24 fee;
    }

    /// @notice A split leg: `amountIn` of the swap's `tokenIn` goes through `hops` in order.
    struct Route {
        uint256 amountIn;
        Hop[] hops;
    }

    /// @param tokenIn  `address(0)` = native HYPE (sent as msg.value).
    /// @param tokenOut `address(0)` = native HYPE.
    /// @param amountIn Total input; must equal the sum of route amounts.
    /// @param minAmountOut Minimum the recipient receives, net of every fee.
    /// @param recipient Receiver of the net output.
    /// @param deadline Unix time after which the swap reverts.
    /// @param integrator Registered integrator taking a frontend fee, or `address(0)`.
    /// @param integratorFeeBps Integrator fee in bps, at most the integrator's registered cap.
    /// @param routes Split legs.
    struct SwapParams {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 minAmountOut;
        address recipient;
        uint256 deadline;
        address integrator;
        uint16 integratorFeeBps;
        Route[] routes;
    }

    /// @notice Swap pulling `tokenIn` from msg.sender with a plain ERC-20 allowance (or msg.value for HYPE).
    /// @return amountOut Net amount delivered to `recipient`.
    function swap(SwapParams calldata params) external payable returns (uint256 amountOut);

    function venueKind(address venue) external view returns (VenueKind);
}
