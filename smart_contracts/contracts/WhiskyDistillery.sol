// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.22;

import { Origin } from "@layerzerolabs/oapp-evm/contracts/oapp/OApp.sol";
import { IOAppMsgInspector } from "@layerzerolabs/oapp-evm/contracts/oapp/interfaces/IOAppMsgInspector.sol";
import { ONFT721 } from "@layerzerolabs/onft-evm/contracts/onft721/ONFT721.sol";
import { IONFT721, SendParam } from "@layerzerolabs/onft-evm/contracts/onft721/interfaces/IONFT721.sol";

import { PassportRegistry } from "./passport/PassportRegistry.sol";

/**
 * @title WhiskyDistillery
 * @notice Interoperable digital product passport (IDPP) as a LayerZero V2 ONFT721. One token is one passport at item,
 * batch or model level; the whisky distillery (casks, bottlings) is only the demonstrator.
 * @dev Moving a token burns it on the source and mints the same token id on the destination (stock ONFT721). The
 * message additionally carries the passport snapshot (revision, history hash, CID), so every chain can resolve the
 * passport of the tokens it holds. Token and data are separate rights: the holder owns the token (transfer, send),
 * only an issuer writes the passport (mint, revise), and the owner only configures (issuers, peers, base URI).
 * LayerZero authenticates the sending contract, not the truth of the passport data: data validity still depends on
 * the issuers, signatures and the physical-to-digital link.
 */
contract WhiskyDistillery is ONFT721, PassportRegistry {
    error ComposeNotSupported();
    /// @notice The caller is not an issuer on this chain.
    error NotIssuer(address account);
    error InvalidIssuer();

    event IssuerSet(address indexed account, bool authorized);

    /// @notice Version of this contract's message format, reported by `onftVersion`. Differs from the stock ONFT721
    /// format (version 1) and is derived from a name so it cannot collide with future stock versions.
    uint64 public constant MESSAGE_VERSION = uint64(bytes8(keccak256("WhiskyDistillery.message.v2")));

    /// @notice Accounts that may issue and revise passports on this chain, set by the owner.
    mapping(address account => bool) public isIssuer;

    modifier onlyIssuer() {
        if (!isIssuer[msg.sender]) revert NotIssuer(msg.sender);
        _;
    }

    /**
     * @param _name The ERC721 name.
     * @param _symbol The ERC721 symbol.
     * @param _idPrefix The id namespace of this chain (its EVM chain id); must differ between peers.
     * @param _lzEndpoint The LayerZero EndpointV2 address.
     * @param _delegate The owner and LayerZero delegate; it is not an issuer until `setIssuer` makes it one.
     */
    constructor(
        string memory _name,
        string memory _symbol,
        uint256 _idPrefix,
        address _lzEndpoint,
        address _delegate
    ) ONFT721(_name, _symbol, _lzEndpoint, _delegate) PassportRegistry(_idPrefix) {
        baseTokenURI = "ipfs://";
        emit BaseURISet(baseTokenURI);
    }

    /// @notice Grants or revokes the issuer role on this chain.
    function setIssuer(address _account, bool _authorized) external onlyOwner {
        if (_account == address(0)) revert InvalidIssuer();
        isIssuer[_account] = _authorized;
        emit IssuerSet(_account, _authorized);
    }

    /// @notice Issues a new passport with the next id of this chain's namespace.
    /// @param _expectedTokenId The id the payload under `_cid` was built for (`nextTokenId()` when it was read);
    /// reverts with `UnexpectedTokenId` if another mint took it first.
    function mint(
        address _to,
        uint256 _expectedTokenId,
        string calldata _cid
    ) external onlyIssuer returns (uint256 tokenId) {
        tokenId = _issuePassport(_expectedTokenId, _cid);
        _mint(_to, tokenId);
    }

    /// @notice Appends a revision to a passport held on this chain; the token id stays the same.
    /// @dev Issuers only: holding or being approved for the token gives no right to its data.
    /// @param _expectedRevision The revision the payload under `_cid` was prepared against; reverts with
    /// `StaleRevision` if the stored revision differs, so concurrent revisions cannot silently overwrite each other.
    function revise(uint256 _tokenId, uint64 _expectedRevision, string calldata _cid) external onlyIssuer {
        _requireOwned(_tokenId);
        _revisePassport(_tokenId, _expectedRevision, _cid, msg.sender);
    }

    /// @notice Current passport of a token held on this chain; reverts while the token is elsewhere or in flight.
    function passportOf(uint256 _tokenId) external view returns (Passport memory) {
        _requireOwned(_tokenId);
        return _passports[_tokenId];
    }

    /// @notice Data carrier URI of the current passport payload (base URI + CID).
    function tokenURI(uint256 _tokenId) public view override returns (string memory) {
        _requireOwned(_tokenId);
        return string.concat(_baseURI(), _passports[_tokenId].cid);
    }

    /**
     * @notice Interface and message format of this ONFT. The external interface is stock IONFT721; the message format is
     * not (it carries the passport), so only contracts reporting the same version may be peered.
     */
    function onftVersion() external pure override returns (bytes4 interfaceId, uint64 version) {
        return (type(IONFT721).interfaceId, MESSAGE_VERSION);
    }

    /**
     * @dev Message = abi.encode(to, tokenId, abi.encode(revision, historyHash, cid)). Runs after `_debit` has burned
     * the token; the burned token's snapshot stays in storage (not served by the views) and is overwritten if the token
     * returns.
     */
    function _buildMsgAndOptions(
        SendParam calldata _sendParam
    ) internal view override returns (bytes memory message, bytes memory options) {
        uint256 to = uint256(_sendParam.to);
        if (to >> 160 != 0 || uint160(to) == 0) revert InvalidReceiver();
        if (_sendParam.composeMsg.length > 0) revert ComposeNotSupported();

        message = abi.encode(_sendParam.to, _sendParam.tokenId, _exportPassport(_sendParam.tokenId));
        options = combineOptions(_sendParam.dstEid, SEND, _sendParam.extraOptions);

        address inspector = msgInspector;
        if (inspector != address(0)) IOAppMsgInspector(inspector).inspect(message, options);
    }

    /**
     * @dev Mints the token (stock `_credit`) and imports its passport. If the token already exists here, `_mint`
     * reverts and the message stays stored in the endpoint for retry.
     */
    function _lzReceive(
        Origin calldata _origin,
        bytes32 _guid,
        bytes calldata _message,
        address /*_executor*/,
        bytes calldata /*_extraData*/
    ) internal override {
        (bytes32 to, uint256 tokenId, bytes memory state) = abi.decode(_message, (bytes32, uint256, bytes));
        address toAddress = address(uint160(uint256(to)));

        _credit(toAddress, tokenId, _origin.srcEid);
        _importPassport(tokenId, state);

        emit ONFTReceived(_guid, _origin.srcEid, toAddress, tokenId);
    }
}
