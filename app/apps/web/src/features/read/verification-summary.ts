import type { NoticeTone } from "@/components/notice";
import type { Check, VerifyOutcome } from "./verification";

type Summary = { tone: NoticeTone; title: string; details: string[] };
const checks = [
  ["content", "Downloaded data matches its content reference"],
  ["binding", "Data identifies this passport and revision"],
  ["history", "Links between earlier revisions are consistent"],
  ["recorded", "Transaction receipts confirm the references and authors"],
] as const;

/** A reading aid over existing results, never a replacement verification decision. */
export function verificationSummary(outcome: VerifyOutcome, discoveryUncertain = false): Summary {
  const groups: { label: string; results: Check[] }[] = checks.map(([key, label]) => ({
    label,
    results: outcome.entries.map((entry) => entry[key]),
  }));
  groups.push({
    label: "Ordered references match the live history commitment",
    results: [outcome.historyHash],
  });
  const failed = groups.filter((g) => g.results.some((r) => r.status === "failed"));
  const unavailable = groups.filter((g) => g.results.some((r) => r.status === "unavailable"));
  const unconfirmed = groups.filter((g) => g.results.some((r) => r.status === "unconfirmed"));
  const details = [
    ...failed.map((g) => `Failed check: ${g.label.toLowerCase()}. See the revision results below.`),
    ...unavailable.map(
      (g) =>
        `Not fully checked: ${g.label.toLowerCase()}. Required data or chain evidence is unavailable.`,
    ),
    ...unconfirmed.map(
      (g) =>
        `Unconfirmed: ${g.label.toLowerCase()}. A current chain read did not confirm every displayed revision.`,
    ),
  ];
  if (failed.length) return { tone: "error", title: "Some digital-record checks failed", details };
  if (!outcome.entries.length)
    return {
      tone: "warn",
      title: "No revision data to verify",
      details: ["Wait for discovery to catch up, then reload this passport."],
    };
  if (outcome.assurance !== "live" || unconfirmed.length)
    return {
      tone: "warn",
      title: "The complete record is not confirmed against current chain state",
      details,
    };
  if (unavailable.length) return { tone: "warn", title: "Verification is incomplete", details };
  if (discoveryUncertain || outcome.notes.length || outcome.entries.some((e) => e.conflict))
    return {
      tone: "warn",
      title: "Record checks passed; discovery needs attention",
      details: [
        "The checked record is consistent, but discovery differs or has conflicting observations. Review the warnings before presenting.",
      ],
    };
  return {
    tone: "ok",
    title: "Retrieved data matches the recorded revision history",
    details: [
      "All displayed revisions passed content, identity, predecessor-link and receipt checks. Their ordered references match the live history commitment.",
    ],
  };
}
