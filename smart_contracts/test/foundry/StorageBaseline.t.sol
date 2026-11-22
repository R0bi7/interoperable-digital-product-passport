// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.22;

import { Test } from "forge-std/Test.sol";

import { PassportRegistry } from "../../contracts/passport/PassportRegistry.sol";

/**
 * @dev DS5 of docs/evaluation/PROTOCOL.md: what it costs to keep the passport state on chain as `(revision, historyHash, cid)`
 * (the design) against keeping the payload itself on chain as `bytes` (the alternative the hypothesis is measured
 * against). The payloads are the committed fixtures (`fixtures/`), so the bytes are real: calldata cost depends on
 * their content and their length.
 *
 * Compared:
 * - registry: `PassportRegistry` as deployed (`_issuePassport`, `_revisePassport`), state `(uint64, string)` plus the
 *   `mintedCount` counter, and its events, which carry the CID;
 * - bytes, latest only: the current payload as `bytes` in a mapping, the same counter and a revision number;
 * - bytes, all revisions: every revision's payload pushed to an array (what keeping the history on chain costs).
 * ERC-721 ownership (owner and balance slots) is the same in both designs and is left out of both.
 *
 * Run with the `ds5` profile (`isolate = true`): every call is then its own transaction with cold storage, as it is
 * on a chain. forge 1.8.5 isolates by default; older versions need `--isolate`. A run that is not isolated is skipped
 * (the `ds5` profile instead fails), because its figures would be meaningless for the thesis. Set
 * WRITE_STORAGE_BASELINE=1 to write `e2e_reports/storage-baseline.json`; the task `e2e:storage` does that and renders
 * the Markdown and LaTeX tables.
 *
 * Workloads: `issue` is the first issue on a fresh contract (counter 0 to 1); `revise` is the first revision. For the
 * bytes store the revision is measured twice: every 32-byte word changed (the worst case) and one word changed (a
 * localized edit of the document).
 */
contract RegistryHarness is PassportRegistry {
    constructor() PassportRegistry(97) {}

    /// @dev Does nothing: the gas of a call to it is the floor every figure here includes (intrinsic gas of a transaction).
    function ping() external {}

    function issue(uint256 _expectedId, string calldata _cid) external returns (uint256) {
        return _issuePassport(_expectedId, _cid);
    }

    function revise(uint256 _id, uint64 _expectedRevision, string calldata _cid) external {
        _revisePassport(_id, _expectedRevision, _cid, msg.sender);
    }

    function stateOf(uint256 _id) external view returns (uint64 revision, string memory cid) {
        return (_passports[_id].revision, _passports[_id].cid);
    }
}

contract BytesStore {
    mapping(uint256 id => bytes) internal _latest;
    mapping(uint256 id => bytes[]) internal _all;
    mapping(uint256 id => uint64) internal _revision;
    uint256 public mintedCount;

    // same indexed topics as the registry's events, without the payload in the log
    event PayloadIssued(uint256 indexed id);
    event PayloadRevised(uint256 indexed id, uint64 revision, address indexed author);

    function issueLatest(uint256 _expectedId, bytes calldata _payload) external {
        require(_payload.length != 0, "empty");
        require(_expectedId == mintedCount, "unexpected id");
        mintedCount++;
        _latest[_expectedId] = _payload;
        emit PayloadIssued(_expectedId);
    }

    function reviseLatest(uint256 _id, uint64 _expectedRevision, bytes calldata _payload) external {
        require(_payload.length != 0, "empty");
        require(_revision[_id] == _expectedRevision, "stale");
        uint64 revision = ++_revision[_id];
        _latest[_id] = _payload;
        emit PayloadRevised(_id, revision, msg.sender);
    }

    function latestOf(uint256 _id) external view returns (bytes memory) {
        return _latest[_id];
    }

    function historyLength(uint256 _id) external view returns (uint256) {
        return _all[_id].length;
    }

    function historyAt(uint256 _id, uint256 _index) external view returns (bytes memory) {
        return _all[_id][_index];
    }

    function issueAll(uint256 _expectedId, bytes calldata _payload) external {
        require(_payload.length != 0, "empty");
        require(_expectedId == mintedCount, "unexpected id");
        mintedCount++;
        _all[_expectedId].push(_payload);
        emit PayloadIssued(_expectedId);
    }

    function reviseAll(uint256 _id, uint64 _expectedRevision, bytes calldata _payload) external {
        require(_payload.length != 0, "empty");
        require(_revision[_id] == _expectedRevision, "stale");
        uint64 revision = ++_revision[_id];
        _all[_id].push(_payload);
        emit PayloadRevised(_id, revision, msg.sender);
    }
}

