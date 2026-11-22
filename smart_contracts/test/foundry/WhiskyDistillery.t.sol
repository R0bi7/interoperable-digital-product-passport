// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.22;

// Contract imports
import { WhiskyDistillery } from "../../contracts/WhiskyDistillery.sol";
import { PassportRegistry } from "../../contracts/passport/PassportRegistry.sol";

// OApp imports
import { EnforcedOptionParam } from "@layerzerolabs/oapp-evm/contracts/oapp/libs/OAppOptionsType3.sol";
import { OptionsBuilder } from "@layerzerolabs/oapp-evm/contracts/oapp/libs/OptionsBuilder.sol";
import { IOAppCore } from "@layerzerolabs/oapp-evm/contracts/oapp/interfaces/IOAppCore.sol";
import { OAppReceiver } from "@layerzerolabs/oapp-evm/contracts/oapp/OAppReceiver.sol";
import { IOAppMsgInspector } from "@layerzerolabs/oapp-evm/contracts/oapp/interfaces/IOAppMsgInspector.sol";

// ONFT imports
import { IONFT721, SendParam } from "@layerzerolabs/onft-evm/contracts/onft721/interfaces/IONFT721.sol";
import { ONFT721Core, MessagingFee, MessagingReceipt } from "@layerzerolabs/onft-evm/contracts/onft721/ONFT721Core.sol";

// Protocol imports
import { ILayerZeroEndpointV2, Origin } from "@layerzerolabs/lz-evm-protocol-v2/contracts/interfaces/ILayerZeroEndpointV2.sol";
import { Errors } from "@layerzerolabs/lz-evm-protocol-v2/contracts/libs/Errors.sol";

// OZ imports
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { IERC721Errors } from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";

// Forge imports
import "forge-std/console.sol";
import { Vm } from "forge-std/Vm.sol";
import { stdStorage, StdStorage } from "forge-std/Test.sol";

// DevTools imports
import { TestHelperOz5 } from "@layerzerolabs/test-devtools-evm-foundry/contracts/TestHelperOz5.sol";

/**
 * @dev Two chains (A, B) on TestHelperOz5's EndpointV2 / ULN302 / DVN / Executor stack. Test names carry the
 * property they evidence (P1-P8). This test contract is the owner and, from `setUp`,
 * an issuer on both chains; alice, bob and mallory are holders without any role.
 */
