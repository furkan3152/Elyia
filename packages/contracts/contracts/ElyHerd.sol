// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC2981} from "@openzeppelin/contracts/token/common/ERC2981.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

import {IHerdV3Pool, IHerdDecimals} from "./interfaces/IHerdOracle.sol";

/// @title ElyHerd ("The Herd")
/// @author Elyia
/// @notice The Ely mascot collection on Elysium: 3333 sequential ERC-721 tokens, one per wallet,
///         minted in phases (`CLOSED -> WL -> PUBLIC -> ENDED`) from four capped buckets (team, WL,
///         collab, public). Prices are fixed in wei or pegged to USD through a Kalos V3 WHYPE/USD TWAP
///         with an admin fallback price. Every oracle problem fails closed (the mint reverts).
/// @dev Design notes:
///      - Token ids run 1..MAX_SUPPLY in mint order. `_mint` (never `_safeMint`) is used, so minting makes
///        no external call; the only external call in a mint is the excess-payment refund, done last
///        (checks-effects-interactions) under a transient reentrancy guard.
///      - 1 per wallet: `mintedBy[account]` holds the id the account minted (0 = none) across all phases.
///        Team mints are exempt and do not touch it.
///      - Allowlist leaves follow OpenZeppelin's StandardMerkleTree encoding:
///        WL `keccak256(bytes.concat(keccak256(abi.encode(account))))`,
///        collab `keccak256(bytes.concat(keccak256(abi.encode(account, partnerTag))))`.
///      - Metadata: placeholder URI until `reveal`. The provenance hash (sha256 of the ordered image hashes)
///        must be set before the first mint. `commitReveal` picks a future block; `reveal` derives
///        `revealOffset` from its hash. Token `id` shows image `(id - 1 + revealOffset) % MAX_SUPPLY` of the
///        provenance order (see `metadataIndexOf`). `tokenURI(id) = baseURI + id`.
///      - Kalos lists a collection after a Kalos admin registers it; its only on-chain check is ERC-165
///        ERC-721. Royalties on Kalos are a marketplace-side creator fee; ERC-2981 here is the hint (5% to
///        the treasury by default, capped at 10%). See research/kalos-nft.md.
///      NOT AUDITED.
contract ElyHerd is ERC721, ERC2981, Ownable2Step, Pausable, ReentrancyGuardTransient {
    using Strings for uint256;

    // ---------------------------------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------------------------------

    enum Phase {
        CLOSED,
        WL,
        PUBLIC,
        ENDED
    }

    enum PriceMode {
        FIXED,
        USD
    }

    enum PriceSource {
        FIXED,
        TWAP,
        FALLBACK
    }

    enum ListId {
        WL,
        COLLAB
    }

    enum Bucket {
        TEAM,
        WL,
        COLLAB,
        PUBLIC,
        BURN
    }

    /// @dev One slot. `start <= block.timestamp < end` is the open window.
    struct PhaseConfig {
        uint40 start;
        uint40 end;
        PriceMode priceMode;
        uint96 priceWei;
        uint64 priceUsd6;
    }

    /// @dev One slot.
    struct OracleConfig {
        address pool;
        uint32 twapSeconds;
        uint16 maxDeviationBps;
        bool usdIsToken0;
        uint8 usdDecimals;
    }

    /// @dev One slot.
    struct FallbackPrice {
        uint128 usdPerHype6;
        uint40 updatedAt;
        uint32 maxStaleness;
    }

    // ---------------------------------------------------------------------------------------------
    // Constants and immutables
    // ---------------------------------------------------------------------------------------------

    uint256 public constant MAX_SUPPLY = 3333;
    /// @notice ERC-2981 cap: 10%.
    uint96 public constant MAX_ROYALTY_BPS = 1000;
    /// @notice Blocks between `commitReveal` and the block whose hash seeds the offset.
    uint256 public constant REVEAL_DELAY_BLOCKS = 32;
    uint32 public constant MIN_TWAP_SECONDS = 60;
    uint32 public constant MAX_TWAP_SECONDS = 1 days;
    uint16 public constant MAX_DEVIATION_BPS = 5000;
    uint32 public constant MAX_FALLBACK_STALENESS = 7 days;
    /// @notice Ticks beyond this are treated as a broken pool (1.0001^400000 ~ 2.3e17).
    uint256 public constant MAX_ORACLE_TICK = 400_000;

    uint256 internal constant BPS = 10_000;
    uint256 internal constant MINTED = 4;
    uint256 internal constant BURNED = 8;
    uint256 internal constant TOTAL = 9;
    uint256 internal constant Q128 = 1 << 128;
    /// @dev 1.0001 in Q128.
    uint256 internal constant TICK_BASE_Q128 = Q128 + Q128 / 10_000;
    bytes4 internal constant ERC4906_INTERFACE_ID = 0x49064906;

    /// @notice Wrapped native token of the oracle pool (canonical WHYPE).
    address public immutable WRAPPED_NATIVE;
    /// @notice USD stablecoin of the oracle pool (canonical USDC).
    address public immutable USD_TOKEN;

    // ---------------------------------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------------------------------

    Phase public phase;
    /// @notice When true, `mintPublic` only accepts `msg.sender == tx.origin` (blocks contract farms).
    bool public eoaOnly = true;
    bool public revealed;
    bool public metadataFrozen;
    /// @notice Block whose hash seeds the reveal offset (0 = no commit).
    uint64 public revealCommitBlock;
    /// @notice 0-based shift of token ids over the provenance order.
    uint16 public revealOffset;

    /// @dev One word of 16-bit fields: [0..3] cap per bucket (TEAM, WL, COLLAB, PUBLIC), [4..7] minted per
    ///      bucket, [8] burned (= "minted" of the BURN bucket), [9] total minted.
    uint256 internal _supply;
    OracleConfig public oracle;
    FallbackPrice public fallbackPrice;

    address public treasury;
    bytes32 public provenanceHash;
    bytes32 public wlRoot;
    bytes32 public collabRoot;

    string public placeholderURI;
    string public baseURI;
    string internal _contractURI;

    mapping(Phase => PhaseConfig) internal _phaseConfig;
    /// @notice Token id minted by `account` in a phase (0 = none). Enforces 1 per wallet.
    mapping(address account => uint256 tokenId) public mintedBy;
    mapping(bytes32 tag => uint256) public collabCap;
    mapping(bytes32 tag => uint256) public collabMinted;

    // ---------------------------------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------------------------------

    event Minted(address indexed to, uint256 indexed id, Phase indexed phase, uint256 pricePaid);
    event TeamMinted(address indexed to, uint256 firstId, uint256 qty);
    event CollabMinted(address indexed to, uint256 indexed id, bytes32 indexed partnerTag);
    event PhaseChanged(Phase from, Phase to);
    event PhaseConfigured(Phase indexed phase, uint40 start, uint40 end, PriceMode priceMode, uint96 priceWei, uint64 priceUsd6);
    event AllocationsSet(uint256 team, uint256 wl, uint256 collab, uint256 pub);
    event Rollover(Bucket indexed from, Bucket indexed to, uint256 qty);
    event MerkleRootSet(ListId indexed list, bytes32 root);
    event CollabCapSet(bytes32 indexed partnerTag, uint256 cap);
    event OracleSet(address indexed pool, uint32 twapSeconds, uint16 maxDeviationBps);
    event OracleCardinalityIncreased(address indexed pool, uint16 observationCardinalityNext);
    event FallbackPriceSet(uint256 usdPerHype6, uint32 maxStaleness);
    event EoaOnlySet(bool eoaOnly);
    event TreasurySet(address indexed treasury);
    event RoyaltySet(address indexed receiver, uint96 bps);
    event Withdrawn(address indexed to, uint256 amount);
    event ProvenanceHashSet(bytes32 provenanceHash);
    event PlaceholderURISet(string uri);
    event BaseURISet(string uri);
    event RevealCommitted(uint256 seedBlock);
    event Revealed(uint256 offset, bytes32 seed);
    event MetadataFrozen();
    /// @dev EIP-4906.
    event MetadataUpdate(uint256 _tokenId);
    /// @dev EIP-4906.
    event BatchMetadataUpdate(uint256 _fromTokenId, uint256 _toTokenId);
    /// @dev ERC-7572.
    event ContractURIUpdated();

    // ---------------------------------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------------------------------

    error ZeroAddress();
    error WrongPhase();
    error PhaseNotOpen();
    error BadPhaseTransition();
    error BadPhaseConfig();
    error AlreadyMinted();
    error ContractMinter();
    error InvalidProof();
    error UnknownPartner();
    error CollabCapReached();
    error AllocationExhausted();
    error BadAllocations();
    error AllocationsLocked();
    error BadRollover();
    error BadQuantity();
    error InsufficientPayment(uint256 price, uint256 sent);
    error RefundFailed();
    error WithdrawFailed();
    error BadRecipient();
    error BadOracleConfig();
    error BadFallbackPrice();
    error OracleUnavailable();
    error OracleDeviation();
    error RoyaltyTooHigh();
    error ProvenanceNotSet();
    error ProvenanceLocked();
    error RevealNotAllowed();
    error RevealAlreadyCommitted();
    error RevealNotCommitted();
    error RevealTooEarly();
    error RevealExpired();
    error AlreadyRevealed();
    error NotRevealed();
    error BaseURINotSet();
    error MetadataIsFrozen();
    error RenounceDisabled();

    // ---------------------------------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------------------------------

    /// @param name_ "The Herd".
    /// @param symbol_ "HERD".
    /// @param initialOwner Admin wallet (owner-provided; never invented).
    /// @param treasury_ Treasury (owner-provided): withdraw target and default royalty receiver.
    /// @param wrappedNative Canonical WHYPE of the network (oracle pool token), or 0 for none.
    /// @param usdToken Canonical USDC of the network (oracle pool token), or 0 for none.
    /// @param priceWei Fixed WL and public price in wei (testnet: 1 HYPE).
    /// @param teamAllocation Team reserve (111).
    /// @param wlAllocation Allowlist bucket (1611).
    /// @param collabAllocation Collab bucket (0 by default; carve it from WL with `rollover` or before opening).
    /// @param publicAllocation Public bucket (1611).
    constructor(
        string memory name_,
        string memory symbol_,
        address initialOwner,
        address treasury_,
        address wrappedNative,
        address usdToken,
        uint96 priceWei,
        uint16 teamAllocation,
        uint16 wlAllocation,
        uint16 collabAllocation,
        uint16 publicAllocation
    ) ERC721(name_, symbol_) Ownable(initialOwner) {
        if (treasury_ == address(0)) revert ZeroAddress();
        WRAPPED_NATIVE = wrappedNative;
        USD_TOKEN = usdToken;
        treasury = treasury_;
        _setDefaultRoyalty(treasury_, 500);
        _setAllocations(teamAllocation, wlAllocation, collabAllocation, publicAllocation);
        _phaseConfig[Phase.WL] = PhaseConfig(0, 0, PriceMode.FIXED, priceWei, 0);
        _phaseConfig[Phase.PUBLIC] = PhaseConfig(0, 0, PriceMode.FIXED, priceWei, 0);
        emit TreasurySet(treasury_);
        emit RoyaltySet(treasury_, 500);
        emit EoaOnlySet(true);
    }

    // ---------------------------------------------------------------------------------------------
    // Mint
    // ---------------------------------------------------------------------------------------------

    /// @notice Public mint, one per wallet. Send at least `quote(Phase.PUBLIC)`; the excess is refunded.
    function mintPublic() external payable nonReentrant whenNotPaused returns (uint256 id) {
        if (eoaOnly && msg.sender != tx.origin) revert ContractMinter();
        id = _mintOne(Phase.PUBLIC, Bucket.PUBLIC);
    }

    /// @notice Allowlist mint during the WL phase. `proof` proves `msg.sender` is in the WL root.
    function mintAllowlist(bytes32[] calldata proof) external payable nonReentrant whenNotPaused returns (uint256 id) {
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(msg.sender))));
        if (!MerkleProof.verifyCalldata(proof, wlRoot, leaf)) revert InvalidProof();
        id = _mintOne(Phase.WL, Bucket.WL);
    }

    /// @notice Collab mint during the WL phase. `proof` proves (`msg.sender`, `partnerTag`) is in the collab root.
    function mintCollab(bytes32 partnerTag, bytes32[] calldata proof)
        external
        payable
        nonReentrant
        whenNotPaused
        returns (uint256 id)
    {
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(msg.sender, partnerTag))));
        if (!MerkleProof.verifyCalldata(proof, collabRoot, leaf)) revert InvalidProof();
        uint256 cap = collabCap[partnerTag];
        if (cap == 0) revert UnknownPartner();
        uint256 minted = collabMinted[partnerTag];
        if (minted >= cap) revert CollabCapReached();
        collabMinted[partnerTag] = minted + 1;
        id = _mintOne(Phase.WL, Bucket.COLLAB);
        emit CollabMinted(msg.sender, id, partnerTag);
    }

    /// @dev Checks, effects, then the refund (the only external call).
    function _mintOne(Phase p, Bucket b) internal returns (uint256 id) {
        if (phase != p) revert WrongPhase();
        PhaseConfig memory cfg = _phaseConfig[p];
        if (block.timestamp < cfg.start || block.timestamp >= cfg.end) revert PhaseNotOpen();
        if (mintedBy[msg.sender] != 0) revert AlreadyMinted();

        (uint256 price,) = _priceOf(cfg);
        if (msg.value < price) revert InsufficientPayment(price, msg.value);

        uint256 s = _supply;
        uint256 bi = uint256(b);
        uint256 minted = _field(s, MINTED + bi);
        if (minted >= _field(s, bi)) revert AllocationExhausted();
        id = _field(s, TOTAL) + 1;
        _supply = _setField(_setField(s, MINTED + bi, minted + 1), TOTAL, id);
        mintedBy[msg.sender] = id;
        _mint(msg.sender, id);
        emit Minted(msg.sender, id, p, price);

        uint256 refund = msg.value - price;
        if (refund != 0) {
            (bool ok,) = payable(msg.sender).call{value: refund}("");
            if (!ok) revert RefundFailed();
        }
    }

    /// @notice Mint `qty` team-reserve tokens to `to` (batches allowed). Exempt from 1 per wallet.
    function teamMint(address to, uint256 qty) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (provenanceHash == bytes32(0)) revert ProvenanceNotSet();
        uint256 s = _supply;
        if (qty == 0) revert BadQuantity();
        uint256 teamMinted = _field(s, MINTED);
        if (qty > _field(s, 0) - teamMinted) revert AllocationExhausted();
        uint256 first = _field(s, TOTAL) + 1;
        _supply = _setField(_setField(s, MINTED, teamMinted + qty), TOTAL, first + qty - 1);
        Phase p = phase;
        for (uint256 i; i < qty; ++i) {
            _mint(to, first + i);
            emit Minted(to, first + i, p, 0);
        }
        emit TeamMinted(to, first, qty);
    }

    // ---------------------------------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------------------------------

    /// @notice Tokens minted so far (no token burns exist).
    function totalSupply() external view returns (uint256) {
        return _field(_supply, TOTAL);
    }

    /// @notice MAX_SUPPLY minus supply removed by `rollover(.., BURN, ..)`.
    function maxMintable() public view returns (uint256) {
        return MAX_SUPPLY - _field(_supply, BURNED);
    }

    /// @notice Bucket caps and minted counters.
    function allocations()
        external
        view
        returns (
            uint256 team,
            uint256 wl,
            uint256 collab,
            uint256 pub,
            uint256 teamMinted,
            uint256 wlMinted,
            uint256 collabMinted_,
            uint256 pubMinted,
            uint256 burned
        )
    {
        uint256 s = _supply;
        return (
            _field(s, 0), _field(s, 1), _field(s, 2), _field(s, 3), _field(s, 4), _field(s, 5), _field(s, 6), _field(s, 7), _field(s, 8)
        );
    }

    function phaseConfig(Phase p)
        external
        view
        returns (uint40 start, uint40 end, PriceMode priceMode, uint96 priceWei, uint64 priceUsd6)
    {
        PhaseConfig memory c = _phaseConfig[p];
        return (c.start, c.end, c.priceMode, c.priceWei, c.priceUsd6);
    }

    /// @notice Whether `p` is the current phase, inside its window and not paused.
    function isOpen(Phase p) external view returns (bool) {
        PhaseConfig memory c = _phaseConfig[p];
        return !paused() && phase == p && block.timestamp >= c.start && block.timestamp < c.end;
    }

    function merkleRoots() external view returns (bytes32 wl, bytes32 collab) {
        return (wlRoot, collabRoot);
    }

    /// @notice Price in wei for one mint in phase `p` right now. Reverts when the oracle is unusable.
    function quote(Phase p) external view returns (uint256 priceWei) {
        if (p != Phase.WL && p != Phase.PUBLIC) revert WrongPhase();
        (priceWei,) = _priceOf(_phaseConfig[p]);
    }

    /// @notice `quote` plus the source used (fixed, TWAP or fallback).
    function quoteWithSource(Phase p) external view returns (uint256 priceWei, PriceSource source) {
        if (p != Phase.WL && p != Phase.PUBLIC) revert WrongPhase();
        return _priceOf(_phaseConfig[p]);
    }

    /// @notice Provenance-order index (0-based) of the image token `tokenId` shows. Only after reveal.
    function metadataIndexOf(uint256 tokenId) external view returns (uint256) {
        if (!revealed) revert NotRevealed();
        _requireOwned(tokenId);
        return (tokenId - 1 + revealOffset) % MAX_SUPPLY;
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        if (!revealed) return placeholderURI;
        return string.concat(baseURI, tokenId.toString());
    }

    /// @notice Collection-level metadata (ERC-7572), read off chain by marketplaces.
    function contractURI() external view returns (string memory) {
        return _contractURI;
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721, ERC2981) returns (bool) {
        return interfaceId == ERC4906_INTERFACE_ID || super.supportsInterface(interfaceId);
    }

    // ---------------------------------------------------------------------------------------------
    // Admin: phases, allocations, lists
    // ---------------------------------------------------------------------------------------------

    /// @notice Move forward to `next` (skipping is allowed, going back is not). Opening WL or PUBLIC
    ///         needs the provenance hash and locks `setAllocations`.
    function setPhase(Phase next) external onlyOwner {
        Phase cur = phase;
        if (next <= cur) revert BadPhaseTransition();
        if ((next == Phase.WL || next == Phase.PUBLIC) && provenanceHash == bytes32(0)) revert ProvenanceNotSet();
        phase = next;
        emit PhaseChanged(cur, next);
    }

    /// @notice Window and price of the WL or PUBLIC phase. Can be changed at any time (extend, shorten,
    ///         reprice). `priceWei` applies in FIXED mode, `priceUsd6` (USD, 6 decimals) in USD mode.
    function setPhaseConfig(Phase p, uint40 start, uint40 end, PriceMode priceMode, uint96 priceWei, uint64 priceUsd6)
        external
        onlyOwner
    {
        if (p != Phase.WL && p != Phase.PUBLIC) revert BadPhaseConfig();
        if (end <= start) revert BadPhaseConfig();
        if (priceMode == PriceMode.USD && priceUsd6 == 0) revert BadPhaseConfig();
        _phaseConfig[p] = PhaseConfig(start, end, priceMode, priceWei, priceUsd6);
        emit PhaseConfigured(p, start, end, priceMode, priceWei, priceUsd6);
    }

    /// @notice Set all four caps while the phase is CLOSED. Their sum must stay within MAX_SUPPLY.
    function setAllocations(uint16 team, uint16 wl, uint16 collab, uint16 pub) external onlyOwner {
        if (phase != Phase.CLOSED) revert AllocationsLocked();
        if (team < _field(_supply, MINTED)) revert BadAllocations();
        _setAllocations(team, wl, collab, pub);
    }

    function _setAllocations(uint16 team, uint16 wl, uint16 collab, uint16 pub) internal {
        uint256 s = _supply;
        if (uint256(team) + wl + collab + pub + _field(s, BURNED) > MAX_SUPPLY) revert BadAllocations();
        _supply = _setField(_setField(_setField(_setField(s, 0, team), 1, wl), 2, collab), 3, pub);
        emit AllocationsSet(team, wl, collab, pub);
    }

    /// @notice Move `qty` unminted supply between buckets, or remove it for good (`to = BURN`).
    ///         WL <-> COLLAB: any time. WL/COLLAB -> PUBLIC/BURN: from the PUBLIC phase on.
    ///         PUBLIC -> TEAM/BURN and TEAM -> BURN: only once ENDED.
    function rollover(Bucket from, Bucket to, uint256 qty) external onlyOwner {
        if (qty == 0) revert BadQuantity();
        Phase p = phase;
        bool ok;
        if ((from == Bucket.WL && to == Bucket.COLLAB) || (from == Bucket.COLLAB && to == Bucket.WL)) {
            ok = p != Phase.ENDED;
        } else if ((from == Bucket.WL || from == Bucket.COLLAB) && (to == Bucket.PUBLIC || to == Bucket.BURN)) {
            ok = p >= Phase.PUBLIC;
        } else if (from == Bucket.PUBLIC && (to == Bucket.TEAM || to == Bucket.BURN)) {
            ok = p == Phase.ENDED;
        } else if (from == Bucket.TEAM && to == Bucket.BURN) {
            ok = p == Phase.ENDED;
        }
        if (!ok) revert BadRollover();

        uint256 s = _supply;
        uint256 f = uint256(from);
        uint256 fromCap = _field(s, f);
        if (qty > fromCap - _field(s, MINTED + f)) revert BadQuantity();
        s = _setField(s, f, fromCap - qty);
        // BURN adds to field 8 (burned); every other bucket to its cap.
        uint256 t = to == Bucket.BURN ? BURNED : uint256(to);
        _supply = _setField(s, t, _field(s, t) + qty);
        emit Rollover(from, to, qty);
    }

    function setMerkleRoot(ListId list, bytes32 root) external onlyOwner {
        if (list == ListId.WL) wlRoot = root;
        else collabRoot = root;
        emit MerkleRootSet(list, root);
    }

    /// @notice Per-partner cap inside the collab bucket. 0 disables the partner. Cannot go below minted.
    function setCollabCap(bytes32 partnerTag, uint256 cap) external onlyOwner {
        if (cap < collabMinted[partnerTag] || cap > MAX_SUPPLY) revert BadAllocations();
        collabCap[partnerTag] = cap;
        emit CollabCapSet(partnerTag, cap);
    }

    function setEoaOnly(bool value) external onlyOwner {
        eoaOnly = value;
        emit EoaOnlySet(value);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ---------------------------------------------------------------------------------------------
    // Admin: price oracle
    // ---------------------------------------------------------------------------------------------

    /// @notice Kalos V3 WRAPPED_NATIVE/USD_TOKEN pool for the USD peg (`pool = 0` disables the TWAP).
    /// @param twapSeconds TWAP window, 60 s .. 1 day. The pool needs enough observation cardinality.
    /// @param maxDeviationBps Max spot-vs-TWAP and TWAP-vs-fresh-fallback deviation, 1 .. 5000.
    function setOracle(address pool, uint32 twapSeconds, uint16 maxDeviationBps) external onlyOwner {
        if (pool == address(0)) {
            delete oracle;
            emit OracleSet(address(0), 0, 0);
            return;
        }
        if (twapSeconds < MIN_TWAP_SECONDS || twapSeconds > MAX_TWAP_SECONDS) revert BadOracleConfig();
        if (maxDeviationBps == 0 || maxDeviationBps > MAX_DEVIATION_BPS) revert BadOracleConfig();
        if (WRAPPED_NATIVE == address(0) || USD_TOKEN == address(0)) revert BadOracleConfig();
        address t0 = IHerdV3Pool(pool).token0();
        address t1 = IHerdV3Pool(pool).token1();
        bool usdIsToken0;
        if (t0 == USD_TOKEN && t1 == WRAPPED_NATIVE) usdIsToken0 = true;
        else if (!(t0 == WRAPPED_NATIVE && t1 == USD_TOKEN)) revert BadOracleConfig();
        uint8 usdDecimals = IHerdDecimals(USD_TOKEN).decimals();
        if (usdDecimals < 6 || usdDecimals > 18 || IHerdDecimals(WRAPPED_NATIVE).decimals() != 18) {
            revert BadOracleConfig();
        }
        oracle = OracleConfig(pool, twapSeconds, maxDeviationBps, usdIsToken0, usdDecimals);
        emit OracleSet(pool, twapSeconds, maxDeviationBps);
    }

    /// @notice Grow the pool's observation buffer (Kalos pools ship with cardinality 1). Permissionless on
    ///         the pool itself; exposed here so the admin panel can prepare it. The caller pays the gas.
    function growOracleCardinality(uint16 observationCardinalityNext) external onlyOwner {
        address pool = oracle.pool;
        if (pool == address(0)) revert BadOracleConfig();
        IHerdV3Pool(pool).increaseObservationCardinalityNext(observationCardinalityNext);
        emit OracleCardinalityIncreased(pool, observationCardinalityNext);
    }

    /// @notice Admin HYPE/USD price (6 decimals), valid for `maxStaleness` seconds. 0 disables it.
    function setFallbackPrice(uint256 usdPerHype6, uint32 maxStaleness) external onlyOwner {
        if (usdPerHype6 > type(uint128).max) revert BadFallbackPrice();
        if (usdPerHype6 != 0 && (maxStaleness == 0 || maxStaleness > MAX_FALLBACK_STALENESS)) revert BadFallbackPrice();
        fallbackPrice = FallbackPrice(uint128(usdPerHype6), uint40(block.timestamp), maxStaleness);
        emit FallbackPriceSet(usdPerHype6, maxStaleness);
    }

    // ---------------------------------------------------------------------------------------------
    // Admin: metadata
    // ---------------------------------------------------------------------------------------------

    /// @notice sha256 of the ordered image hashes. Only before the first mint.
    function setProvenanceHash(bytes32 hash) external onlyOwner {
        if (_field(_supply, TOTAL) != 0 || revealCommitBlock != 0) revert ProvenanceLocked();
        if (hash == bytes32(0)) revert ProvenanceNotSet();
        provenanceHash = hash;
        emit ProvenanceHashSet(hash);
    }

    function setPlaceholderURI(string calldata uri) external onlyOwner {
        if (metadataFrozen) revert MetadataIsFrozen();
        placeholderURI = uri;
        emit PlaceholderURISet(uri);
        if (!revealed) emit BatchMetadataUpdate(1, MAX_SUPPLY);
    }

    function setBaseURI(string calldata uri) external onlyOwner {
        if (metadataFrozen) revert MetadataIsFrozen();
        baseURI = uri;
        emit BaseURISet(uri);
        if (revealed) emit BatchMetadataUpdate(1, MAX_SUPPLY);
    }

    function setContractURI(string calldata uri) external onlyOwner {
        _contractURI = uri;
        emit ContractURIUpdated();
    }

    /// @notice Commit to the hash of block `now + REVEAL_DELAY_BLOCKS`. Only once the mint is over
    ///         (ENDED or sold out), so nobody can pick traits by timing a mint. Re-committing is only
    ///         possible after a commit expired (its block hash left the 256-block window).
    function commitReveal() external onlyOwner {
        if (revealed) revert AlreadyRevealed();
        if (provenanceHash == bytes32(0)) revert ProvenanceNotSet();
        if (phase != Phase.ENDED && _field(_supply, TOTAL) < maxMintable()) revert RevealNotAllowed();
        uint256 committed = revealCommitBlock;
        if (committed != 0 && block.number <= committed + 256) revert RevealAlreadyCommitted();
        uint256 seedBlock = block.number + REVEAL_DELAY_BLOCKS;
        revealCommitBlock = uint64(seedBlock);
        emit RevealCommitted(seedBlock);
    }

    /// @notice Reveal: derive the offset from the committed block's hash. Needs `baseURI`.
    function reveal() external onlyOwner {
        if (revealed) revert AlreadyRevealed();
        uint256 seedBlock = revealCommitBlock;
        if (seedBlock == 0) revert RevealNotCommitted();
        if (block.number <= seedBlock) revert RevealTooEarly();
        bytes32 h = blockhash(seedBlock);
        if (h == bytes32(0)) revert RevealExpired();
        if (bytes(baseURI).length == 0) revert BaseURINotSet();
        bytes32 seed = keccak256(abi.encode(h, provenanceHash, address(this)));
        uint256 offset = uint256(seed) % MAX_SUPPLY;
        revealOffset = uint16(offset);
        revealed = true;
        emit Revealed(offset, seed);
        emit BatchMetadataUpdate(1, MAX_SUPPLY);
    }

    /// @notice Freeze `baseURI` and `placeholderURI` forever. Only after reveal.
    function freezeMetadata() external onlyOwner {
        if (!revealed) revert NotRevealed();
        if (metadataFrozen) revert MetadataIsFrozen();
        metadataFrozen = true;
        emit MetadataFrozen();
        emit BatchMetadataUpdate(1, MAX_SUPPLY);
    }

    // ---------------------------------------------------------------------------------------------
    // Admin: funds, royalties, ownership
    // ---------------------------------------------------------------------------------------------

    function setTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert ZeroAddress();
        treasury = newTreasury;
        emit TreasurySet(newTreasury);
    }

    /// @notice ERC-2981 default royalty, at most 10%.
    function setRoyalty(address receiver, uint96 bps) external onlyOwner {
        if (bps > MAX_ROYALTY_BPS) revert RoyaltyTooHigh();
        if (receiver == address(0)) revert ZeroAddress();
        _setDefaultRoyalty(receiver, bps);
        emit RoyaltySet(receiver, bps);
    }

    /// @notice Send the whole balance to the owner or the treasury. Nobody else can receive it.
    function withdraw(address to) external onlyOwner nonReentrant {
        if (to != owner() && to != treasury) revert BadRecipient();
        uint256 amount = address(this).balance;
        (bool ok,) = payable(to).call{value: amount}("");
        if (!ok) revert WithdrawFailed();
        emit Withdrawn(to, amount);
    }

    /// @notice Disabled: the collection always keeps an owner.
    function renounceOwnership() public view override onlyOwner {
        revert RenounceDisabled();
    }

    // ---------------------------------------------------------------------------------------------
    // Price internals
    // ---------------------------------------------------------------------------------------------

    function _priceOf(PhaseConfig memory cfg) internal view returns (uint256, PriceSource) {
        if (cfg.priceMode == PriceMode.FIXED) return (cfg.priceWei, PriceSource.FIXED);
        return _usdQuote(cfg.priceUsd6);
    }

    /// @dev TWAP first (sanity-checked against spot and a fresh fallback), else a fresh fallback, else revert.
    function _usdQuote(uint256 usd6) internal view returns (uint256, PriceSource) {
        FallbackPrice memory f = fallbackPrice;
        bool fbFresh = f.usdPerHype6 != 0 && block.timestamp <= uint256(f.updatedAt) + f.maxStaleness;
        uint256 fbWei = fbFresh ? Math.mulDiv(usd6, 1e18, f.usdPerHype6, Math.Rounding.Ceil) : 0;

        OracleConfig memory o = oracle;
        (bool ok, int24 twapTick, int24 spotTick) = _readPool(o);
        if (ok) {
            uint256 usdRaw = usd6 * uint256(10) ** (o.usdDecimals - 6);
            uint256 twapWei = _usdToWeiAtTick(usdRaw, twapTick, o.usdIsToken0);
            uint256 spotWei = _usdToWeiAtTick(usdRaw, spotTick, o.usdIsToken0);
            if (_deviationBps(spotWei, twapWei) > o.maxDeviationBps) revert OracleDeviation();
            if (fbFresh && _deviationBps(twapWei, fbWei) > o.maxDeviationBps) revert OracleDeviation();
            return (twapWei, PriceSource.TWAP);
        }
        if (fbFresh) return (fbWei, PriceSource.FALLBACK);
        revert OracleUnavailable();
    }

    /// @dev Reads the TWAP tick and the spot tick. Any failure, zero liquidity or extreme tick -> !ok.
    function _readPool(OracleConfig memory o) internal view returns (bool ok, int24 twapTick, int24 spotTick) {
        if (o.pool == address(0)) return (false, 0, 0);
        try IHerdV3Pool(o.pool).liquidity() returns (uint128 liq) {
            if (liq == 0) return (false, 0, 0);
        } catch {
            return (false, 0, 0);
        }
        (bool s0, bytes memory r0) = o.pool.staticcall(abi.encodeWithSelector(0x3850c7bd)); // slot0()
        if (!s0 || r0.length < 64) return (false, 0, 0);
        (, int256 t) = abi.decode(r0, (uint256, int256));
        if (!_tickInRange(t)) return (false, 0, 0);
        spotTick = int24(t);

        uint32[] memory ago = new uint32[](2);
        ago[0] = o.twapSeconds;
        try IHerdV3Pool(o.pool).observe(ago) returns (int56[] memory cum, uint160[] memory) {
            if (cum.length != 2) return (false, 0, 0);
            int56 delta = cum[1] - cum[0];
            int56 window = int56(uint56(o.twapSeconds));
            int56 avg = delta / window;
            if (delta < 0 && delta % window != 0) avg--;
            if (!_tickInRange(avg)) return (false, 0, 0);
            return (true, int24(avg), spotTick);
        } catch {
            return (false, 0, 0);
        }
    }

    function _tickInRange(int256 t) internal pure returns (bool) {
        return t >= -int256(MAX_ORACLE_TICK) && t <= int256(MAX_ORACLE_TICK);
    }

    /// @dev Wei of wrapped native for `usdRaw` USD-token units at `tick` (price token1/token0 = 1.0001^tick).
    function _usdToWeiAtTick(uint256 usdRaw, int24 tick, bool usdIsToken0) internal pure returns (uint256) {
        uint256 absTick = tick < 0 ? uint256(-int256(tick)) : uint256(int256(tick));
        uint256 r = _pow1_0001Q128(absTick);
        // usd = token0: wei = usd * P; usd = token1: wei = usd / P; P = r (tick >= 0) or 1/r (tick < 0).
        bool multiply = (tick >= 0) == usdIsToken0;
        return multiply
            ? Math.mulDiv(usdRaw, r, Q128, Math.Rounding.Ceil)
            : Math.mulDiv(usdRaw, Q128, r, Math.Rounding.Ceil);
    }

    /// @dev 1.0001^n in Q128 by square-and-multiply (n <= MAX_ORACLE_TICK keeps every value < 2^200).
    function _pow1_0001Q128(uint256 n) internal pure returns (uint256 r) {
        r = Q128;
        uint256 b = TICK_BASE_Q128;
        while (n != 0) {
            if (n & 1 != 0) r = Math.mulDiv(r, b, Q128);
            n >>= 1;
            if (n != 0) b = Math.mulDiv(b, b, Q128);
        }
    }

    function _field(uint256 s, uint256 i) internal pure returns (uint256) {
        return (s >> (i * 16)) & 0xffff;
    }

    /// @dev Values never exceed MAX_SUPPLY (< 2^16): every caller bounds them first.
    function _setField(uint256 s, uint256 i, uint256 v) internal pure returns (uint256) {
        return (s & ~(uint256(0xffff) << (i * 16))) | (v << (i * 16));
    }

    function _deviationBps(uint256 a, uint256 ref) internal pure returns (uint256) {
        if (ref == 0) return type(uint256).max;
        uint256 d = a > ref ? a - ref : ref - a;
        return Math.mulDiv(d, BPS, ref, Math.Rounding.Ceil);
    }
}
