// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.22;

/**
 * @title PassportRegistry
 * @notice Transport-agnostic state of IDPPs.
 * @dev Holds product identity (token id), passport version (revision + CID) and a hash over the passport's history. It
 * has no token standard and no messaging dependency: the inheriting contract owns NFT ownership, authorization and
 * cross-chain transport, and moves passport state between chains through `_exportPassport` / `_importPassport`.
 */
abstract contract PassportRegistry {
    /// @dev Current state of one passport. The full DPP payload lives off-chain under `cid`.
    struct Passport {
        uint64 revision; // 0 at issuance, +1 per revision, carried across chains
        bytes32 historyHash; // commits to the CIDs of revisions 0..revision (`nextHistoryHash`), carried across chains
        string cid; // content identifier of the current payload (e.g. IPFS CID)
    }

    /// @notice Size of each issuing chain's id namespace: tokenId = idPrefix * ID_SPACE + sequence.
    uint256 public constant ID_SPACE = 1e12;

    /// @notice Upper bound on a CID (CIDv0 = 46 bytes, CIDv1 base32 sha2-256 = 59 bytes); bounds receive gas.
    uint256 public constant MAX_CID_BYTES = 96;

    /// @notice Namespace of ids issued by this contract (the EVM chain id of the issuing chain).
    uint256 public immutable idPrefix;

    /// @notice Number of passports issued by this contract; the next id's sequence number.
    uint256 public mintedCount;

    mapping(uint256 tokenId => Passport) internal _passports;

    event PassportIssued(uint256 indexed tokenId, string cid);
    event PassportRevised(uint256 indexed tokenId, uint64 revision, string cid, address indexed author);
    event PassportImported(uint256 indexed tokenId, uint64 revision, string cid);

    error InvalidIdPrefix();
    error IdSpaceExhausted();
    error InvalidCid();
    /// @notice An incoming token carries an id of this contract's own namespace that it never issued.
    error UnissuedId(uint256 tokenId);
    /// @notice The caller bound a mint to an id that another mint has already taken (or that is not next).
    error UnexpectedTokenId(uint256 expected, uint256 actual);
    /// @notice The caller prepared a revision against a revision that is no longer the stored one.
    error StaleRevision(uint64 expected, uint64 actual);

    constructor(uint256 _idPrefix) {
        if (_idPrefix == 0) revert InvalidIdPrefix();
        idPrefix = _idPrefix;
    }

    /// @notice Id the next issued passport will receive.
    function nextTokenId() public view returns (uint256) {
        return idPrefix * ID_SPACE + mintedCount;
    }

    /// @notice Namespace (issuing chain id) a token id was issued in.
    function originOf(uint256 _tokenId) public pure returns (uint256) {
        return _tokenId / ID_SPACE;
    }

    /// @notice History hash after `_cid` is recorded as revision `_revision` of `_tokenId` on top of `_previous`
    /// (`bytes32(0)` for revision 0). Whoever has the CIDs of revisions 0..r can recompute the stored hash of
    /// revision r, so one read of `historyHash` on the chain that holds the token checks the whole history.
    function nextHistoryHash(
        bytes32 _previous,
        uint256 _tokenId,
        uint64 _revision,
        string memory _cid
    ) public pure returns (bytes32) {
        return keccak256(abi.encode(_previous, _tokenId, _revision, _cid));
    }

    /// @dev `_expectedTokenId` is the id the caller bound its payload to; the issue fails if another issue took it.
    function _issuePassport(uint256 _expectedTokenId, string calldata _cid) internal returns (uint256 tokenId) {
        _checkCid(_cid);
        if (mintedCount == ID_SPACE) revert IdSpaceExhausted();

        tokenId = nextTokenId();
        if (_expectedTokenId != tokenId) revert UnexpectedTokenId(_expectedTokenId, tokenId);
        mintedCount++;
        _passports[tokenId] = Passport(0, nextHistoryHash(bytes32(0), tokenId, 0, _cid), _cid);
        emit PassportIssued(tokenId, _cid);
    }

    /// @dev `_expectedRevision` is the revision the caller prepared the new payload against (optimistic concurrency):
    /// of two revisions prepared against the same revision, only the first succeeds.
    function _revisePassport(
        uint256 _tokenId,
        uint64 _expectedRevision,
        string calldata _cid,
        address _author
    ) internal {
        _checkCid(_cid);

        Passport storage passport = _passports[_tokenId];
        if (passport.revision != _expectedRevision) revert StaleRevision(_expectedRevision, passport.revision);
        uint64 revision = ++passport.revision;
        passport.historyHash = nextHistoryHash(passport.historyHash, _tokenId, revision, _cid);
        passport.cid = _cid;
        emit PassportRevised(_tokenId, revision, _cid, _author);
    }

    /// @dev Serialized passport state that travels with the token.
    function _exportPassport(uint256 _tokenId) internal view returns (bytes memory) {
        Passport storage passport = _passports[_tokenId];
        return abi.encode(passport.revision, passport.historyHash, passport.cid);
    }

    /// @dev Replaces the local snapshot with the state carried by an incoming token. Two checks refuse messages that a
    /// peer of this bytecode cannot send (it only sends ids it issued or received, with a CID it already validated), so
    /// they only matter against a forged message (the carried history hash is not re-checked, which a reader does):
    /// - an id of this contract's own namespace that it has not issued yet (`>= nextTokenId()`) would be minted by the
    ///   import and make every later `mint` collide with it;
    /// - a CID outside the length bounds would be stored although no entry point accepts it.
    /// Ids of other namespaces are not checked here: that rests on the peers being trusted (`lz:precheck`).
    function _importPassport(uint256 _tokenId, bytes memory _state) internal {
        if (originOf(_tokenId) == idPrefix && _tokenId >= nextTokenId()) revert UnissuedId(_tokenId);

        (uint64 revision, bytes32 historyHash, string memory cid) = abi.decode(_state, (uint64, bytes32, string));
        _checkCidLength(bytes(cid).length);
        _passports[_tokenId] = Passport(revision, historyHash, cid);
        emit PassportImported(_tokenId, revision, cid);
    }

    function _checkCid(string calldata _cid) private pure {
        _checkCidLength(bytes(_cid).length);
    }

    function _checkCidLength(uint256 _length) private pure {
        if (_length == 0 || _length > MAX_CID_BYTES) revert InvalidCid();
    }
}
