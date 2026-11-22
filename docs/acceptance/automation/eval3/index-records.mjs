// Writes the data-index records of the browser and storage runs (`smart_contracts/e2e_reports/ui-<run id>.json`, task `ui`) from
// the raw files filed under docs/acceptance/. One entry per test or reader load ("check"), with the transactions it
// made; the predeclared result of each DS10 load is applied here, so the record says which loads met it. Nothing is
// read from a chain or a network.
//   node docs/acceptance/automation/eval3/index-records.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const L = `${REPO}/docs/acceptance/2026-10-20-live-suite`;
const F = `${REPO}/docs/acceptance/2026-10-20-ds9-ds11`;
const OUT = `${REPO}/smart_contracts/e2e_reports`;
const json = (p) => JSON.parse(readFileSync(p, "utf8"));
const ms = (iso) => String(Date.parse(iso));
const DEPLOYMENT = "whisky-v2-eval3";

/** Playwright list-reporter lines: "  ✓  3 file:line:col › title (time)". */
function playwrightTests(log) {
  return readFileSync(log, "utf8")
    .split("\n")
    .map((line) => line.match(/^\s+([✓✘-])\s+\d+\s+\S+\s+›\s+(.*?)(?:\s+\([\d.]+m?s\))?$/))
    .filter(Boolean)
    // A skipped test ("-") is not a check: it is left out rather than counted as a failure.
    .filter(([, mark]) => mark !== "-")
    .map(([, mark, title]) => ({ title: title.trim(), status: mark === "✓" ? "PASS" : "FAIL" }));
}
const step = (name, txHash, network) => ({ step: name, network, txHash: txHash ?? null, checks: [] });
const NET = { 421614: "arbitrum-sepolia", 84532: "base-sepolia", 11155111: "sepolia" };

// gitDirty: true or false only where a filed raw file records the tree state; null where the run did not record it.
function record(runId, window, gitSha, gitDirty, startedAt, sources, flows, note) {
  const out = {
    runId,
    deploymentId: DEPLOYMENT,
    header: { window, gitSha, gitDirty, startedAt, sources, note },
    flows,
  };
  writeFileSync(`${OUT}/ui-${runId}.json`, `${JSON.stringify(out, null, 2)}\n`);
  const passed = flows.filter((f) => f.status === "PASS").length;
  console.log(`ui-${runId}.json (${window}): ${passed} of ${flows.length} checks passed`);
}

// DS12: the live flows (timing observations in test order), the indexer suite of record with LIVE_SPEND, the two
// vitest suites and the figure/ownership spec.
{
  const t = json(`${L}/ui-timings.json`);
  const obs = [...t.observations];
  const flows = playwrightTests(`${L}/flows.log`).map((test) => {
    const kind = /mints/.test(test.title) ? "mint" : /revises|stale/.test(test.title) ? "revise" : /send sample/.test(test.title) ? "send" : null;
    const o = kind ? obs.shift() : undefined;
    // Pairing is by order; a test that failed before recording would shift it, so the operations must agree.
    if (o && o.operation !== kind) throw new Error(`"${test.title}" paired with a ${o.operation} observation`);
    return {
      flow: `live flows: ${test.title}`,
      status: test.status,
      ...(o ? { tokenId: o.tokenId } : {}),
      steps: o ? [step(o.operation, o.txHash, NET[o.chainId])] : [],
    };
  });
  if (obs.length) throw new Error(`${obs.length} DS12 timing observations not matched to a test`);
  const spend = json(`${L}/ui-timings-indexer-live-spend.json`).observations[0];
  for (const test of playwrightTests(`${L}/indexer-suite-attempt1.log`)) {
    const send = /places the token on the destination/.test(test.title);
    flows.push({
      flow: `indexer suite: ${test.title}`,
      status: test.status,
      steps: send ? [step("send", spend.txHash, NET[spend.chainId])] : [],
    });
  }
  // Vitest prints totals only ("Tests  17 passed (17)"): one check per suite, passed when every test passed.
  for (const [name, log] of [
    ["indexer test:live", `${L}/indexer-test-live.log`],
    ["passport-config test:int (Pinata round trip)", `${L}/passport-config-test-int.log`],
  ]) {
    const m = readFileSync(log, "utf8").match(/Tests\s+(?:(\d+) failed \| )?(\d+) passed \((\d+)\)/);
    if (!m) throw new Error(`no vitest totals in ${log}`);
    flows.push({ flow: `${name} (${m[2]} of ${m[3]} tests)`, status: !m[1] && m[2] === m[3] ? "PASS" : "FAIL", steps: [] });
  }
  for (const test of playwrightTests(`${L}/evidence.log`)) flows.push({ flow: `evidence: ${test.title}`, status: test.status, steps: [] });
  record(
    ms(t.header.startedAt),
    "ds12",
    t.header.gitSha,
    t.header.gitDirty,
    t.header.startedAt,
    ["docs/acceptance/2026-10-20-live-suite.md", "docs/acceptance/2026-10-20-live-suite/ui-timings.json"],
    flows,
    "Live flows from the timing header's commit; the indexer suites ran from the same tree, the evidence spec from the test-only harness commit e64240e.",
  );
}

// DS12 attempt 1, stopped after its first mint because its header recorded a dirty tree.
{
  const t = json(`${L}/ui-timings-attempt1-aborted.json`);
  const flows = t.observations.map((o) => ({
    flow: `live flows (aborted): ${o.operation}`,
    status: o.outcome === "verified" ? "PASS" : "FAIL",
    tokenId: o.tokenId,
    steps: [step(o.operation, o.txHash, NET[o.chainId])],
  }));
  const out = {
    runId: ms(t.header.startedAt),
    deploymentId: DEPLOYMENT,
    header: {
      window: "ds12",
      gitSha: t.header.gitSha,
      gitDirty: t.header.gitDirty,
      startedAt: t.header.startedAt,
      sources: ["docs/acceptance/2026-10-20-live-suite/ui-timings-attempt1-aborted.json"],
      note: "Stopped by the operator after one mint: untracked report files made the header dirty.",
    },
    flows,
  };
  writeFileSync(`${OUT}/ui-${out.runId}.json`, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`ui-${out.runId}.json (ds12, aborted)`);
}

