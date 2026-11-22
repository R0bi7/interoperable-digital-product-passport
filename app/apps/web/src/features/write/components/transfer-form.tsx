"use client";

import { MANIFEST, whiskyDistilleryAbi } from "@idpp/passport-config";
import Link from "next/link";
import { useState } from "react";
import { type Address, getAddress } from "viem";
import { useAccount, useSwitchChain, useWriteContract } from "wagmi";
import { ConnectGate } from "@/components/connect-gate";
import {
  ActionPanel,
  actionLayoutClass,
  buttonClass,
  Field,
  inputClass,
  Notice,
  secondaryButtonClass,
  TxLink,
} from "@/features/write/components/ui";
import { useLocatedPassport, usePublicClientFor } from "@/features/write/hooks/use-passport";
import { chainName } from "@/features/write/lib/links";
import type { PassportRecord } from "@/features/write/lib/locate";
import { decodeRevert } from "@/features/write/lib/revert";
import {
  type AfterTransfer,
  checkAfterTransfer,
  parseTransfer,
  type ReadBackCheck,
  transferProblem,
} from "@/features/write/lib/transfer";

export function TransferForm({ tokenId }: { tokenId: bigint }) {
  const passport = useLocatedPassport(tokenId);

  if (passport.isPending) return <Notice tone="info">Reading the passport from the chains…</Notice>;
  if (passport.isError) {
    return <Notice tone="error">Could not read the passport: {passport.error.message}</Notice>;
  }
  const { location } = passport.data;
  if (location.kind === "unknown") {
    return <Notice tone="warn">Cannot tell where the token is: {location.reason}.</Notice>;
  }
  if (location.kind === "not_held") {
    return (
      <Notice tone="warn">
        Token {tokenId.toString()} is not held on any chain of this deployment right now. It may be
        in flight to another chain; a transfer needs the token on a chain.
      </Notice>
    );
  }
  return (
    <TransferPanel
      key={location.record.blockNumber.toString()}
      tokenId={tokenId}
      record={location.record}
    />
  );
}

type ReadBack = { kind: "read"; check: ReadBackCheck } | { kind: "unread"; message: string };

type Hash = `0x${string}`;

type TransferState =
  | { step: "idle" }
  | { step: "working"; label: string; hash?: Hash }
  /** Nothing was submitted; the user may try again. */
  | { step: "error"; message: string }
  /** A transaction was submitted but did not end in a confirmed transfer; no resubmission. */
  | { step: "submitted"; hash: Hash; message: string }
  | { step: "done"; hash: Hash; receiver: Address; readBack: ReadBack };

const RECEIPT_TIMEOUT_MS = 180_000;
const READ_BACK_ATTEMPTS = 3;
const READ_BACK_DELAY_MS = 1500;