contract WhiskyDistilleryTest is TestHelperOz5 {
    using OptionsBuilder for bytes;
    using stdStorage for StdStorage;

    uint32 private constant A_EID = 1;
    uint32 private constant B_EID = 2;
    uint256 private constant A_PREFIX = 421614; // Arbitrum Sepolia chain id
    uint256 private constant B_PREFIX = 84532; // Base Sepolia chain id

    // Enforced lzReceive gas of the SEND message type, as in layerzero.config.ts; the Gas tests check it suffices.
    uint128 private constant RECEIVE_GAS = 286_000;

    string private constant CID_V0 = "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG"; // 46 bytes
    string private constant CID_V1 = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi"; // 59 bytes
    string private constant CID_V1_B = "bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku"; // 59 bytes

    event BaseURISet(string baseURI);
    event IssuerSet(address indexed account, bool authorized);

    WhiskyDistillery private a;
    WhiskyDistillery private b;

    address private alice = makeAddr("alice");
    address private bob = makeAddr("bob");
    address private mallory = makeAddr("mallory");
    address private carol = makeAddr("carol"); // a second issuer, granted where a test needs one

    function setUp() public virtual override {
        vm.deal(alice, 1000 ether);
        vm.deal(bob, 1000 ether);
        vm.deal(mallory, 1000 ether);

        super.setUp();
        setUpEndpoints(2, LibraryType.UltraLightNode);

        a = WhiskyDistillery(_deployOApp(type(WhiskyDistillery).creationCode, _ctorArgs(A_PREFIX, A_EID)));
        b = WhiskyDistillery(_deployOApp(type(WhiskyDistillery).creationCode, _ctorArgs(B_PREFIX, B_EID)));

        address[] memory onfts = new address[](2);
        onfts[0] = address(a);
        onfts[1] = address(b);
        this.wireOApps(onfts);

        _enforceReceiveGas(a, B_EID);
        _enforceReceiveGas(b, A_EID);

        a.setIssuer(address(this), true);
        b.setIssuer(address(this), true);
    }

    // ---------------------------------------------------------------- P1 uniqueness

    function test_P1_idsAreSequentialInTheChainNamespace() public {
        assertEq(a.nextTokenId(), A_PREFIX * 1e12);

        uint256 first = _mint(a, alice, CID_V0);
        uint256 second = _mint(a, alice, CID_V1);
        uint256 onB = _mint(b, bob, CID_V0);

        assertEq(first, A_PREFIX * 1e12);
        assertEq(second, A_PREFIX * 1e12 + 1);
        assertEq(onB, B_PREFIX * 1e12);
        assertEq(a.mintedCount(), 2);
        assertEq(a.originOf(second), A_PREFIX);
        assertEq(b.originOf(onB), B_PREFIX);
    }

    function testFuzz_P1_namespacesAreDisjoint(uint256 _seqA, uint256 _seqB) public {
        _seqA = bound(_seqA, 0, a.ID_SPACE() - 1);
        _seqB = bound(_seqB, 0, b.ID_SPACE() - 1);
        stdstore.target(address(a)).sig(a.mintedCount.selector).checked_write(_seqA);
        stdstore.target(address(b)).sig(b.mintedCount.selector).checked_write(_seqB);

        uint256 idA = _mint(a, alice, CID_V0);
        uint256 idB = _mint(b, bob, CID_V0);

        assertTrue(idA != idB);
        assertEq(a.originOf(idA), A_PREFIX);
        assertEq(b.originOf(idB), B_PREFIX);
    }

    function test_P1_revertsWhenTheNamespaceIsExhausted() public {
        stdstore.target(address(a)).sig(a.mintedCount.selector).checked_write(a.ID_SPACE() - 1);

        uint256 last = _mint(a, alice, CID_V0);
        assertEq(last, A_PREFIX * 1e12 + a.ID_SPACE() - 1);
        assertEq(a.originOf(last), A_PREFIX);

        uint256 next = a.nextTokenId();
        vm.expectRevert(PassportRegistry.IdSpaceExhausted.selector);
        a.mint(alice, next, CID_V0);
    }

    function test_P1_rejectsZeroPrefix() public {
        vm.expectRevert(PassportRegistry.InvalidIdPrefix.selector);
        new WhiskyDistillery("WhiskyDistillery", "IDPP", 0, endpoints[A_EID], address(this));
    }

    // ---------------------------------------------------------------- P2 no duplicate supply

    function test_P2_tokenExistsOnExactlyOneChainOrIsInFlight() public {
        uint256 id = _mint(a, alice, CID_V0);
        assertTrue(_exists(a, id));
        assertFalse(_exists(b, id));

        _send(a, alice, B_EID, bob, id);
        assertFalse(_exists(a, id)); // burned on A
        assertFalse(_exists(b, id)); // in flight

        verifyPackets(B_EID, addressToBytes32(address(b)));
        assertFalse(_exists(a, id));
        assertEq(b.ownerOf(id), bob);
        assertEq(a.balanceOf(alice) + b.balanceOf(bob), 1);
    }

    function test_P2_roundTripKeepsTheTokenId() public {
        uint256 id = _mint(a, alice, CID_V0);

        _send(a, alice, B_EID, bob, id);
        verifyPackets(B_EID, addressToBytes32(address(b)));
        _send(b, bob, A_EID, alice, id);
        verifyPackets(A_EID, addressToBytes32(address(a)));

        assertEq(a.ownerOf(id), alice);
        assertFalse(_exists(b, id));
        assertEq(a.originOf(id), A_PREFIX);
    }

    // ---------------------------------------------------------------- P3 authorization

    function test_P3_onlyIssuersMint() public {
        uint256 next = a.nextTokenId();
        vm.prank(mallory);
        vm.expectRevert(abi.encodeWithSelector(WhiskyDistillery.NotIssuer.selector, mallory));
        a.mint(mallory, next, CID_V0);

        // the owner mints only while it holds the issuer role
        a.setIssuer(address(this), false);
        vm.expectRevert(abi.encodeWithSelector(WhiskyDistillery.NotIssuer.selector, address(this)));
        a.mint(alice, next, CID_V0);

        // an issuer that is not the owner mints
        a.setIssuer(carol, true);
        vm.prank(carol);
        assertEq(a.mint(alice, next, CID_V0), next);
        assertEq(a.ownerOf(next), alice);
    }

    function test_P3_onlyIssuersRevise() public {
        uint256 id = _mint(a, alice, CID_V0);
        vm.startPrank(alice);
        a.approve(bob, id);
        a.setApprovalForAll(mallory, true);
        vm.stopPrank();

        // holding the token, or being approved for it, gives no right to its passport
        address[3] memory refused = [alice, bob, mallory];
        for (uint256 i = 0; i < refused.length; i++) {
            vm.prank(refused[i]);
            vm.expectRevert(abi.encodeWithSelector(WhiskyDistillery.NotIssuer.selector, refused[i]));
            a.revise(id, 0, CID_V1);
        }

        a.revise(id, 0, CID_V1);
        a.setIssuer(carol, true);
        vm.prank(carol);
        a.revise(id, 1, CID_V1_B);

        assertEq(a.passportOf(id).revision, 2);
        assertEq(a.passportOf(id).cid, CID_V1_B);
        assertEq(a.ownerOf(id), alice); // a revision does not touch ownership
    }

    function test_P3_onlyOwnerSetsIssuers() public {
        vm.prank(mallory);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, mallory));
        a.setIssuer(mallory, true);

        vm.expectRevert(WhiskyDistillery.InvalidIssuer.selector);
        a.setIssuer(address(0), true);

        vm.expectEmit(address(a));
        emit IssuerSet(carol, true);
        a.setIssuer(carol, true);
        assertTrue(a.isIssuer(carol));
        assertFalse(b.isIssuer(carol)); // the role is per chain

        vm.expectEmit(address(a));
        emit IssuerSet(carol, false);
        a.setIssuer(carol, false);
        assertFalse(a.isIssuer(carol));
    }

    function test_P3_onlyHolderSends() public {
        uint256 id = _mint(a, alice, CID_V0);
        vm.prank(alice);
        a.approve(bob, id);

        SendParam memory sendParam = _sendParam(B_EID, mallory, id);
        MessagingFee memory fee = a.quoteSend(sendParam, false);

        // stock ONFT721 `_debit`: an approved operator may transfer but not send
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(IONFT721.OnlyNFTOwner.selector, bob, alice));
        a.send{ value: fee.nativeFee }(sendParam, fee, bob);

        vm.prank(mallory);
        vm.expectRevert(abi.encodeWithSelector(IONFT721.OnlyNFTOwner.selector, mallory, alice));
        a.send{ value: fee.nativeFee }(sendParam, fee, mallory);
    }

    function test_P3_cannotReviseATokenThatLeftTheChain() public {
        uint256 id = _mint(a, alice, CID_V0);
        _send(a, alice, B_EID, bob, id);

        // not even an issuer: the snapshot left on A is stale
        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721NonexistentToken.selector, id));
        a.revise(id, 0, CID_V1);
    }

    function test_P3_lzReceiveOnlyFromEndpoint() public {
        Origin memory origin = Origin(A_EID, addressToBytes32(address(a)), 1);
        bytes memory message = _encodeMessage(mallory, A_PREFIX * 1e12, 0, bytes32(0), CID_V0);

        vm.prank(mallory);
        vm.expectRevert(abi.encodeWithSelector(OAppReceiver.OnlyEndpoint.selector, mallory));
        b.lzReceive(origin, bytes32(0), message, mallory, "");
    }

    function test_P3_lzReceiveOnlyFromPeer() public {
        Origin memory origin = Origin(A_EID, addressToBytes32(mallory), 1);
        bytes memory message = _encodeMessage(mallory, A_PREFIX * 1e12, 0, bytes32(0), CID_V0);

        vm.prank(endpoints[B_EID]);
        vm.expectRevert(abi.encodeWithSelector(IOAppCore.OnlyPeer.selector, A_EID, addressToBytes32(mallory)));
        b.lzReceive(origin, bytes32(0), message, mallory, "");
    }

    function test_P3_onlyOwnerConfigures() public {
        bytes memory unauthorized = abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, mallory);
        EnforcedOptionParam[] memory params = new EnforcedOptionParam[](0);

        vm.startPrank(mallory);
        vm.expectRevert(unauthorized);
        a.setPeer(B_EID, addressToBytes32(mallory));
        vm.expectRevert(unauthorized);
        a.setBaseURI("https://evil.example/");
        vm.expectRevert(unauthorized);
        a.setMsgInspector(mallory);
        vm.expectRevert(unauthorized);
        a.setEnforcedOptions(params);
        vm.expectRevert(unauthorized);
        a.setDelegate(mallory);
        vm.stopPrank();
    }

    // ---------------------------------------------------------------- P4 replay resistance

    function test_P4_deliveredPacketCannotBeReplayed() public {
        uint256 id = _mint(a, alice, CID_V0);
        MessagingReceipt memory receipt = _send(a, alice, B_EID, bob, id);
        verifyPackets(B_EID, addressToBytes32(address(b)));

        Origin memory origin = Origin(A_EID, addressToBytes32(address(a)), receipt.nonce);
        bytes memory message = _encodeMessage(bob, id, 0, _issuedHash(id, CID_V0), CID_V0);

        vm.prank(mallory);
        vm.expectRevert(
            abi.encodeWithSelector(
                Errors.LZ_PayloadHashNotFound.selector,
                bytes32(0),
                keccak256(abi.encodePacked(receipt.guid, message))
            )
        );
        ILayerZeroEndpointV2(endpoints[B_EID]).lzReceive(origin, address(b), receipt.guid, message, "");

        assertEq(b.ownerOf(id), bob);
        assertEq(b.balanceOf(bob), 1);
    }

    // ---------------------------------------------------------------- P5 destination metadata resolution

    function test_P5_destinationResolvesTheCarriedPassport() public {
        uint256 id = _mint(a, alice, CID_V0);
        a.revise(id, 0, CID_V1);

        _send(a, alice, B_EID, bob, id);
        vm.expectEmit(address(b));
        emit PassportRegistry.PassportImported(id, 1, CID_V1);
        this.verifyPackets(B_EID, addressToBytes32(address(b)));

        PassportRegistry.Passport memory passport = b.passportOf(id);
        assertEq(passport.revision, 1);
        assertEq(passport.cid, CID_V1);
        assertEq(passport.historyHash, _hashOf(id, _cids(CID_V0, CID_V1)));
        assertEq(b.tokenURI(id), string.concat("ipfs://", CID_V1));

        // the source keeps no servable copy
        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721NonexistentToken.selector, id));
        a.passportOf(id);
        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721NonexistentToken.selector, id));
        a.tokenURI(id);
    }

    function test_P5_revisionMadeOnTheDestinationTravelsBack() public {
        uint256 id = _mint(a, alice, CID_V0);
        a.revise(id, 0, CID_V1);
        _send(a, alice, B_EID, bob, id);
        verifyPackets(B_EID, addressToBytes32(address(b)));

        vm.expectEmit(address(b));
        emit PassportRegistry.PassportRevised(id, 2, CID_V1_B, address(this));
        b.revise(id, 1, CID_V1_B);

        _send(b, bob, A_EID, alice, id);
        verifyPackets(A_EID, addressToBytes32(address(a)));

        PassportRegistry.Passport memory passport = a.passportOf(id);
        assertEq(passport.revision, 2);
        assertEq(passport.cid, CID_V1_B);
        assertEq(a.tokenURI(id), string.concat("ipfs://", CID_V1_B));
    }

    // ---------------------------------------------------------------- P6 recovery from failed messages

    function test_P6_failedDeliveryStaysStoredAndCanBeRetried() public {
        uint256 id = _mint(a, alice, CID_V0);
        MessagingReceipt memory receipt = _send(a, alice, B_EID, bob, id);

        // DVN verification and commit, without execution
        this.validatePacket(getNextInflightPacket(uint16(B_EID), addressToBytes32(address(b))), "");

        Origin memory origin = Origin(A_EID, addressToBytes32(address(a)), receipt.nonce);
        bytes memory message = _encodeMessage(bob, id, 0, _issuedHash(id, CID_V0), CID_V0);
        bytes32 payloadHash = keccak256(abi.encodePacked(receipt.guid, message));
        ILayerZeroEndpointV2 endpointB = ILayerZeroEndpointV2(endpoints[B_EID]);
        assertEq(endpointB.inboundPayloadHash(address(b), A_EID, origin.sender, origin.nonce), payloadHash);

        // execution with too little gas fails; the payload stays committed and the token exists nowhere
        assertFalse(_deliver(origin, receipt.guid, message, 60_000));
        assertEq(endpointB.inboundPayloadHash(address(b), A_EID, origin.sender, origin.nonce), payloadHash);
        assertFalse(_exists(a, id));
        assertFalse(_exists(b, id));

        // anyone can retry with enough gas
        vm.prank(mallory);
        endpointB.lzReceive{ gas: RECEIVE_GAS }(origin, address(b), receipt.guid, message, "");

        assertEq(b.ownerOf(id), bob);
        assertEq(b.passportOf(id).cid, CID_V0);
        assertEq(endpointB.inboundPayloadHash(address(b), A_EID, origin.sender, origin.nonce), bytes32(0));

        // and the retried packet cannot be executed again
        assertFalse(_deliver(origin, receipt.guid, message, RECEIVE_GAS));
    }

    // ---------------------------------------------------------------- P7 optimistic concurrency

    function test_P7_mintRejectsUnexpectedTokenId() public {
        uint256 expected = a.nextTokenId();

        // an id that is not next yet
        vm.expectRevert(abi.encodeWithSelector(PassportRegistry.UnexpectedTokenId.selector, expected + 1, expected));
        a.mint(alice, expected + 1, CID_V0);

        // two mints bound to the same id: the first takes it, the second reverts and changes nothing
        assertEq(a.mint(alice, expected, CID_V0), expected);
        vm.expectRevert(abi.encodeWithSelector(PassportRegistry.UnexpectedTokenId.selector, expected, expected + 1));
        a.mint(bob, expected, CID_V1);

        assertEq(a.mintedCount(), 1);
        assertEq(a.ownerOf(expected), alice);
        assertEq(a.passportOf(expected).cid, CID_V0);
        assertFalse(_exists(a, expected + 1));
    }

    function test_P7_reviseRejectsStaleRevision() public {
        uint256 id = _mint(a, alice, CID_V0);

        vm.expectRevert(abi.encodeWithSelector(PassportRegistry.StaleRevision.selector, 1, 0));
        a.revise(id, 1, CID_V1);

        a.revise(id, 0, CID_V1);
        vm.expectRevert(abi.encodeWithSelector(PassportRegistry.StaleRevision.selector, 0, 1));
        a.revise(id, 0, CID_V1_B);

        assertEq(a.passportOf(id).revision, 1);
        assertEq(a.passportOf(id).cid, CID_V1);
    }

    function test_P7_concurrentRevisionsOneSucceedsOneReverts() public {
        uint256 id = _mint(a, alice, CID_V0);
        a.revise(id, 0, CID_V1);
        a.setIssuer(carol, true);

        // two issuers both prepare a revision against r
        uint64 r = a.passportOf(id).revision;

        vm.expectEmit(address(a));
        emit PassportRegistry.PassportRevised(id, r + 1, CID_V1_B, address(this));
        a.revise(id, r, CID_V1_B);

        vm.prank(carol);
        vm.expectRevert(abi.encodeWithSelector(PassportRegistry.StaleRevision.selector, r, r + 1));
        a.revise(id, r, CID_V0);

        PassportRegistry.Passport memory passport = a.passportOf(id);
        assertEq(passport.revision, r + 1);
        assertEq(passport.cid, CID_V1_B);
    }

    function test_P7_oldSelectorsDoNotExist() public {
        uint256 id = _mint(a, alice, CID_V0);

        // as an issuer, so that only the missing selector can make the call fail
        (bool ok, bytes memory data) = address(a).call(abi.encodeWithSignature("mint(address,string)", alice, CID_V1));
        assertFalse(ok, "unchecked mint(address,string) must not exist");
        assertEq(data.length, 0);

        (ok, data) = address(a).call(abi.encodeWithSignature("revise(uint256,string)", id, CID_V1));
        assertFalse(ok, "unchecked revise(uint256,string) must not exist");
        assertEq(data.length, 0);

        assertEq(a.mintedCount(), 1);
        assertEq(a.passportOf(id).revision, 0);
        assertEq(a.passportOf(id).cid, CID_V0);
    }

    // ---------------------------------------------------------------- input validation

    function test_mintAndReviseRejectInvalidCids() public {
        string memory tooLong = _cidOfLength(a.MAX_CID_BYTES() + 1);
        uint256 next = a.nextTokenId();

        vm.expectRevert(PassportRegistry.InvalidCid.selector);
        a.mint(alice, next, "");
        vm.expectRevert(PassportRegistry.InvalidCid.selector);
        a.mint(alice, next, tooLong);

        uint256 id = _mint(a, alice, CID_V0);
        vm.expectRevert(PassportRegistry.InvalidCid.selector);
        a.revise(id, 0, "");
        vm.expectRevert(PassportRegistry.InvalidCid.selector);
        a.revise(id, 0, tooLong);
    }

    function test_onftVersionReportsTheOwnMessageFormat() public view {
        (bytes4 interfaceId, uint64 version) = a.onftVersion();
        assertEq(interfaceId, type(IONFT721).interfaceId);
        assertEq(version, uint64(bytes8(keccak256("WhiskyDistillery.message.v2"))));
        assertTrue(version != 1, "must differ from the stock ONFT721 message format");
    }

    function test_sendRejectsInvalidReceiversAndCompose() public {
        uint256 id = _mint(a, alice, CID_V0);

        SendParam memory zeroReceiver = _sendParam(B_EID, address(0), id);
        vm.expectRevert(IONFT721.InvalidReceiver.selector);
        a.quoteSend(zeroReceiver, false);

        SendParam memory dirtyReceiver = _sendParam(B_EID, bob, id);
        dirtyReceiver.to = bytes32(uint256(uint160(bob)) | (uint256(1) << 160));
        vm.expectRevert(IONFT721.InvalidReceiver.selector);
        a.quoteSend(dirtyReceiver, false);

        SendParam memory withCompose = _sendParam(B_EID, bob, id);
        withCompose.composeMsg = hex"1234";
        vm.expectRevert(WhiskyDistillery.ComposeNotSupported.selector);
        a.quoteSend(withCompose, false);
    }

    // ---------------------------------------------------------------- import validation (S1, S4, S5)

    function test_S1_importRejectsAnIdOfTheOwnNamespaceThatWasNeverIssued() public {
        uint256 next = b.nextTokenId();
        uint256[3] memory forged = [next, next + 5, B_PREFIX * 1e12 + b.ID_SPACE() - 1];

        for (uint256 i = 0; i < forged.length; i++) {
            vm.expectRevert(abi.encodeWithSelector(PassportRegistry.UnissuedId.selector, forged[i]));
            _forgedDelivery(bob, forged[i], 0, CID_V0);
            assertFalse(_exists(b, forged[i]));
        }

        // the squat did not move the counter: the next legitimate mint still gets the id it was bound to
        assertEq(b.nextTokenId(), next);
        assertEq(_mint(b, bob, CID_V1), next);
    }

    function test_S1_importAcceptsTheIdsTheChainIssued() public {
        uint256 first = _mint(a, alice, CID_V0);
        uint256 middle = _mint(a, alice, CID_V0);
        uint256 last = _mint(a, alice, CID_V1); // the highest id issued so far: sequence = mintedCount - 1
        assertEq(last, a.nextTokenId() - 1);

        uint256[3] memory ids = [first, middle, last];
        for (uint256 i = 0; i < ids.length; i++) {
            _send(a, alice, B_EID, bob, ids[i]);
            verifyPackets(B_EID, addressToBytes32(address(b)));
            _send(b, bob, A_EID, alice, ids[i]);
            verifyPackets(A_EID, addressToBytes32(address(a)));
            assertEq(a.ownerOf(ids[i]), alice);
        }
        assertEq(a.balanceOf(alice), 3);
        assertEq(a.mintedCount(), 3);
    }

    /// @dev Pins the part of the peer-compatibility assumption the receiver does not check: an id of another namespace
    /// is accepted whatever its sequence, so a forging peer can still pose as another chain.
    function test_S1_importStillTrustsIdsOfOtherNamespaces() public {
        uint256 fromA = A_PREFIX * 1e12 + 7;
        uint256 fromElsewhere = uint256(1) * 1e12 + 3;

        _forgedDelivery(bob, fromA, 4, CID_V1);
        _forgedDelivery(bob, fromElsewhere, 0, CID_V0);

        assertEq(b.ownerOf(fromA), bob);
        assertEq(b.passportOf(fromA).revision, 4);
        assertEq(b.ownerOf(fromElsewhere), bob);
        assertEq(b.mintedCount(), 0);
    }

    function test_S5_importRejectsAnInvalidCid() public {
        uint256 id = A_PREFIX * 1e12;
        uint256 max = b.MAX_CID_BYTES();

        vm.expectRevert(PassportRegistry.InvalidCid.selector);
        _forgedDelivery(bob, id, 0, "");
        vm.expectRevert(PassportRegistry.InvalidCid.selector);
        _forgedDelivery(bob, id, 0, _cidOfLength(max + 1));
        assertFalse(_exists(b, id));

        // the boundary values are accepted, as on the source
        _forgedDelivery(bob, id, 0, _cidOfLength(1));
        _forgedDelivery(bob, id + 1, 0, _cidOfLength(max));
        assertEq(b.passportOf(id + 1).cid, _cidOfLength(max));
    }

    /// @dev S4: the stock `_mint` refuses an id that already exists. The message stays stored in the endpoint (not
    /// executable), and only the delegate can clear it, which leaves the burned source token burned.
    function test_S4_importOfAnExistingIdFailsClosedAndTheMessageStaysStored() public {
        uint256 id = _mint(a, alice, CID_V0);
        MessagingReceipt memory receipt = _send(a, alice, B_EID, bob, id);
        this.validatePacket(getNextInflightPacket(uint16(B_EID), addressToBytes32(address(b))), "");

        // a forging peer got the same id onto B first, with another holder and another passport
        _forgedDelivery(mallory, id, 3, CID_V1_B);

        Origin memory origin = Origin(A_EID, addressToBytes32(address(a)), receipt.nonce);
        bytes memory message = _encodeMessage(bob, id, 0, _issuedHash(id, CID_V0), CID_V0);
        ILayerZeroEndpointV2 endpointB = ILayerZeroEndpointV2(endpoints[B_EID]);
        bytes32 payloadHash = keccak256(abi.encodePacked(receipt.guid, message));

        assertFalse(_deliver(origin, receipt.guid, message, RECEIVE_GAS));
        assertEq(endpointB.inboundPayloadHash(address(b), A_EID, origin.sender, origin.nonce), payloadHash);
        assertEq(b.ownerOf(id), mallory); // untouched
        assertEq(b.passportOf(id).revision, 3);
        assertFalse(_exists(a, id)); // burned at the source and not delivered: the only way out is skip or clear

        vm.prank(mallory);
        vm.expectRevert(Errors.LZ_Unauthorized.selector);
        endpointB.clear(address(b), origin, receipt.guid, message);

        endpointB.clear(address(b), origin, receipt.guid, message); // this test contract is the delegate
        assertEq(endpointB.inboundPayloadHash(address(b), A_EID, origin.sender, origin.nonce), bytes32(0));
        assertFalse(_deliver(origin, receipt.guid, message, RECEIVE_GAS));
        assertEq(b.ownerOf(id), mallory);
        assertFalse(_exists(a, id));
    }

    // ---------------------------------------------------------------- P8 history commitment

    function test_P8_historyHashCommitsToEveryRevisionInOrder() public {
        uint256 id = _mint(a, alice, CID_V0);
        assertEq(a.passportOf(id).historyHash, _hashOf(id, _cids(CID_V0)));

        a.revise(id, 0, CID_V1);
        a.revise(id, 1, CID_V1_B);
        bytes32 stored = a.passportOf(id).historyHash;
        assertEq(stored, _hashOf(id, _cids(CID_V0, CID_V1, CID_V1_B)));

        // a reader who is shown a different history gets a different hash: an omitted, reordered or replaced
        // revision, or the same CIDs under another token id
        assertTrue(stored != _hashOf(id, _cids(CID_V0, CID_V1_B)));
        assertTrue(stored != _hashOf(id, _cids(CID_V0, CID_V1_B, CID_V1)));
        assertTrue(stored != _hashOf(id, _cids(CID_V0, CID_V0, CID_V1_B)));
        assertTrue(stored != _hashOf(id + 1, _cids(CID_V0, CID_V1, CID_V1_B)));

        // the public helper is the recurrence the reader applies
        bytes32 h = a.nextHistoryHash(bytes32(0), id, 0, CID_V0);
        h = a.nextHistoryHash(h, id, 1, CID_V1);
        assertEq(a.nextHistoryHash(h, id, 2, CID_V1_B), stored);
    }

    function test_P8_historyHashTravelsAndRevisionsOnAnyChainExtendIt() public {
        uint256 id = _mint(a, alice, CID_V0);
        a.revise(id, 0, CID_V1);
        _send(a, alice, B_EID, bob, id);
        verifyPackets(B_EID, addressToBytes32(address(b)));
        assertEq(b.passportOf(id).historyHash, _hashOf(id, _cids(CID_V0, CID_V1)));

        b.revise(id, 1, CID_V1_B);
        _send(b, bob, A_EID, alice, id);
        verifyPackets(A_EID, addressToBytes32(address(a)));

        // one read on the chain that now holds the token checks revisions made on both chains
        assertEq(a.passportOf(id).historyHash, _hashOf(id, _cids(CID_V0, CID_V1, CID_V1_B)));
    }

    // ---------------------------------------------------------------- configuration and events

    function test_setBaseURIChangesTheTokenUriAndEmits() public {
        uint256 id = _mint(a, alice, CID_V0);
        assertEq(a.tokenURI(id), string.concat("ipfs://", CID_V0));

        vm.expectEmit(address(a));
        emit BaseURISet("https://gateway.example/ipfs/");
        a.setBaseURI("https://gateway.example/ipfs/");

        assertEq(a.tokenURI(id), string.concat("https://gateway.example/ipfs/", CID_V0));
        assertEq(a.passportOf(id).cid, CID_V0); // the authoritative reference does not depend on the base
    }

    function test_setMsgInspectorGatesEverySend() public {
        uint256 id = _mint(a, alice, CID_V0);
        SendParam memory sendParam = _sendParam(B_EID, bob, id);
        address passing = address(new PassingInspector());
        address rejecting = address(new RejectingInspector());

        vm.prank(mallory);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, mallory));
        a.setMsgInspector(passing);

        // an inspector that rejects blocks quote and send alike, for the holder as well
        vm.expectEmit(address(a));
        emit ONFT721Core.MsgInspectorSet(rejecting);
        a.setMsgInspector(rejecting);
        vm.expectPartialRevert(IOAppMsgInspector.InspectionFailed.selector);
        a.quoteSend(sendParam, false);
        vm.prank(alice);
        vm.expectPartialRevert(IOAppMsgInspector.InspectionFailed.selector);
        a.send{ value: 1 ether }(sendParam, MessagingFee(1 ether, 0), alice);
        assertEq(a.ownerOf(id), alice); // nothing was burned

        // one that accepts lets the send through
        a.setMsgInspector(passing);
        _send(a, alice, B_EID, bob, id);
        verifyPackets(B_EID, addressToBytes32(address(b)));
        assertEq(b.ownerOf(id), bob);

        // removing the inspector lifts the block: install the rejecting one on A again, clear it, and send from A
        _send(b, bob, A_EID, alice, id);
        verifyPackets(A_EID, addressToBytes32(address(a)));
        a.setMsgInspector(rejecting);
        vm.prank(alice);
        vm.expectPartialRevert(IOAppMsgInspector.InspectionFailed.selector);
        a.send{ value: 1 ether }(sendParam, MessagingFee(1 ether, 0), alice);

        a.setMsgInspector(address(0));
        _send(a, alice, B_EID, bob, id);
        verifyPackets(B_EID, addressToBytes32(address(b)));
        assertEq(b.ownerOf(id), bob);
    }

    function test_mintEmitsPassportIssued() public {
        uint256 id = a.nextTokenId();
        vm.expectEmit(address(a));
        emit PassportRegistry.PassportIssued(id, CID_V0);
        a.mint(alice, id, CID_V0);
    }

    function test_deliveryEmitsOnftSentAndOnftReceived() public {
        uint256 id = _mint(a, alice, CID_V0);

        vm.recordLogs();
        MessagingReceipt memory receipt = _send(a, alice, B_EID, bob, id);
        verifyPackets(B_EID, addressToBytes32(address(b)));
        // `vm.expectEmit` cannot span the cross-contract delivery, so read the logs of both steps
        Vm.Log[] memory logs = vm.getRecordedLogs();

        bool sent;
        bool received;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter == address(a) && logs[i].topics[0] == IONFT721.ONFTSent.selector) {
                assertEq(logs[i].topics[1], receipt.guid);
                assertEq(logs[i].topics[2], bytes32(uint256(uint160(alice))));
                (uint32 dstEid, uint256 tokenId) = abi.decode(logs[i].data, (uint32, uint256));
                assertEq(dstEid, B_EID);
                assertEq(tokenId, id);
                sent = true;
            }
            if (logs[i].emitter == address(b) && logs[i].topics[0] == IONFT721.ONFTReceived.selector) {
                assertEq(logs[i].topics[1], receipt.guid);
                assertEq(logs[i].topics[2], bytes32(uint256(uint160(bob))));
                (uint32 srcEid, uint256 tokenId) = abi.decode(logs[i].data, (uint32, uint256));
                assertEq(srcEid, A_EID);
                assertEq(tokenId, id);
                received = true;
            }
        }
        assertTrue(sent, "ONFTSent not emitted on the source");
        assertTrue(received, "ONFTReceived not emitted on the destination");
    }

    // ---------------------------------------------------------------- transfers on one chain

    function test_P3_approvedOperatorTransfersAndTheFormerHolderLosesAllRights() public {
        uint256 id = _mint(a, alice, CID_V0);
        vm.prank(alice);
        a.approve(bob, id);

        vm.prank(bob);
        a.transferFrom(alice, mallory, id);
        assertEq(a.ownerOf(id), mallory);
        assertEq(a.getApproved(id), address(0)); // the approval does not survive the transfer

        // the former holder and the former operator can neither transfer nor send
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721InsufficientApproval.selector, alice, id));
        a.transferFrom(mallory, alice, id);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721InsufficientApproval.selector, bob, id));
        a.transferFrom(mallory, bob, id);

        SendParam memory sendParam = _sendParam(B_EID, alice, id);
        MessagingFee memory fee = a.quoteSend(sendParam, false);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IONFT721.OnlyNFTOwner.selector, alice, mallory));
        a.send{ value: fee.nativeFee }(sendParam, fee, alice);

        // the new holder can send; the passport stayed as the issuer wrote it
        assertEq(a.passportOf(id).revision, 0);
        _send(a, mallory, B_EID, mallory, id);
        verifyPackets(B_EID, addressToBytes32(address(b)));
        assertEq(b.ownerOf(id), mallory);
    }

    function test_mintToAContractWithoutReceiverSucceeds() public {
        // `mint` uses `_mint`, not `_safeMint`: an issuer can issue to a contract that does not implement
        // `onERC721Received` (a Safe, an escrow), and the same holds for delivery on the destination
        address vault = address(new Vault());
        uint256 id = _mint(a, vault, CID_V0);
        assertEq(a.ownerOf(id), vault);

        _send(a, alice, B_EID, vault, _mint(a, alice, CID_V1));
        verifyPackets(B_EID, addressToBytes32(address(b)));
        assertEq(b.balanceOf(vault), 1);
    }

    // ---------------------------------------------------------------- gas (LOCAL)

    /// @dev Run with `forge test --isolate --match-test Gas -vv` so that every attempt starts with cold storage.
    /// First arrival = first message on the pathway and first time the token is on B (all slots zero to non-zero).
    function test_Gas_firstArrivalCidV1() public {
        uint256 gasUsed = _minFirstArrivalGas(CID_V1);
        console.log("min endpoint.lzReceive gas, first arrival, 59-byte CID:", gasUsed);
        assertLe(gasUsed, RECEIVE_GAS, "enforced lzReceive gas does not cover a CIDv1");
    }

    function test_Gas_firstArrivalMaxCid() public {
        uint256 gasUsed = _minFirstArrivalGas(_cidOfLength(a.MAX_CID_BYTES()));
        console.log("min endpoint.lzReceive gas, first arrival, 96-byte CID:", gasUsed);
        assertLe(gasUsed, RECEIVE_GAS, "enforced lzReceive gas does not cover a maximal CID");
    }

    /// @dev The worst case: a revised passport (non-zero revision slot) with a maximal CID.
    function test_Gas_firstArrivalMaxCidRevised() public {
        uint256 gasUsed = _minFirstArrivalGas(_cidOfLength(a.MAX_CID_BYTES()), 1);
        console.log("min endpoint.lzReceive gas, first arrival, 96-byte CID, revision 1:", gasUsed);
        assertLe(gasUsed, RECEIVE_GAS, "enforced lzReceive gas does not cover a revised passport");
    }

    // ---------------------------------------------------------------- helpers

    function _ctorArgs(uint256 _prefix, uint32 _eid) private view returns (bytes memory) {
        return abi.encode("WhiskyDistillery", "IDPP", _prefix, address(endpoints[_eid]), address(this));
    }

    /// @dev Mints bound to the id that is next when the payload is built, as the issuer does (this contract).
    function _mint(WhiskyDistillery _onft, address _to, string memory _cid) private returns (uint256) {
        return _onft.mint(_to, _onft.nextTokenId(), _cid);
    }

    function _enforceReceiveGas(WhiskyDistillery _onft, uint32 _dstEid) private {
        EnforcedOptionParam[] memory params = new EnforcedOptionParam[](1);
        params[0] = EnforcedOptionParam(
            _dstEid,
            _onft.SEND(),
            OptionsBuilder.newOptions().addExecutorLzReceiveOption(RECEIVE_GAS, 0)
        );
        _onft.setEnforcedOptions(params);
    }

    function _sendParam(uint32 _dstEid, address _to, uint256 _tokenId) private pure returns (SendParam memory) {
        return SendParam(_dstEid, bytes32(uint256(uint160(_to))), _tokenId, "", "", "");
    }

    function _send(
        WhiskyDistillery _src,
        address _from,
        uint32 _dstEid,
        address _to,
        uint256 _tokenId
    ) private returns (MessagingReceipt memory receipt) {
        SendParam memory sendParam = _sendParam(_dstEid, _to, _tokenId);
        MessagingFee memory fee = _src.quoteSend(sendParam, false);
        vm.prank(_from);
        receipt = _src.send{ value: fee.nativeFee }(sendParam, fee, _from);
    }

    function _encodeMessage(
        address _to,
        uint256 _tokenId,
        uint64 _revision,
        bytes32 _historyHash,
        string memory _cid
    ) private pure returns (bytes memory) {
        return abi.encode(bytes32(uint256(uint160(_to))), _tokenId, abi.encode(_revision, _historyHash, _cid));
    }

    /// @dev The history hash of revisions 0..n-1 with these CIDs, computed here rather than by the contract.
    function _hashOf(uint256 _tokenId, string[] memory _history) private pure returns (bytes32 h) {
        for (uint256 r = 0; r < _history.length; r++) h = keccak256(abi.encode(h, _tokenId, uint64(r), _history[r]));
    }

    function _issuedHash(uint256 _tokenId, string memory _cid) private pure returns (bytes32) {
        return _hashOf(_tokenId, _cids(_cid));
    }

    function _cids(string memory _c0) private pure returns (string[] memory list) {
        list = new string[](1);
        list[0] = _c0;
    }

    function _cids(string memory _c0, string memory _c1) private pure returns (string[] memory list) {
        list = new string[](2);
        (list[0], list[1]) = (_c0, _c1);
    }

    function _cids(
        string memory _c0,
        string memory _c1,
        string memory _c2
    ) private pure returns (string[] memory list) {
        list = new string[](3);
        (list[0], list[1], list[2]) = (_c0, _c1, _c2);
    }

    /// @dev A message from the configured peer on A, as a compromised DVN or a peer that skipped `lz:precheck` could
    /// produce it, delivered to B with the endpoint as caller.
    function _forgedDelivery(address _to, uint256 _tokenId, uint64 _revision, string memory _cid) private {
        Origin memory origin = Origin(A_EID, addressToBytes32(address(a)), 1);
        vm.prank(endpoints[B_EID]);
        bytes memory message = _encodeMessage(_to, _tokenId, _revision, keccak256("forged history"), _cid);
        b.lzReceive(origin, keccak256("forged"), message, address(0), "");
    }

    /// @dev Non-zero bytes, so that storing the CID costs what a real CID costs.
    function _cidOfLength(uint256 _length) private pure returns (string memory) {
        bytes memory cid = new bytes(_length);
        for (uint256 i = 0; i < _length; i++) cid[i] = "b";
        return string(cid);
    }

    function _exists(WhiskyDistillery _onft, uint256 _tokenId) private view returns (bool) {
        try _onft.ownerOf(_tokenId) returns (address) {
            return true;
        } catch {
            return false;
        }
    }

    function _deliver(
        Origin memory _origin,
        bytes32 _guid,
        bytes memory _message,
        uint256 _gas
    ) private returns (bool ok) {
        (ok, ) = endpoints[B_EID].call{ gas: _gas }(
            abi.encodeCall(ILayerZeroEndpointV2.lzReceive, (_origin, address(b), _guid, _message, ""))
        );
    }

    function _minFirstArrivalGas(string memory _cid) private returns (uint256) {
        return _minFirstArrivalGas(_cid, 0);
    }

    /// @dev Smallest gas limit for which the executor's `endpoint.lzReceive` call delivers the token on B, for a
    /// passport revised `_revisions` times on A (each revision with the same CID length).
    function _minFirstArrivalGas(string memory _cid, uint64 _revisions) private returns (uint256) {
        uint256 id = _mint(a, alice, _cid);
        for (uint64 r = 0; r < _revisions; r++) a.revise(id, r, _cid);
        PassportRegistry.Passport memory passport = a.passportOf(id);
        MessagingReceipt memory receipt = _send(a, alice, B_EID, bob, id);
        this.validatePacket(getNextInflightPacket(uint16(B_EID), addressToBytes32(address(b))), "");

        Origin memory origin = Origin(A_EID, addressToBytes32(address(a)), receipt.nonce);
        bytes memory message = _encodeMessage(bob, id, passport.revision, passport.historyHash, _cid);

        uint256 low = 21_000;
        uint256 high = 2_000_000;
        while (low < high) {
            uint256 mid = (low + high) / 2;
            uint256 snapshot = vm.snapshotState();
            bool ok = _deliver(origin, receipt.guid, message, mid);
            vm.revertToState(snapshot);
            if (ok) high = mid;
            else low = mid + 1;
        }
        require(_deliver(origin, receipt.guid, message, low), "delivery failed at the measured gas");
        return low;
    }
}

/// @dev Accepts every message.
contract PassingInspector is IOAppMsgInspector {
    function inspect(bytes calldata, bytes calldata) external pure returns (bool) {
        return true;
    }
}

/// @dev Rejects every message, as a misconfigured or hostile inspector would.
contract RejectingInspector is IOAppMsgInspector {
    function inspect(bytes calldata _message, bytes calldata _options) external pure returns (bool) {
        revert InspectionFailed(_message, _options);
    }
}

/// @dev A contract holder that does not implement `onERC721Received`.
contract Vault {}