// DS11: the eight tests with the transactions of the results file.
{
  const d = json(`${F}/ds11/ds11-results.json`);
  const tx = (prefix) => d.steps.find((s) => s.step.startsWith(prefix));
  const map = [
    [/one source cask/, tx("mint bottle with one source cask")],
    [/^mints a bottle with two/, tx("mint bottle with two source casks")],
    [/^revises/, tx("revise bottle")],
    [/sends bottle 1/, tx("send bottle 1")],
    [/sends bottle 2/, tx("send bottle 2")],
  ];
  const flows = playwrightTests(`${F}/ds11/ds11.log`).map((test) => {
    const s = /^refuses/.test(test.title) ? undefined : map.find(([re]) => re.test(test.title))?.[1];
    return {
      flow: test.title,
      status: test.status,
      ...(s ? { tokenId: s.tokenId } : {}),
      steps: s ? [step(s.step, s.txHash, "arbitrum-sepolia")] : [],
    };
  });
  record(
    ms(d.header.startedAt),
    "ds11",
    "ee4cdec328a02d3f3f38818ee61149ebdd91fece",
    // The run script refused a dirty tree and logged "commit ee4cdec clean" (first line of ds11.log).
    readFileSync(`${F}/ds11/ds11.log`, "utf8").startsWith("commit ee4cdec clean") ? false : null,
    d.header.startedAt,
    ["docs/evaluation/DS11.md", "docs/acceptance/2026-10-20-ds9-ds11/ds11/ds11-results.json"],
    flows,
    "Indexer-backed production build; key-backed injected wallet.",
  );
}

// DS10: one check per reader load against the predeclared result of PROTOCOL.md DS10; the fixture transactions
// belong to the a1, a2 and c loads (the decoy loads reuse the c tokens).
{
  const fx = json(`${F}/ds10/ds10-fixtures.json`);
  const loads = json(`${F}/ds10/ds10-ui-results.json`);
  const r = (l, i) => l.revisions[i] ?? {};
  const met = {
    a1: (l) => r(l, 0).binding === "failed",
    a2: (l) => r(l, 0).binding === "failed",
    c: (l) => r(l, 1).history === "failed",
    "b-altered": (l) => r(l, 0).content === "failed",
    "b-control": (l) => r(l, 0).content === "verified",
    decoy: (l) => l.historyHash === "failed" && r(l, 0).recordedOnChain === "failed",
    future: (l) => {
      const f = fx.future.find((x) => x.tokenId === l.tokenId);
      const banner = `The chain holds revision ${f.liveRevision}; the indexer lists revision ${f.futureRevision}. Revisions above ${f.liveRevision} are not confirmed on chain.`;
      return r(l, l.revisions.length - 1).binding === "unconfirmed" && l.banners.includes(banner);
    },
  };
  const flows = loads.map((l) => {
    const kind = Object.keys(met).find((k) => l.name.startsWith(`ds10-${k}-`));
    const f = ["a1", "a2", "c"].includes(kind) ? fx[kind].find((x) => x.tokenId === l.tokenId) : undefined;
    const steps = f
      ? [step("mint", f.mintTx, NET[f.chainId]), ...(f.reviseTx ? [step("revise", f.reviseTx, NET[f.chainId])] : [])]
      : [];
    return { flow: l.name.replace(/^ds10-/, ""), status: met[kind](l) ? "PASS" : "FAIL", tokenId: l.tokenId, steps };
  });
  // The run starts with the fixtures; its id is theirs, as in the fixture ledger.
  record(
    ms(fx.header.createdAt),
    "ds10",
    "5db5cd7931690000665fae3d0c6a3500eecf7695",
    null,
    fx.header.createdAt,
    ["docs/evaluation/DS10.md", "docs/acceptance/2026-10-20-ds9-ds11/ds10/ds10-ui-results.json"],
    flows,
    `Reader run against the stand-in at 5db5cd7 (tree state not recorded in a file). Fixtures from ${fx.header.createdAt} in three invocations of ds10-chain.cts: 2f8109e as committed (a1 Arbitrum; a1 Base minted, its record lost to RPC lag), then two uncommitted working copies: one with retrying reads and the a1 adopt path (a1 Base adopted, a1 Sepolia, a2, c Arbitrum, c Base mint), then the copy committed unchanged in 2eef9b7 (c Base resumed, c Sepolia, future). Fixtures are set-up transactions; the observations are the reader loads.`,
  );
}

// DS9: one check per CID, passed when both reads verify.
{
  const d = json(`${F}/ds9/ds9-results.json`);
  const flows = d.rows.map((row) => ({
    flow: `${row.role}: ${row.cid}`,
    status: row.gateway.verified && row.localOffline.verified ? "PASS" : "FAIL",
    tokenId: row.tokenId,
    steps: [],
  }));
  record(
    ms(d.header.startedAt),
    "ds9",
    "ee4cdec328a02d3f3f38818ee61149ebdd91fece",
    null,
    d.header.startedAt,
    ["docs/evaluation/DS9.md", "docs/acceptance/2026-10-20-ds9-ds11/ds9/ds9-results.json"],
    flows,
    "kubo 0.43.1; copies from the IPFS network, reads through the Pinata gateway and offline from the local node.",
  );
}
