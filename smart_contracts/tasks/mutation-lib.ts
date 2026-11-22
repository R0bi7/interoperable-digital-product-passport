// Hand-made mutants of the contracts. A mutant replaces one piece of source text by
// another; the Foundry suite must fail on it ("killed"). One that passes ("survived") is either a hole in the tests or
// an equivalent mutant; the script does not tell which, a person judges each survivor. Which test killed a mutant is
// recorded, so that "killed" can be read against the property the mutant breaks (`breaks`).

export type Mutant = {
    readonly id: string
    readonly file: string
    readonly from: string
    readonly to: string
    /** What the mutation breaks, in words. */
    readonly breaks: string
}

const REGISTRY = 'contracts/passport/PassportRegistry.sol'
const DISTILLERY = 'contracts/WhiskyDistillery.sol'

export const MUTANTS: readonly Mutant[] = [
    {
        id: 'M01',
        file: DISTILLERY,
        from: 'external onlyIssuer returns (uint256 tokenId)',
        to: 'external returns (uint256 tokenId)',
        breaks: 'anyone can mint',
    },
    {
        id: 'M02',
        file: DISTILLERY,
        from: 'string calldata _cid) external onlyIssuer {',
        to: 'string calldata _cid) external {',
        breaks: 'anyone can revise, the holder included',
    },
    {
        id: 'M03',
        file: DISTILLERY,
        from: 'if (_sendParam.composeMsg.length > 0) revert ComposeNotSupported();',
        to: '',
        breaks: 'compose messages accepted',
    },
    {
        id: 'M04',
        file: DISTILLERY,
        from: 'if (to >> 160 != 0 || uint160(to) == 0) revert InvalidReceiver();',
        to: '',
        breaks: 'invalid receivers accepted',
    },
    {
        id: 'M05',
        file: DISTILLERY,
        from: 'if (inspector != address(0)) IOAppMsgInspector(inspector).inspect(message, options);',
        to: '',
        breaks: 'the message inspector is never called (former survivor)',
    },
    {
        id: 'M06',
        file: DISTILLERY,
        from: 'emit ONFTReceived(_guid, _origin.srcEid, toAddress, tokenId);',
        to: '',
        breaks: 'no ONFTReceived on delivery (former survivor)',
    },
    {
        id: 'M07',
        file: DISTILLERY,
        from: '_mint(_to, tokenId);',
        to: '_safeMint(_to, tokenId);',
        breaks: 'minting to a contract without receiver reverts (former survivor)',
    },
    {
        id: 'M08',
        file: DISTILLERY,
        from: 'baseTokenURI = "ipfs://";',
        to: 'baseTokenURI = "ipfs:/";',
        breaks: 'wrong default base URI',
    },
    {
        id: 'M09',
        file: DISTILLERY,
        from: 'return string.concat(_baseURI(), _passports[_tokenId].cid);',
        to: 'return _passports[_tokenId].cid;',
        breaks: 'tokenURI without the base URI',
    },
    {
        id: 'M10',
        file: DISTILLERY,
        from: 'function passportOf(uint256 _tokenId) external view returns (Passport memory) {\n        _requireOwned(_tokenId);',
        to: 'function passportOf(uint256 _tokenId) external view returns (Passport memory) {',
        breaks: 'the source serves the passport of a token that left',
    },
    {
        id: 'M11',
        file: REGISTRY,
        from: '        emit PassportIssued(tokenId, _cid);',
        to: '',
        breaks: 'no PassportIssued (former survivor)',
    },
    {
        id: 'M12',
        file: REGISTRY,
        from: 'emit PassportRevised(_tokenId, revision, _cid, _author);',
        to: '',
        breaks: 'no PassportRevised',
    },
    {
        id: 'M13',
        file: REGISTRY,
        from: 'emit PassportImported(_tokenId, revision, cid);',
        to: '',
        breaks: 'no PassportImported',
    },
    { id: 'M14', file: REGISTRY, from: '        mintedCount++;\n', to: '', breaks: 'ids are never advanced' },
    {
        id: 'M15',
        file: REGISTRY,
        from: 'if (mintedCount == ID_SPACE) revert IdSpaceExhausted();',
        to: '',
        breaks: 'the namespace can overflow into the next chain',
    },
    {
        id: 'M16',
        file: REGISTRY,
        from: 'if (_expectedTokenId != tokenId) revert UnexpectedTokenId(_expectedTokenId, tokenId);',
        to: '',
        breaks: 'mint ignores the id the payload was built for',
    },
    {
        id: 'M17',
        file: REGISTRY,
        from: 'if (passport.revision != _expectedRevision) revert StaleRevision(_expectedRevision, passport.revision);',
        to: '',
        breaks: 'revise ignores the revision the payload was built for',
    },
    {
        id: 'M18',
        file: REGISTRY,
        from: 'uint64 revision = ++passport.revision;',
        to: 'uint64 revision = passport.revision;',
        breaks: 'revise does not advance the revision',
    },
    {
        id: 'M19',
        file: REGISTRY,
        from: 'if (_length == 0 || _length > MAX_CID_BYTES) revert InvalidCid();',
        to: 'if (_length > MAX_CID_BYTES) revert InvalidCid();',
        breaks: 'empty CIDs accepted',
    },
    {
        id: 'M20',
        file: REGISTRY,
        from: 'if (_length == 0 || _length > MAX_CID_BYTES) revert InvalidCid();',
        to: 'if (_length == 0 || _length >= MAX_CID_BYTES) revert InvalidCid();',
        breaks: 'the longest legal CID rejected (off by one)',
    },
    {
        id: 'M21',
        file: REGISTRY,
        from: 'if (originOf(_tokenId) == idPrefix && _tokenId >= nextTokenId()) revert UnissuedId(_tokenId);',
        to: '',
        breaks: 'import accepts an id this chain never issued (S1)',
    },
    {
        id: 'M22',
        file: REGISTRY,
        from: '_tokenId >= nextTokenId()) revert UnissuedId',
        to: '_tokenId > nextTokenId()) revert UnissuedId',
        breaks: 'import accepts the next id to be issued (S1, off by one)',
    },
    {
        id: 'M23',
        file: REGISTRY,
        from: '        _checkCidLength(bytes(cid).length);\n        _passports',
        to: '        _passports',
        breaks: 'import accepts an invalid CID (S5)',
    },
    {
        id: 'M24',
        file: REGISTRY,
        from: 'return idPrefix * ID_SPACE + mintedCount;',
        to: 'return idPrefix * ID_SPACE + mintedCount + 1;',
        breaks: 'nextTokenId is wrong',
    },
    {
        id: 'M25',
        file: REGISTRY,
        from: 'return _tokenId / ID_SPACE;',
        to: 'return _tokenId % ID_SPACE;',
        breaks: 'originOf is wrong',
    },
    {
        id: 'M26',
        file: DISTILLERY,
        from: 'function setIssuer(address _account, bool _authorized) external onlyOwner {',
        to: 'function setIssuer(address _account, bool _authorized) external {',
        breaks: 'anyone can make itself an issuer',
    },
    {
        id: 'M27',
        file: DISTILLERY,
        from: '        _requireOwned(_tokenId);\n        _revisePassport',
        to: '        _revisePassport',
        breaks: 'an issuer revises the stale snapshot of a token that left',
    },
    {
        id: 'M28',
        file: REGISTRY,
        from: '        passport.historyHash = nextHistoryHash(passport.historyHash, _tokenId, revision, _cid);\n',
        to: '',
        breaks: 'a revision does not extend the history hash (P8)',
    },
    {
        id: 'M29',
        file: REGISTRY,
        from: 'return keccak256(abi.encode(_previous, _tokenId, _revision, _cid));',
        to: 'return keccak256(abi.encode(_previous, _revision, _cid));',
        breaks: 'the history hash is not bound to the token id (P8)',
    },
    {
        id: 'M30',
        file: REGISTRY,
        from: '_passports[_tokenId] = Passport(revision, historyHash, cid);',
        to: '_passports[_tokenId] = Passport(revision, bytes32(0), cid);',
        breaks: 'the history hash is lost on import (P8)',
    },
]

/** The source with the mutation applied, once. Throws if the text to replace is not there exactly once. */
export function applyMutant(source: string, mutant: Mutant): string {
    const first = source.indexOf(mutant.from)
    if (first < 0) throw new Error(`${mutant.id}: the text to mutate is not in ${mutant.file} any more`)
    if (source.indexOf(mutant.from, first + 1) >= 0)
        throw new Error(`${mutant.id}: the text to mutate occurs more than once`)
    return source.slice(0, first) + mutant.to + source.slice(first + mutant.from.length)
}
