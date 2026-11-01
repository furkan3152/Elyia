// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice The Uniswap V3 pool surface ElyHerd reads for its USD-pegged price (Kalos V3 is a V3 fork).
interface IHerdV3Pool {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function liquidity() external view returns (uint128);
    function observe(uint32[] calldata secondsAgos)
        external
        view
        returns (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidityCumulativeX128s);
    function increaseObservationCardinalityNext(uint16 observationCardinalityNext) external;
}

/// @notice ERC-20 decimals.
interface IHerdDecimals {
    function decimals() external view returns (uint8);
}
