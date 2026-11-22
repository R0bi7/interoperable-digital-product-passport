"use client";

import {
  type ChallengeRecord,
  type OwnershipProof,
  ownershipTypedData,
} from "@idpp/passport-config";
import { useState } from "react";
import { useAccount, useSignTypedData, useSwitchChain } from "wagmi";
import { ConnectGate } from "@/components/connect-gate";
import { Notice } from "@/components/notice";
import { Button } from "@/components/ui/button";
import { readSigningChallenge } from "@/features/read/ownership-service";
import { ActionPanel, actionLayoutClass } from "@/features/write/components/ui";
import { OwnershipQr } from "./ownership-qr";
import { ScanView } from "./scan-view";

export function ProveOwner() {
  const { address, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { signTypedDataAsync } = useSignTypedData();
  const [challenge, setChallenge] = useState<ChallengeRecord | null>(null);
  const [proof, setProof] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sign() {
    if (!address || !challenge || busy) return;
    setBusy(true);
    setProof(null);
    setError(null);
    try {
      // Recheck the local expiry before prompting the wallet, and again after a network switch.
      readSigningChallenge(
        JSON.stringify({ kind: "idpp-ownership-challenge", v: 1, ...challenge }),
      );
      if (chainId !== challenge.chainId) await switchChainAsync({ chainId: challenge.chainId });
      readSigningChallenge(
        JSON.stringify({ kind: "idpp-ownership-challenge", v: 1, ...challenge }),
      );
      const signature = await signTypedDataAsync(ownershipTypedData(challenge, address));
      const answer: OwnershipProof = {
        kind: "idpp-ownership-proof",
        v: 1,
        ...challenge,
        holder: address,
        signature,
      };
      setProof(JSON.stringify(answer));
    } catch (failure) {
      setError((failure as Error).message.split("\n")[0] ?? "Wallet signature failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={actionLayoutClass}>
      <div className="min-w-0 space-y-8">
        <section className="space-y-5">
          <h2 className="text-lg font-semibold tracking-tight">Read a challenge</h2>
          <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
            Scan the verifier’s challenge, check the token and chain, then sign with the wallet that
            holds the token. Show the resulting QR code back to the verifier. Signing costs no gas.
          </p>
          <ScanView
            onDecode={(text) => {
              setChallenge(null);
              setProof(null);
              setError(null);
              setChallenge(readSigningChallenge(text));
            }}
            inputLabel="Ownership challenge text"
            submitLabel="Read ownership challenge"
          />
        </section>
        {proof && (
          <section className="space-y-5 border-t pt-6">
            <h2 className="text-lg font-semibold tracking-tight">Ownership proof</h2>
            <OwnershipQr value={proof} label="Ownership proof" />
          </section>
        )}
      </div>
      <ActionPanel title="Review and sign" busy={busy}>
        {challenge ? (
          <>
            <p role="status" className="text-sm leading-relaxed [overflow-wrap:anywhere]">
              Sign for token {challenge.tokenId} on chain {challenge.chainId}, contract{" "}
              {challenge.contract}. The challenge expires at{" "}
              {new Date(Number(challenge.expiresAt) * 1000).toLocaleTimeString()}.
            </p>
            <ConnectGate>
              <div>
                <Button className="w-full" onClick={() => void sign()} disabled={!address || busy}>
                  {busy ? "Confirm the signature in your wallet…" : "Sign ownership challenge"}
                </Button>
              </div>
            </ConnectGate>
          </>
        ) : (
          <p className="text-sm leading-relaxed text-muted-foreground">
            Read a challenge to review its token and chain before signing.
          </p>
        )}
        {error && <Notice tone="error">{error}</Notice>}
      </ActionPanel>
    </div>
  );
}
