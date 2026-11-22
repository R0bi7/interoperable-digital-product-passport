"use client";

import {
  canonicalize,
  computeCidV1,
  MANIFEST,
  type PassportEnvelope,
  whiskyDistilleryAbi,
} from "@idpp/passport-config";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { useAccount, useSignMessage, useSwitchChain, useWriteContract } from "wagmi";
import { ConnectGate } from "@/components/connect-gate";
import { DataEditor } from "@/features/write/components/data-editor";
import {
  ActionPanel,
  actionLayoutClass,
  buttonClass,
  Notice,
  secondaryButtonClass,
  TxLink,
} from "@/features/write/components/ui";
import { useLocatedPassport, usePublicClientFor } from "@/features/write/hooks/use-passport";
import { ApiClientError } from "@/features/write/lib/api";
import { buildData, type Draft, draftFromData } from "@/features/write/lib/draft";
import { chainName } from "@/features/write/lib/links";
import { canRevise, type PassportRecord } from "@/features/write/lib/locate";
import {
  isChallengeLost,
  pinWithSignature,
  SignatureRejectedError,
} from "@/features/write/lib/pin-client";
import { decodeRevert } from "@/features/write/lib/revert";
import { buildSuccessorEnvelope, checkEnvelope } from "@/features/write/lib/successor";

type Phase =
  | { step: "idle" }
  | { step: "signing" }
  | { step: "pinning" }
  | { step: "wallet"; cid: string }
  | { step: "confirming"; cid: string; hash: `0x${string}` }
  | { step: "done"; cid: string; hash: `0x${string}`; revision: bigint }
  | { step: "stale"; expected: bigint; actual: bigint }
  | { step: "rejected" }
  | { step: "staleBase"; message: string }
  | { step: "error"; message: string };

export function ReviseForm({ tokenId }: { tokenId: bigint }) {
  const passport = useLocatedPassport(tokenId);

  if (passport.isPending) return <Notice tone="info">Reading the passport from the chains…</Notice>;
  if (passport.isError) {
    return <Notice tone="error">Could not read the passport: {passport.error.message}</Notice>;
  }
  const { location, payload } = passport.data;
  if (location.kind === "unknown") {
    return <Notice tone="warn">Cannot tell where the token is: {location.reason}.</Notice>;
  }
  if (location.kind === "not_held") {
    return (
      <Notice tone="warn">
        Token {tokenId.toString()} is not held on any chain of this deployment right now. It may be
        in flight between chains; revising needs the token on a chain.
      </Notice>
    );
  }
  if (!payload?.ok) {
    return (
      <Notice tone="error">
        The current payload could not be verified, so it cannot be used to prefill a revision:{" "}
        {payload?.reason ?? "not loaded"}.
      </Notice>
    );
  }
  return (
    // A reload remounts the editor, so every retry is prepared against freshly read state.
    <ReviseEditor
      key={`${location.record.blockNumber}-${location.record.revision}`}
      tokenId={tokenId}
      record={location.record}
      current={payload.envelope}
      onReload={() => passport.refetch()}
    />
  );
}

