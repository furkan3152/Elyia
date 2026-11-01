// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

// Test-only contracts. Never deployed outside tests.

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";

contract MockERC20 is ERC20 {
    uint8 private immutable _dec;

    constructor(string memory n, string memory s, uint8 d) ERC20(n, s) {
        _dec = d;
    }

    function decimals() public view override returns (uint8) {
        return _dec;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @dev WETH9 clone; withdraw uses `transfer` (2300 gas stipend) like the original.
contract MockWETH is ERC20 {
    constructor() ERC20("Wrapped HYPE", "WHYPE") {}

    function deposit() external payable {
        _mint(msg.sender, msg.value);
    }

    function withdraw(uint256 amount) external {
        _burn(msg.sender, amount);
        payable(msg.sender).transfer(amount);
    }

    receive() external payable {
        _mint(msg.sender, msg.value);
    }
}

/// @dev Fixed-rate swap engine shared by mock routers: out = in * num / den, paid from reserves.
abstract contract FixedRate {
    mapping(address => mapping(address => uint256)) public num;
    mapping(address => mapping(address => uint256)) public den;

    function setRate(address a, address b, uint256 n, uint256 d) external {
        num[a][b] = n;
        den[a][b] = d;
    }

    function _swap(address tokenIn, address tokenOut, uint256 amountIn, address to) internal virtual returns (uint256 out) {
        require(den[tokenIn][tokenOut] != 0, "no rate");
        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        out = (amountIn * num[tokenIn][tokenOut]) / den[tokenIn][tokenOut];
        IERC20(tokenOut).transfer(to, out);
    }
}

contract MockV2Router is FixedRate {
    function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline)
        external
        returns (uint256[] memory amounts)
    {
        require(block.timestamp <= deadline, "expired");
        require(path.length == 2, "path");
        uint256 out = _swap(path[0], path[1], amountIn, to);
        require(out >= amountOutMin, "slippage");
        amounts = new uint256[](2);
        amounts[0] = amountIn;
        amounts[1] = out;
    }
}

contract MockV3RouterV1 is FixedRate {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata p) external payable returns (uint256 out) {
        require(block.timestamp <= p.deadline, "expired");
        out = _swap(p.tokenIn, p.tokenOut, p.amountIn, p.recipient);
        require(out >= p.amountOutMinimum, "slippage");
    }
}

contract MockV3Router02 is FixedRate {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata p) external payable returns (uint256 out) {
        out = _swap(p.tokenIn, p.tokenOut, p.amountIn, p.recipient);
        require(out >= p.amountOutMinimum, "slippage");
    }
}

contract MockVault is ERC4626 {
    constructor(IERC20 asset_) ERC20("Mock Vault", "mVLT") ERC4626(asset_) {}
}

/// @dev Vault that takes the assets and mints nothing.
contract ThiefVault is ERC20 {
    address public immutable asset;

    constructor(address asset_) ERC20("Thief", "THF") {
        asset = asset_;
    }

    function deposit(uint256 assets, address) external returns (uint256) {
        IERC20(asset).transferFrom(msg.sender, address(0xdead), assets);
        return 1e18;
    }

    function redeem(uint256, address, address) external pure returns (uint256) {
        return 0;
    }
}

/// @dev Minimal Morpho-style core: tracks supplied assets per (market id, onBehalf).
contract MockMorpho {
    struct MarketParams {
        address loanToken;
        address collateralToken;
        address oracle;
        address irm;
        uint256 lltv;
    }

    mapping(bytes32 => mapping(address => uint256)) public supplied;

    function supply(MarketParams memory mp, uint256 assets, uint256, address onBehalf, bytes memory)
        external
        returns (uint256, uint256)
    {
        bytes32 id = keccak256(abi.encode(mp));
        IERC20(mp.loanToken).transferFrom(msg.sender, address(this), assets);
        supplied[id][onBehalf] += assets;
        return (assets, assets);
    }

    function withdraw(MarketParams memory mp, uint256 assets, uint256, address onBehalf, address receiver)
        external
        returns (uint256, uint256)
    {
        require(msg.sender == onBehalf, "unauthorized");
        bytes32 id = keccak256(abi.encode(mp));
        supplied[id][onBehalf] -= assets;
        IERC20(mp.loanToken).transfer(receiver, assets);
        return (assets, assets);
    }
}

/// @dev Uniswap V3 pool oracle stand-in with settable spot tick and TWAP tick.
contract MockOraclePool {
    int24 public spotTick;
    int24 public twapTick;
    bool public broken;

    function set(int24 spot, int24 twap) external {
        spotTick = spot;
        twapTick = twap;
    }

    function setBroken(bool b) external {
        broken = b;
    }

    function slot0() external view returns (uint160, int24, uint16, uint16, uint16, uint8, bool) {
        require(!broken, "broken");
        return (1 << 96, spotTick, 0, 1, 1, 0, true);
    }

    function observe(uint32[] calldata ago) external view returns (int56[] memory cum, uint160[] memory spl) {
        require(!broken, "broken");
        cum = new int56[](2);
        spl = new uint160[](2);
        // cumulative(now) - cumulative(now - window) = twapTick * window
        cum[0] = 0;
        cum[1] = int56(twapTick) * int56(uint56(ago[0]));
    }
}