function TransferPanel({ tokenId, record }: { tokenId: bigint; record: PassportRecord }) {
  const { address: account, chainId: walletChain } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const clientFor = usePublicClientFor();

  const contract = MANIFEST.chains.find((chain) => chain.chainId === record.chainId)?.address;
  const [receiverInput, setReceiverInput] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [state, setState] = useState<TransferState>({ step: "idle" });

  const busy = state.step === "working";
  // Once a transaction exists, the page never offers a second one: reopen the passport instead.
  const finished = state.step === "done" || state.step === "submitted";
  const receiver = receiverInput.trim();
  const problem = contract
    ? transferProblem({ record, account, receiver, confirmed })
    : `Chain ${record.chainId} is not part of this deployment.`;

  /** Reads owner and passport at the receipt's block; public RPCs can lag one block behind. */
  async function readBack(blockNumber: bigint, to: Address): Promise<ReadBack> {
    if (!contract) return { kind: "unread", message: "unknown contract" };
    const client = clientFor(record.chainId);
    let message = "read failed";
    for (let attempt = 0; attempt < READ_BACK_ATTEMPTS; attempt += 1) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, READ_BACK_DELAY_MS));
      try {
        const [owner, passport] = await Promise.all([
          client.readContract({
            address: contract,
            abi: whiskyDistilleryAbi,
            functionName: "ownerOf",
            args: [tokenId],
            blockNumber,
          }),
          client.readContract({
            address: contract,
            abi: whiskyDistilleryAbi,
            functionName: "passportOf",
            args: [tokenId],
            blockNumber,
          }),
        ]);
        const after: AfterTransfer = {
          owner,
          revision: BigInt(passport.revision),
          cid: passport.cid,
          historyHash: passport.historyHash,
        };
        return { kind: "read", check: checkAfterTransfer(record, to, after) };
      } catch (error) {
        message = (error as Error).message.split("\n")[0] ?? message;
      }
    }
    return { kind: "unread", message };
  }

  async function transfer() {
    if (!account || !contract || problem || busy || finished) return;
    const to = getAddress(receiver);
    let hash: Hash | undefined;
    try {
      if (walletChain !== record.chainId) {
        setState({ step: "working", label: `Switching wallet to ${chainName(record.chainId)}…` });
        await switchChainAsync({ chainId: record.chainId });
      }
      const args = [account, to, tokenId] as const;
      setState({ step: "working", label: "Checking the transfer…" });
      // `safeTransferFrom` refuses a contract receiver that cannot hold ERC-721 tokens.
      await clientFor(record.chainId).simulateContract({
        account,
        address: contract,
        abi: whiskyDistilleryAbi,
        functionName: "safeTransferFrom",
        args,
      });
      setState({ step: "working", label: "Confirm the transfer in your wallet…" });
      hash = await writeContractAsync({
        chainId: record.chainId,
        address: contract,
        abi: whiskyDistilleryAbi,
        functionName: "safeTransferFrom",
        args,
      });
      setState({ step: "working", label: "Waiting for the transaction…", hash });
      // The viem client, not wagmi's action: that one throws for a reverted receipt after replaying
      // the call, which would hide that the transaction was mined and its gas spent.
      const receipt = await clientFor(record.chainId).waitForTransactionReceipt({
        hash,
        timeout: RECEIPT_TIMEOUT_MS,
      });
      // A wallet may replace the pending transaction (speed-up); the receipt names the mined one.
      hash = receipt.transactionHash;
      if (receipt.status !== "success") {
        setState({
          step: "submitted",
          hash,
          message:
            "The transaction was mined but reverted, for example because the token changed hands or left the chain after the check. Ownership did not change; the gas of this transaction is spent.",
        });
        return;
      }
      const event = parseTransfer(receipt.logs as never, contract, tokenId, account);
      if (!event || event.to.toLowerCase() !== to.toLowerCase()) {
        setState({
          step: "submitted",
          hash,
          message:
            "The transaction succeeded, but its receipt has no transfer of this token to the new holder. Reopen the passport to check its owner.",
        });
        return;
      }
      setState({ step: "working", label: "Reading the new owner…", hash });
      setState({
        step: "done",
        hash,
        receiver: to,
        readBack: await readBack(receipt.blockNumber, to),
      });
    } catch (error) {
      const reason = (error as Error).message.split("\n")[0] ?? "unknown error";
      if (hash) {
        // The wallet broadcast the transaction; its outcome is unknown, so never offer a retry.
        setState({
          step: "submitted",
          hash,
          message: `The transaction was submitted, but its outcome could not be read (${reason}). Check the transaction link and reopen the passport before trying again.`,
        });
        return;
      }
      const revert = decodeRevert(error);
      setState({
        step: "error",
        message: revert
          ? `The contract rejected the transfer: ${revert.name}. Nothing was submitted.`
          : reason,
      });
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
          <div>
            The token stays on {chainName(record.chainId)} under the same id. Only its holder
            changes; the passport record (revision, CID and history hash) is not touched, and
            issuers keep the right to revise it.
          </div>
        </section>
        <section className="space-y-5">
          <h2 className="text-lg font-semibold tracking-tight">New holder</h2>
          <Field label="New holder address" hint="The account that will hold the passport token.">
            <input
              className={`${inputClass} font-mono`}
              value={receiverInput}
              placeholder="0x…"
              spellCheck={false}
              autoComplete="off"
              disabled={busy || finished}
              onChange={(event) => {
                setReceiverInput(event.target.value);
                // The confirmation applies to the address shown under "To".
                setConfirmed(false);
              }}
            />
          </Field>
          <label className="flex items-start gap-3 text-sm leading-relaxed">
            <input
              type="checkbox"
              className="mt-1 size-4 shrink-0 accent-foreground"
              checked={confirmed}
              disabled={busy || finished}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            <span>
              I understand that I give up control of this token: afterwards only the new holder, or
              an account the new holder approves, can transfer it, and only the new holder can send
              it to another chain.
            </span>
          </label>
        </section>
      </div>
      <ActionPanel title="Review ownership transfer" busy={busy}>
        <dl className="space-y-3 border-y py-4 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Chain</dt>
            <dd className="text-right font-medium">{chainName(record.chainId)}</dd>
          </div>
          <div className="space-y-1">
            <dt className="text-muted-foreground">From</dt>
            <dd className="break-all font-mono text-xs leading-relaxed">{record.owner}</dd>
          </div>
          <div className="space-y-1">
            <dt className="text-muted-foreground">To</dt>
            <dd className="break-all font-mono text-xs leading-relaxed">
              {receiver || "Enter the new holder's address."}
            </dd>
          </div>
        </dl>
        <p className="text-sm leading-relaxed text-muted-foreground">
          A standard ERC-721 transfer on this chain: network gas only, no LayerZero messaging fee.
        </p>

        {problem && !finished ? (
          <p role="status" className="text-sm leading-relaxed">
            {problem}
          </p>
        ) : null}

        <div>
          <ConnectGate>
            <button
              type="button"
              className={`${buttonClass} w-full`}
              disabled={Boolean(problem) || busy || finished}
              onClick={transfer}
            >
              {state.step === "working" ? state.label : "Transfer ownership"}
            </button>
          </ConnectGate>
        </div>

        {state.step === "error" ? <Notice tone="error">{state.message}</Notice> : null}

        {state.step === "working" && state.hash ? (
          <Notice tone="info">
            Transaction: <TxLink chainId={record.chainId} hash={state.hash} />
          </Notice>
        ) : null}

        {state.step === "submitted" ? (
          <Notice tone="warn">
            <span>{state.message}</span>
            <span>
              Transaction: <TxLink chainId={record.chainId} hash={state.hash} />
            </span>
          </Notice>
        ) : null}

        {state.step === "done" ? (
          <>
            <Notice tone="info">
              Transaction: <TxLink chainId={record.chainId} hash={state.hash} />
            </Notice>
            {state.readBack.kind === "unread" ? (
              <Notice tone="warn">
                The transaction succeeded, but the new owner could not be read back yet (
                {state.readBack.message}). Reopen the passport to check.
              </Notice>
            ) : state.readBack.check.ownerAgrees ? (
              <Notice tone="ok">
                Confirmed by a read at the transaction's block: {state.receiver} holds the token.
              </Notice>
            ) : (
              <Notice tone="error">
                The read at the transaction's block does not show {state.receiver} as the owner.
                Reopen the passport to check.
              </Notice>
            )}
            {state.readBack.kind === "read" ? (
              state.readBack.check.passportChanges.length === 0 ? (
                <Notice tone="info">
                  The passport record is unchanged at revision {record.revision.toString()}.
                </Notice>
              ) : (
                <Notice tone="warn">
                  The passport record changed since this page was loaded (
                  {state.readBack.check.passportChanges.join(", ")}). A transfer does not touch the
                  record, so it was revised in the meantime.
                </Notice>
              )
            ) : null}
          </>
        ) : null}

        {finished ? (
          <Link href={`/passport/${tokenId}`} className={`${secondaryButtonClass} w-full`}>
            Open the passport
          </Link>
        ) : null}
      </ActionPanel>
    </div>
  );
}
