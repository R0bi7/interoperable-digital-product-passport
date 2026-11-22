import { Notice } from "@/components/notice";
import type { VerifyOutcome } from "../verification";
import { verificationSummary } from "../verification-summary";

export function VerificationSummary({
  outcome,
  discoveryUncertain = false,
  simulated = false,
}: {
  outcome: VerifyOutcome;
  discoveryUncertain?: boolean;
  simulated?: boolean;
}) {
  const summary = verificationSummary(outcome, discoveryUncertain);
  return (
    <Notice tone={summary.tone}>
      <p className="font-medium">
        {simulated ? "Fixture result: " : ""}
        {summary.title}
      </p>
      {summary.details.map((detail) => (
        <p key={detail}>{detail}</p>
      ))}
      <p className="text-xs leading-relaxed">
        These checks concern the digital record. They do not verify physical authenticity, custody
        or the truth of product claims.
      </p>
    </Notice>
  );
}
