// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

// Test-only contracts for ElyHerd. Never deployed outside tests.

interface IElyHerdMint {
    function mintPublic() external payable returns (uint256);
    function mintAllowlist(bytes32[] calldata proof) external payable returns (uint256);
    function mintCollab(bytes32 tag, bytes32[] calldata proof) external payable returns (uint256);
    function withdraw(address to) external;
}

/// @dev Kalos V3 pool stand-in: settable tokens, liquidity, spot and TWAP ticks, and failure modes.
contract MockHerdPool {
    address public token0;
    address public token1;
    uint128 public liquidity = 1e18;
    int24 public spotTick;
    int24 public twapTick;
    bool public observeReverts;
    bool public slot0Reverts;
    uint16 public cardinalityNext = 1;

    constructor(address t0, address t1) {
        token0 = t0;
        token1 = t1;
    }

    function set(int24 spot, int24 twap) external {
        spotTick = spot;
        twapTick = twap;
    }

    function setLiquidity(uint128 l) external {
        liquidity = l;
    }

    function setObserveReverts(bool v) external {
        observeReverts = v;
    }

    function setSlot0Reverts(bool v) external {
        slot0Reverts = v;
    }

    function slot0() external view returns (uint160, int24, uint16, uint16, uint16, uint8, bool) {
        require(!slot0Reverts, "slot0");
        return (1 << 96, spotTick, 0, 1, cardinalityNext, 0, true);
    }

    function observe(uint32[] calldata ago) external view returns (int56[] memory cum, uint160[] memory spl) {
        require(!observeReverts, "OLD");
        cum = new int56[](2);
        spl = new uint160[](2);
        cum[0] = -int56(twapTick) * int56(uint56(ago[0])) + 1_000_000;
        cum[1] = 1_000_000;
    }

    function increaseObservationCardinalityNext(uint16 n) external {
        if (n > cardinalityNext) cardinalityNext = n;
    }
}

/// @dev Overpays so it gets a refund, and tries to re-enter ElyHerd from `receive`.
contract HerdReentrantMinter {
    IElyHerdMint public immutable herd;
    uint8 public mode; // 1 = re-enter mintPublic, 2 = re-enter mintAllowlist, 3 = re-enter withdraw
    bool public reentered;
    bool public reentryFailed;
    bytes public reentryError;
    bytes32[] internal _proof;

    constructor(IElyHerdMint h) {
        herd = h;
    }

    function setProof(bytes32[] calldata p) external {
        _proof = p;
    }

    function attackPublic(uint8 m) external payable {
        mode = m;
        herd.mintPublic{value: msg.value}();
    }

    function attackAllowlist(uint8 m) external payable {
        mode = m;
        herd.mintAllowlist{value: msg.value}(_proof);
    }

    receive() external payable {
        if (reentered) return;
        reentered = true;
        bool ok;
        bytes memory err;
        if (mode == 1) (ok, err) = address(herd).call{value: 0}(abi.encodeCall(IElyHerdMint.mintPublic, ()));
        else if (mode == 2) (ok, err) = address(herd).call(abi.encodeCall(IElyHerdMint.mintAllowlist, (_proof)));
        else if (mode == 3) (ok, err) = address(herd).call(abi.encodeCall(IElyHerdMint.withdraw, (address(this))));
        reentryFailed = !ok;
        reentryError = err;
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }
}

/// @dev Mints from its constructor, where `extcodesize(this) == 0` but `msg.sender != tx.origin`.
contract HerdConstructorMinter {
    uint256 public id;

    constructor(IElyHerdMint herd) payable {
        id = herd.mintPublic{value: msg.value}();
    }
}

/// @dev Rejects every native transfer (refunds and withdrawals to it fail).
contract HerdRejectingMinter {
    function mint(IElyHerdMint herd) external payable {
        herd.mintPublic{value: msg.value}();
    }

    receive() external payable {
        revert("no");
    }
}