contract StorageBaselineTest is Test {
    // order of `payloads` in fixtures/sizes.json (tasks/fixtures.ts, payloadFixtures)
    string[9] private NAMES = [
        "cask-minimal",
        "cask-full",
        "cask-batch",
        "bottle-1-cask",
        "bottle-3-casks",
        "bottle-10-casks",
        "bottle-batch",
        "size-2-kib",
        "size-64-kib"
    ];
    uint256[3] private DEPTHS = [1, 5, 20];
    uint256 private constant CHAIN_20 = 3; // index of depth 20 in `chains` of sizes.json

    struct Single {
        string name;
        uint256 payloadBytes;
        uint256 cidBytes;
        uint256 registryIssue;
        uint256 bytesIssue;
        uint256 registryRevise;
        uint256 bytesRevise;
        uint256 bytesReviseOneWord;
        uint256 registrySlots;
        uint256 bytesSlots;
    }

    struct Growth {
        uint256 revisions;
        uint256 payloadBytesAll;
        uint256 registryGas;
        uint256 bytesLatestGas;
        uint256 bytesAllGas;
        uint256 registrySlots;
        uint256 bytesLatestSlots;
        uint256 bytesAllSlots;
    }

    string private sizes;

    function setUp() public {
        sizes = vm.readFile("fixtures/sizes.json");
    }

    // ------------------------------------------------------------------------------------------------ measuring

    /// @dev Gas of one external call. Under `isolate` the call is a transaction of its own, so the figure is the gas of
    /// that transaction: the 21,000 base, the calldata and the execution (`emptyCallGas` in the output is the floor).
    function _gas(address _target, bytes memory _data) private returns (uint256 used) {
        uint256 before = gasleft();
        (bool ok, ) = _target.call(_data);
        used = before - gasleft();
        require(ok, "call failed");
    }

    function _words(uint256 _length) private pure returns (uint256) {
        return (_length + 31) / 32;
    }

    /// @dev Storage slots a `bytes` or `string` of this length occupies: the length slot plus the data words
    /// (short values of up to 31 bytes share one slot).
    function _slots(uint256 _length) private pure returns (uint256) {
        return _length <= 31 ? 1 : 1 + _words(_length);
    }

    /// @dev A revised value that differs from `_value` in the first byte of every 32-byte word, so that every slot of
    /// the replacement is an actual change (an identical write costs almost nothing and is not a revision).
    function _changed(bytes memory _value) private pure returns (bytes memory copy) {
        copy = bytes.concat(_value);
        for (uint256 i = 0; i < copy.length; i += 32) copy[i] = bytes1(uint8(copy[i]) ^ 0x01);
    }

    /// @dev A revised value that differs from `_value` in a single 32-byte word (the middle one).
    function _changedOneWord(bytes memory _value) private pure returns (bytes memory copy) {
        copy = bytes.concat(_value);
        uint256 word = (_words(copy.length) / 2) * 32;
        copy[word] = bytes1(uint8(copy[word]) ^ 0x01);
    }

    function _fixtureCid(uint256 _index) private view returns (string memory) {
        string memory path = string.concat(".payloads[", vm.toString(_index), "]");
        assertEq(vm.parseJsonString(sizes, string.concat(path, ".name")), NAMES[_index], "fixture order");
        return vm.parseJsonString(sizes, string.concat(path, ".cid"));
    }

    function _single(uint256 _index) private returns (Single memory r) {
        r.name = NAMES[_index];
        bytes memory payload = vm.readFileBinary(string.concat("fixtures/payloads/", r.name, ".json"));
        string memory cid = _fixtureCid(_index);
        string memory nextCid = string(_changed(bytes(cid)));
        r.payloadBytes = payload.length;
        r.cidBytes = bytes(cid).length;
        r.registrySlots = 2 + _slots(r.cidBytes); // revision, historyHash and the CID string
        r.bytesSlots = 1 + _slots(r.payloadBytes); // the packed revision slot plus the payload

        RegistryHarness registry = new RegistryHarness();
        BytesStore store = new BytesStore();
        BytesStore oneWord = new BytesStore();
        uint256 id = registry.nextTokenId();
        r.registryIssue = _gas(address(registry), abi.encodeCall(RegistryHarness.issue, (id, cid)));
        r.bytesIssue = _gas(address(store), abi.encodeCall(BytesStore.issueLatest, (0, payload)));
        r.registryRevise = _gas(address(registry), abi.encodeCall(RegistryHarness.revise, (id, 0, nextCid)));
        r.bytesRevise = _gas(address(store), abi.encodeCall(BytesStore.reviseLatest, (0, 0, _changed(payload))));
        _gas(address(oneWord), abi.encodeCall(BytesStore.issueLatest, (0, payload)));
        r.bytesReviseOneWord = _gas(
            address(oneWord),
            abi.encodeCall(BytesStore.reviseLatest, (0, 0, _changedOneWord(payload)))
        );
    }

    function _growth(uint256 _depth) private returns (Growth memory g) {
        g.revisions = _depth;
        RegistryHarness registry = new RegistryHarness();
        BytesStore latest = new BytesStore();
        BytesStore all = new BytesStore();
        uint256 id = registry.nextTokenId();
        string memory base = string.concat(".chains[", vm.toString(CHAIN_20), "]");
        // the chain fixtures must be the depth-20 chain
        assertEq(vm.parseJsonUint(sizes, string.concat(base, ".depth")), 20, "chain order");

        uint256 lastPayload;
        uint256 lastCid;
        bytes32 lastCidHash;
        bytes32[] memory payloadHashes = new bytes32[](_depth); // what was written, to compare with what is held
        g.bytesAllSlots = 2; // the revision slot and the length slot of the array
        for (uint256 r = 0; r < _depth; r++) {
            bytes memory payload = vm.readFileBinary(_chainPath(r));
            string memory cid = vm.parseJsonString(sizes, string.concat(base, ".cids[", vm.toString(r), "]"));
            g.payloadBytesAll += payload.length;
            g.bytesAllSlots += _slots(payload.length);
            lastPayload = payload.length;
            lastCid = bytes(cid).length;
            lastCidHash = keccak256(bytes(cid));
            payloadHashes[r] = keccak256(payload);
            if (r == 0) {
                g.registryGas += _gas(address(registry), abi.encodeCall(RegistryHarness.issue, (id, cid)));
                g.bytesLatestGas += _gas(address(latest), abi.encodeCall(BytesStore.issueLatest, (0, payload)));
                g.bytesAllGas += _gas(address(all), abi.encodeCall(BytesStore.issueAll, (0, payload)));
            } else {
                uint64 expected = uint64(r - 1);
                g.registryGas += _gas(address(registry), abi.encodeCall(RegistryHarness.revise, (id, expected, cid)));
                g.bytesLatestGas += _gas(
                    address(latest),
                    abi.encodeCall(BytesStore.reviseLatest, (0, expected, payload))
                );
                g.bytesAllGas += _gas(address(all), abi.encodeCall(BytesStore.reviseAll, (0, expected, payload)));
            }
        }
        // What the measured alternatives really hold afterwards (the slot counts below are calculated from these).
        _verifyHeld(registry, id, latest, all, lastCidHash, payloadHashes);
        // the registry keeps only the latest CID (the earlier ones are in events); so does "latest only"
        g.registrySlots = 2 + _slots(lastCid); // revision, historyHash and the CID string
        g.bytesLatestSlots = 1 + _slots(lastPayload);
    }

    /// @dev The stores hold exactly what was written: the registry the last CID, "latest only" the last payload, and
    /// "all revisions" every payload in order. Compared by hash against the inputs, not against each other.
    function _verifyHeld(
        RegistryHarness _registry,
        uint256 _id,
        BytesStore _latest,
        BytesStore _all,
        bytes32 _lastCidHash,
        bytes32[] memory _payloadHashes
    ) private view {
        uint256 depth = _payloadHashes.length;
        (uint64 revision, string memory storedCid) = _registry.stateOf(_id);
        assertEq(revision, uint64(depth - 1), "registry revision");
        assertEq(keccak256(bytes(storedCid)), _lastCidHash, "registry holds the last CID written");
        assertEq(
            keccak256(_latest.latestOf(0)),
            _payloadHashes[depth - 1],
            "latest-only holds the last payload written"
        );
        assertEq(_all.historyLength(0), depth, "history holds every revision");
        for (uint256 r = 0; r < depth; r++) {
            assertEq(
                keccak256(_all.historyAt(0, r)),
                _payloadHashes[r],
                "history entry differs from the payload written"
            );
        }
    }

    function _chainPath(uint256 _revision) private pure returns (string memory) {
        return string.concat("fixtures/chain/r", _revision < 10 ? "0" : "", vm.toString(_revision), ".json");
    }

    // ------------------------------------------------------------------------------------------------ the test

    function test_DS5_storageBaseline() public {
        // What is in a figure: a call that does nothing costs the base gas of a transaction, if calls are isolated.
        uint256 floorGas = _gas(address(new RegistryHarness()), abi.encodeCall(RegistryHarness.ping, ()));
        bool isolated = floorGas >= 21_000;
        if (keccak256(bytes(vm.envOr("FOUNDRY_PROFILE", string("default")))) == keccak256("ds5")) {
            assertTrue(isolated, "the ds5 profile must run isolated");
        } else if (!isolated) {
            vm.skip(true); // not isolated (forge before 1.8 without --isolate): the figures would not mean anything
        }
        assertLt(
            floorGas,
            22_000,
            "an empty call costs over 1,000 more than the base gas: a figure includes something else"
        );

        Single[] memory singles = new Single[](NAMES.length);
        for (uint256 i = 0; i < NAMES.length; i++) singles[i] = _single(i);
        Growth[] memory growth = new Growth[](DEPTHS.length);
        for (uint256 i = 0; i < DEPTHS.length; i++) growth[i] = _growth(DEPTHS[i]);

        // Acceptance criteria written before the run (docs/evaluation/PROTOCOL.md, DS5). The direction of the result is
        // not asserted: if keeping the payload on chain were cheaper, that is what the report would say.
        // 1. The registry's cost does not depend on the payload: every fixture has a CID of the same length.
        uint256 minIssue = type(uint256).max;
        uint256 maxIssue;
        for (uint256 i = 0; i < singles.length; i++) {
            assertEq(singles[i].cidBytes, singles[0].cidBytes, "CIDs differ in length");
            if (singles[i].registryIssue < minIssue) minIssue = singles[i].registryIssue;
            if (singles[i].registryIssue > maxIssue) maxIssue = singles[i].registryIssue;
        }
        assertLe(maxIssue - minIssue, minIssue / 50, "registry issue gas varies with the payload by more than 2%");
        // 2. The cost of keeping the bytes grows with their size, strictly, in the order of the payload sizes.
        assertLt(singles[0].bytesIssue, singles[1].bytesIssue, "cask-minimal < cask-full");
        assertLt(singles[3].bytesIssue, singles[4].bytesIssue, "bottle-1 < bottle-3");
        assertLt(singles[4].bytesIssue, singles[5].bytesIssue, "bottle-3 < bottle-10");
        assertLt(singles[5].bytesIssue, singles[7].bytesIssue, "bottle-10 < 2 KiB");
        assertLt(singles[7].bytesIssue, singles[8].bytesIssue, "2 KiB < 64 KiB");
        // 3. A localized edit of the stored document is cheaper than a rewrite of all of it.
        for (uint256 i = 0; i < singles.length; i++) {
            assertLt(singles[i].bytesReviseOneWord, singles[i].bytesRevise, "one word changed < every word changed");
        }
        // 4. Keeping every revision costs more than keeping the latest, and more with every revision.
        for (uint256 i = 0; i < growth.length; i++) {
            assertGe(growth[i].bytesAllGas, growth[i].bytesLatestGas, "history < latest");
            if (i > 0) assertGt(growth[i].bytesAllGas, growth[i - 1].bytesAllGas, "history does not grow");
            if (i > 0) assertGt(growth[i].registryGas, growth[i - 1].registryGas, "registry does not grow");
        }

        if (vm.envOr("WRITE_STORAGE_BASELINE", false)) _write(singles, growth, floorGas);
    }

    function _u(uint256 _value) private pure returns (string memory) {
        return vm.toString(_value);
    }

    /// @dev The raw result as JSON text, written by hand so that the file is byte-for-byte reproducible.
    function _write(Single[] memory _singles, Growth[] memory _grown, uint256 _floorGas) private {
        string memory single;
        for (uint256 i = 0; i < _singles.length; i++) {
            Single memory r = _singles[i];
            string memory head = string.concat(
                '{"name":"',
                r.name,
                '","payloadBytes":',
                _u(r.payloadBytes),
                ',"cidBytes":',
                _u(r.cidBytes),
                ',"registryIssueGas":',
                _u(r.registryIssue),
                ',"bytesIssueGas":',
                _u(r.bytesIssue)
            );
            string memory tail = string.concat(
                ',"registryReviseGas":',
                _u(r.registryRevise),
                ',"bytesReviseGas":',
                _u(r.bytesRevise),
                ',"bytesReviseOneWordGas":',
                _u(r.bytesReviseOneWord),
                ',"registrySlots":',
                _u(r.registrySlots),
                ',"bytesSlots":',
                _u(r.bytesSlots),
                "}"
            );
            single = string.concat(single, i == 0 ? "" : ",", head, tail);
        }
        string memory grown;
        for (uint256 i = 0; i < _grown.length; i++) {
            Growth memory g = _grown[i];
            grown = string.concat(
                grown,
                i == 0 ? "" : ",",
                '{"revisions":',
                _u(g.revisions),
                ',"payloadBytesAll":',
                _u(g.payloadBytesAll),
                ',"registryGas":',
                _u(g.registryGas),
                ',"bytesLatestGas":',
                _u(g.bytesLatestGas),
                ',"bytesAllGas":',
                _u(g.bytesAllGas),
                ',"registrySlots":',
                _u(g.registrySlots),
                ',"bytesLatestSlots":',
                _u(g.bytesLatestSlots),
                ',"bytesAllSlots":',
                _u(g.bytesAllSlots),
                "}"
            );
        }
        string memory out = string.concat(
            '{"forge":"',
            vm.envOr("FORGE_VERSION", string("unknown")),
            '","profile":"',
            vm.envOr("FOUNDRY_PROFILE", string("default")),
            '","emptyCallGas":',
            _u(_floorGas),
            ',"maxCidBytes":96,"single":[',
            single,
            '],"growth":[',
            grown,
            "]}\n"
        );
        vm.writeFile("e2e_reports/storage-baseline.json", out);
    }
}