function ReviseEditor({
  tokenId,
  record,
  current,
  onReload,
}: {
  tokenId: bigint;
  record: PassportRecord;
  current: PassportEnvelope;
  onReload: () => void;
}) {
  const { address: account, chainId: walletChain } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const { signMessageAsync } = useSignMessage();
  const clientFor = usePublicClientFor();

  const [draft, setDraft] = useState<Draft>(() => draftFromData(current.data));
  const [phase, setPhase] = useState<Phase>({ step: "idle" });

  const authorized = useQuery({
    queryKey: ["write", "can-revise", tokenId.toString(), record.blockNumber.toString(), account],
    queryFn: () => canRevise(clientFor(record.chainId), record, account),
    enabled: account !== undefined,
  });

  // Prepared against this revision; the contract rejects the write if another revision landed since.
  const expectedRevision = record.revision;
  const candidate = buildSuccessorEnvelope(
    current,
    record.cid,
    buildData(current.kind, current.granularity, draft),
  );
  const check = checkEnvelope(candidate);
  const busy =
    phase.step === "signing" ||
    phase.step === "pinning" ||
    phase.step === "wallet" ||
    phase.step === "confirming";

  const problem = !account
    ? `Connect an issuer wallet of ${chainName(record.chainId)}.`
    : authorized.isPending
      ? "Checking authorization…"
      : authorized.isError
        ? `Could not read isIssuer on ${chainName(record.chainId)}: ${authorized.error.message.split("\n")[0]}. Reload to retry.`
        : authorized.data !== true
          ? `The connected wallet is not an issuer on ${chainName(record.chainId)}, where the token is, so it cannot revise this passport. Only issuers revise; holding the token gives the right to transfer and send it, not to change its data.`
          : !check.ok
            ? check.message
            : undefined;

  async function submit() {
    if (!account || !check.ok || authorized.data !== true) return;
    try {
      // The server pins only for an issuer of the chain holding the token: sign its one-time challenge.
      setPhase({ step: "signing" });
      const pinned = await pinWithSignature(check.envelope, account, (message) =>
        signMessageAsync({ message }),
      );
      setPhase({ step: "pinning" });
      // The server already asserted this; the browser repeats it before anything is signed.
      if (
        pinned.cid !== check.predictedCid ||
        computeCidV1(canonicalize(check.envelope)) !== pinned.cid
      ) {
        throw new Error(
          `server pinned ${pinned.cid} but the local prediction is ${check.predictedCid}`,
        );
      }
      const { cid } = pinned;

      if (walletChain !== record.chainId) await switchChainAsync({ chainId: record.chainId });
      const address = MANIFEST.chains.find((chain) => chain.chainId === record.chainId)?.address;
      if (!address) throw new Error(`chain ${record.chainId} is not part of the deployment`);
      const args = [tokenId, expectedRevision, cid] as const;

      // Simulate first: the revert (StaleRevision) is decoded from eth_call, not from wallet-specific errors.
      await clientFor(record.chainId).simulateContract({
        account,
        address,
        abi: whiskyDistilleryAbi,
        functionName: "revise",
        args,
      });
      setPhase({ step: "wallet", cid });
      const hash = await writeContractAsync({
        chainId: record.chainId,
        address,
        abi: whiskyDistilleryAbi,
        functionName: "revise",
        args,
      });
      setPhase({ step: "confirming", cid, hash });
      // The viem client, not wagmi's action: that one throws for a reverted receipt after replaying
      // the call, and a custom error (StaleRevision) then reads "Execution reverted for an unknown reason".
      const receipt = await clientFor(record.chainId).waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") {
        // Both pages passed the pin check and the simulation before either revise landed: the
        // contract let one through and reverted the other (StaleRevision), which still cost gas.
        throw new Error(
          `Revise transaction ${hash} was mined but reverted, most likely because another revision landed first (StaleRevision). Nothing was written; the gas of this transaction is spent. Reload the page to see the current revision.`,
        );
      }
      setPhase({ step: "done", cid, hash, revision: expectedRevision + 1n });
    } catch (error) {
      if (error instanceof SignatureRejectedError) {
        setPhase({ step: "rejected" });
        return;
      }
      if (error instanceof ApiClientError && error.code === "stale_base") {
        setPhase({ step: "staleBase", message: error.message });
        return;
      }
      if (isChallengeLost(error)) {
        // The five-minute challenge ran out (or the server restarted) while the wallet was open.
        setPhase({
          step: "error",
          message:
            "The signature challenge expired or is no longer valid, so nothing was pinned. Press the button again to get a fresh one.",
        });
        return;
      }
      const revert = decodeRevert(error);
      if (error instanceof ApiClientError && error.code === "not_issuer") {
        setPhase({
          step: "error",
          message: `Refused: ${error.message}. Nothing was pinned or written.`,
        });
        return;
      }
      if (revert?.name === "StaleRevision") {
        setPhase({
          step: "stale",
          expected: BigInt(revert.args[0] as bigint),
          actual: BigInt(revert.args[1] as bigint),
        });
      } else if (revert?.name === "NotIssuer") {
        setPhase({
          step: "error",
          message: `The contract rejected the revision: the connected wallet is not an issuer on ${chainName(record.chainId)} (NotIssuer). Nothing was written.`,
        });
      } else if (revert) {
        setPhase({ step: "error", message: `The contract rejected the revision: ${revert.name}.` });
      } else {
        setPhase({
          step: "error",
          message:
            error instanceof ApiClientError
              ? `${error.code}: ${error.message}`
              : ((error as Error).message.split("\n")[0] ?? "failed"),
        });
      }
    }
  }

  return (
    <div className={actionLayoutClass}>
      <div className="min-w-0 space-y-8">
        <section className="space-y-3 border-b pb-6 text-sm leading-relaxed">
          <h2 className="text-lg font-semibold tracking-tight">Current passport</h2>
          <div>
            On {chainName(record.chainId)} at block {record.blockNumber.toString()}: revision{" "}
            <span className="font-mono">{record.revision.toString()}</span>, held by{" "}
            <span className="break-all font-mono">{record.owner}</span>.
          </div>
          <div className="break-all">
            Current CID: <span className="font-mono">{record.cid}</span>
          </div>
          <div>
            This revision will be <strong>revision {(expectedRevision + 1n).toString()}</strong>,
            written with{" "}
            <code>revise(tokenId, expectedRevision = {expectedRevision.toString()}, cid)</code>.
          </div>
        </section>

        <fieldset disabled={busy || phase.step === "done"} className="min-w-0 space-y-5">
          <legend className="mb-2 text-lg font-semibold tracking-tight">Revision details</legend>
          <DataEditor
            kind={current.kind}
            granularity={current.granularity}
            draft={draft}
            onChange={setDraft}
          />
        </fieldset>
      </div>
      <ActionPanel title="Review revision" busy={busy}>
        <dl className="space-y-3 border-y py-4 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Network</dt>
            <dd className="text-right font-medium">{chainName(record.chainId)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Current revision</dt>
            <dd className="font-mono">{expectedRevision.toString()}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">New revision</dt>
            <dd className="font-mono">{(expectedRevision + 1n).toString()}</dd>
          </div>
        </dl>
        {problem ? (
          <p role="status" className="text-sm leading-relaxed">
            {problem}
          </p>
        ) : null}

        <div>
          <ConnectGate>
            <button
              type="button"
              className={`${buttonClass} w-full`}
              disabled={Boolean(problem) || busy || phase.step === "done"}
              onClick={submit}
            >
              {phase.step === "signing"
                ? "Sign the challenge in your wallet…"
                : phase.step === "pinning"
                  ? "Pinning and verifying…"
                  : phase.step === "wallet"
                    ? "Confirm in your wallet…"
                    : phase.step === "confirming"
                      ? "Waiting for confirmation…"
                      : "Pin and revise"}
            </button>
          </ConnectGate>
        </div>

        {phase.step === "stale" ? (
          <Notice tone="warn">
            <p>
              <strong>StaleRevision.</strong> This revision was prepared against revision{" "}
              {phase.expected.toString()}, but the chain is already at revision{" "}
              {phase.actual.toString()}. Another revision landed first, so nothing was written.
            </p>
            <div className="mt-2">
              <button type="button" className={secondaryButtonClass} onClick={onReload}>
                Reload and retry
              </button>
            </div>
          </Notice>
        ) : null}
        {phase.step === "staleBase" ? (
          <Notice tone="warn">
            <p>
              <strong>Out of date.</strong> Another revision landed first, so nothing was pinned.
            </p>
            <p className="mt-1 text-xs opacity-80">Server: {phase.message}</p>
            <div className="mt-2">
              <button type="button" className={secondaryButtonClass} onClick={onReload}>
                Reload and retry
              </button>
            </div>
          </Notice>
        ) : null}
        {phase.step === "rejected" ? (
          <Notice tone="warn">
            The signature request was rejected in the wallet. Nothing was pinned and nothing was
            written; press the button again to retry.
          </Notice>
        ) : null}
        {phase.step === "error" ? <Notice tone="error">{phase.message}</Notice> : null}
        {phase.step === "confirming" || phase.step === "done" ? (
          <Notice tone={phase.step === "done" ? "ok" : "info"}>
            <div>
              Transaction: <TxLink chainId={record.chainId} hash={phase.hash} />
            </div>
            <div className="break-all">
              New CID: <span className="font-mono">{phase.cid}</span>
            </div>
            {phase.step === "done" ? (
              <div>
                Revision {phase.revision.toString()} recorded.{" "}
                <Link className="underline" href={`/passport/${tokenId.toString()}`}>
                  Open /passport/{tokenId.toString()}
                </Link>
              </div>
            ) : null}
          </Notice>
        ) : null}
      </ActionPanel>
    </div>
  );
}
