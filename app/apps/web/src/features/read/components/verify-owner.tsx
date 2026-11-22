"use client";

import { type ChallengeRecord, encodeOwnershipChallenge } from "@idpp/passport-config";
import { useRef, useState } from "react";
import { Notice } from "@/components/notice";
import { Button } from "@/components/ui/button";
import {
  checkOwnershipResponse,
  createOwnershipChallenge,
  locateOwnership,
  type OwnershipCheck,
  type OwnershipLocation,
} from "@/features/read/ownership-service";
import { ActionPanel, actionLayoutClass } from "@/features/write/components/ui";
import { OwnershipQr } from "./ownership-qr";
import { ScanView } from "./scan-view";

export function VerifyOwner({ tokenId }: { tokenId: string }) {
  const [challenge, setChallenge] = useState<ChallengeRecord | null>(null);
  const [location, setLocation] = useState<OwnershipLocation | null>(null);
  const [result, setResult] = useState<OwnershipCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const consumed = useRef(new Set<string>());

  async function create() {
    setBusy(true);
    setChallenge(null);
    setResult(null);
    try {
      const located = await locateOwnership(BigInt(tokenId));
      setLocation(located);
      if (located.kind === "held") setChallenge(createOwnershipChallenge(tokenId, located.record));
    } catch {
      setLocation({
        kind: "error",
        reason: "Could not create a secure ownership challenge. Reload to retry.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function scan(text: string) {
    if (!challenge) throw new Error("Create a challenge first.");
    if (busy) throw new Error("An ownership check is already running.");
    setBusy(true);
    setResult(null);
    try {
      setResult(await checkOwnershipResponse(text, challenge, consumed.current));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={actionLayoutClass}>
      <div className="min-w-0 space-y-8">
        <section className="space-y-5">
          <h2 className="text-lg font-semibold tracking-tight">Ownership challenge</h2>
          <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
            Create a two-minute challenge on this device. The holder scans it with the Prove
            ownership page and signs it; scan their answer here.
          </p>
          <Button
            className="min-h-11 max-w-full whitespace-normal"
            onClick={() => void create()}
            disabled={busy}
          >
            {busy ? "Reading the chain…" : "Create ownership challenge"}
          </Button>
          {location?.kind === "unknown" && <Notice tone="warn">{location.reason}</Notice>}
          {location?.kind === "error" && (
            <Notice tone="error">Could not locate ownership: {location.reason}</Notice>
          )}
          {location?.kind === "in_transit" && (
            <Notice tone="warn">
              The token is in transit: no chain holds it. Wait for delivery before checking
              ownership.
            </Notice>
          )}
          {challenge && (
            <>
              <p role="status" className="text-sm leading-relaxed [overflow-wrap:anywhere]">
                Token {challenge.tokenId} on chain {challenge.chainId}. This challenge expires at{" "}
                {new Date(Number(challenge.expiresAt) * 1000).toLocaleTimeString()}.
              </p>
              <OwnershipQr
                value={encodeOwnershipChallenge(challenge)}
                label="Ownership challenge"
              />
            </>
          )}
        </section>
        {challenge && (
          <section className="space-y-5 border-t pt-6">
            <h2 className="text-lg font-semibold tracking-tight">Scan the holder’s answer</h2>
            <ScanView
              key={challenge.nonce}
              onDecode={scan}
              inputLabel="Ownership proof text"
              submitLabel="Verify ownership proof"
            />
          </section>
        )}
        <div aria-live="polite">
          {result?.ok && (
            <Notice tone="ok">
              Ownership verified: {result.signer} signed this challenge and owns the token at the
              fresh chain read. The challenge is now consumed.
            </Notice>
          )}
          {result && !result.ok && (
            <Notice tone="error">
              Ownership not verified: {result.code.replaceAll("_", " ")}.{" "}
              {result.code === "chain_unavailable"
                ? "The fresh owner read failed; retry when the chain is available."
                : "Ask for a new challenge if needed."}
            </Notice>
          )}
        </div>
      </div>
      <ActionPanel title="Verification scope">
        <p className="text-sm leading-relaxed text-muted-foreground">
          This proves a signature from the owning address at the block read. A relayed answer can
          pass, and this does not authenticate the physical item. Shared or custodial keys defeat
          the check; contract wallets are not supported.
        </p>
      </ActionPanel>
    </div>
  );
}
