// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

// Test-only adversarial contracts.

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @dev ERC-20 that calls an arbitrary target during transfers (reentrancy probe).
contract ReentrantToken is ERC20 {
    address public target;
    bytes public payload;
    bool public armed;
    bool public lastCallOk;
    bytes public lastRevert;

    constructor() ERC20("Reentrant", "REE") {}

    function mint(address to, uint256 a) external {
        _mint(to, a);
    }

    function arm(address t, bytes calldata p) external {
        target = t;
        payload = p;
        armed = true;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (armed) {
            armed = false;
            (bool ok, bytes memory ret) = target.call(payload);
            lastCallOk = ok;
            lastRevert = ret;
            // Bubble the result so tests can assert the guard tripped.
            if (!ok) {
                assembly {
                    revert(add(ret, 32), mload(ret))
                }
            }
        }
    }
}

/// @dev Venue that misbehaves in a configurable way. Speaks the V2 router ABI.
contract EvilV2Router {
    enum Mode {
        HONEST, // fixed 1:1 swap
        PULL_LESS, // pulls half, pays 1:1 on half (leaves tokenIn in the router)
        PAY_NOTHING, // pulls all, pays nothing
        PAY_ELSEWHERE, // pays the output to `sink`
        REENTER, // calls `target` with `payload` mid-swap
        OVERPULL // tries to pull 2x the amount
    }

    Mode public mode;
    address public sink;
    address public target;
    bytes public payload;

    function configure(Mode m, address sink_, address target_, bytes calldata payload_) external {
        mode = m;
        sink = sink_;
        target = target_;
        payload = payload_;
    }

    function swapExactTokensForTokens(uint256 amountIn, uint256, address[] calldata path, address to, uint256)
        external
        returns (uint256[] memory amounts)
    {
        uint256 pull = amountIn;
        if (mode == Mode.PULL_LESS) pull = amountIn / 2;
        if (mode == Mode.OVERPULL) pull = amountIn * 2;
        IERC20(path[0]).transferFrom(msg.sender, address(this), pull);
        if (mode == Mode.REENTER) {
            (bool ok, bytes memory ret) = target.call(payload);
            if (!ok) {
                assembly {
                    revert(add(ret, 32), mload(ret))
                }
            }
        }
        uint256 out = pull;
        if (mode == Mode.PAY_NOTHING) out = 0;
        if (out != 0) IERC20(path[1]).transfer(mode == Mode.PAY_ELSEWHERE ? sink : to, out);
        amounts = new uint256[](2);
        amounts[0] = amountIn;
        amounts[1] = out;
    }
}

/// @dev Contract that rejects native HYPE.
contract RejectNative {
    receive() external payable {
        revert("no");
    }
}

/// @dev Smart-contract owner/maker that accepts any signature produced by its EOA (ERC-1271).
contract Eip1271Wallet {
    address public immutable signer;

    constructor(address s) {
        signer = s;
    }

    function isValidSignature(bytes32 hash, bytes calldata sig) external view returns (bytes4) {
        (bytes32 r, bytes32 s, uint8 v) = abi.decode(sig, (bytes32, bytes32, uint8));
        return ecrecover(hash, v, r, s) == signer ? bytes4(0x1626ba7e) : bytes4(0xffffffff);
    }

    function approve(address token, address spender, uint256 a) external {
        IERC20(token).approve(spender, a);
    }
}
