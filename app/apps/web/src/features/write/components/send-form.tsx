"use client";

import { MANIFEST, whiskyDistilleryAbi } from "@idpp/passport-config";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { formatEther, isAddress } from "viem";
import { useAccount, useConfig, useSwitchChain, useWriteContract } from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";
import { ConnectGate } from "@/components/connect-gate";
import {
  DeliveryProgress,
  type DeliveryProps,
} from "@/features/write/components/delivery-progress";
import {
  ActionPanel,
  actionLayoutClass,
  buttonClass,
  Field,
  inputClass,
  Notice,
  TxLink,
} from "@/features/write/components/ui";
import { useLocatedPassport, usePublicClientFor } from "@/features/write/hooks/use-passport";
import { chainName } from "@/features/write/lib/links";
import { isHolder, type PassportRecord } from "@/features/write/lib/locate";
import { decodeRevert } from "@/features/write/lib/revert";
import { buildSendParam, parseOnftSent } from "@/features/write/lib/send-param";
import { getViemChain } from "@/lib/chains";

export function SendForm({ tokenId }: { tokenId: bigint }) {
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
        Token {tokenId.toString()} is not held on any chain of this deployment right now. It may
        already be in flight; sending needs the token on a chain.
      </Notice>
    );
  }
  return (
    <SendPanel
      key={location.record.blockNumber.toString()}
      tokenId={tokenId}
      record={location.record}
    />
  );
}

type SendState =
  | { step: "idle" }
  | { step: "working"; label: string }
  | { step: "error"; message: string }
  | {
      step: "sent";
      hash: `0x${string}`;
      delivery: Omit<DeliveryProps, "sourceReceipt">;
      fee: bigint;
    };

function SendPanel({ tokenId, record }: { tokenId: bigint; record: PassportRecord }) {
  const { address: account, chainId: walletChain } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const config = useConfig();
  const clientFor = usePublicClientFor();

  const destinations = MANIFEST.chains.filter((chain) => chain.chainId !== record.chainId);
  const source = MANIFEST.chains.find((chain) => chain.chainId === record.chainId);
  const [destinationId, setDestinationId] = useState<number>(destinations[0]?.chainId ?? 0);
  const [receiverInput, setReceiverInput] = useState<string | undefined>(undefined);
  const [state, setState] = useState<SendState>({ step: "idle" });

  const destination = destinations.find((chain) => chain.chainId === destinationId);
  const receiver = receiverInput ?? account ?? "";
  const holder = isHolder(record, account);
  const nativeSymbol = getViemChain(record.chainId)?.nativeCurrency.symbol ?? "native";

  const quote = useQuery({
    queryKey: ["write", "quote", tokenId.toString(), destinationId, receiver],
    enabled: Boolean(destination && source && isAddress(receiver)),
    refetchOnWindowFocus: false,
    queryFn: async () => {
      if (!destination || !source) throw new Error("unknown chain");
      return clientFor(record.chainId).readContract({
        address: source.address,
        abi: whiskyDistilleryAbi,
        functionName: "quoteSend",
        args: [buildSendParam(destination.eid, receiver as `0x${string}`, tokenId), false],
      });
    },
  });

  const problem = !account
    ? "Connect the wallet that holds this passport."
    : !holder
      ? `Only the holder can send. The holder is ${record.owner}.`
      : !destination
        ? "Choose a destination chain."
        : !isAddress(receiver)
          ? "Receiver is not a valid address."
          : undefined;
  const busy = state.step === "working";

  async function send() {
    if (!account || !destination || !source || !isAddress(receiver)) return;
    try {
      setState({ step: "working", label: "Quoting the LayerZero fee…" });
      const sendParam = buildSendParam(destination.eid, receiver, tokenId);
      // Re-quote right before sending so the value covers the current fee.
      const fee = await clientFor(record.chainId).readContract({
        address: source.address,
        abi: whiskyDistilleryAbi,
        functionName: "quoteSend",
        args: [sendParam, false],
      });
      const args = [sendParam, { nativeFee: fee.nativeFee, lzTokenFee: 0n }, account] as const;

      if (walletChain !== record.chainId) {
        setState({ step: "working", label: `Switching wallet to ${chainName(record.chainId)}…` });
        await switchChainAsync({ chainId: record.chainId });
      }
      await clientFor(record.chainId).simulateContract({
        account,
        address: source.address,
        abi: whiskyDistilleryAbi,
        functionName: "send",
        args,
        value: fee.nativeFee,
      });
      setState({ step: "working", label: "Confirm the send in your wallet…" });
      const hash = await writeContractAsync({
        chainId: record.chainId,
        address: source.address,
        abi: whiskyDistilleryAbi,
        functionName: "send",
        args,
        value: fee.nativeFee,
      });
      setState({ step: "working", label: "Waiting for the source transaction…" });
      const receipt = await waitForTransactionReceipt(config, { chainId: record.chainId, hash });
      if (receipt.status !== "success") throw new Error(`send transaction ${hash} reverted`);
      const event = parseOnftSent(receipt.logs as never, source.address, tokenId);
      if (!event) throw new Error("the receipt has no ONFTSent event for this token");
      setState({
        step: "sent",
        hash,
        fee: fee.nativeFee,
        delivery: {
          txHash: hash,
          guid: event.guid,
          tokenId,
          destinationChainId: destination.chainId,
          receiver,
          sent: { revision: record.revision, cid: record.cid },
        },
      });
    } catch (error) {
      const revert = decodeRevert(error);
      setState({
        step: "error",
        message: revert
          ? `The contract rejected the send: ${revert.name}.`
          : ((error as Error).message.split("\n")[0] ?? "send failed"),
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
            The token is burned here and minted under the same id on the destination, carrying the
            snapshot (revision {record.revision.toString()}, current CID).
          </div>
        </section>
        <section className="space-y-5">
          <h2 className="text-lg font-semibold tracking-tight">Transfer details</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Destination chain">
              <select
                className={inputClass}
                value={destinationId}
                disabled={busy || state.step === "sent"}
                onChange={(event) => setDestinationId(Number(event.target.value))}
              >
                {destinations.map((chain) => (
                  <option key={chain.chainId} value={chain.chainId}>
                    {chainName(chain.chainId)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Receiver" hint="Defaults to the connected wallet.">
              <input
                className={`${inputClass} font-mono`}
                value={receiver}
                disabled={busy || state.step === "sent"}
                onChange={(event) => setReceiverInput(event.target.value)}
              />
            </Field>
          </div>
        </section>
        {state.step === "sent" ? (
          <DeliveryProgress {...state.delivery} sourceReceipt="success" />
        ) : null}
      </div>
      <ActionPanel title="Review transfer" busy={busy}>
        <dl className="space-y-3 border-y py-4 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">From</dt>
            <dd className="text-right font-medium">{chainName(record.chainId)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">To</dt>
            <dd className="text-right font-medium">{chainName(destinationId)}</dd>
          </div>
          <div className="space-y-1">
            <dt className="text-muted-foreground">Receiver</dt>
            <dd className="break-all font-mono text-xs leading-relaxed">
              {receiver || "Connect the holder wallet to fill this in."}
            </dd>
          </div>
        </dl>
        <div className="text-sm leading-relaxed" aria-live="polite">
          {quote.isFetching ? (
            "Quoting fee…"
          ) : quote.data ? (
            <>
              Native fee:{" "}
              <span className="font-mono">
                {formatEther(quote.data.nativeFee)} {nativeSymbol}
              </span>{" "}
              (paid with the transaction, refunded to your wallet if overpaid)
            </>
          ) : quote.isError ? (
            <span className="text-destructive">
              Fee quote failed: {quote.error.message.split("\n")[0]}
            </span>
          ) : null}
        </div>

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
              disabled={Boolean(problem) || busy || state.step === "sent"}
              onClick={send}
            >
              {state.step === "working" ? state.label : "Send"}
            </button>
          </ConnectGate>
        </div>

        {state.step === "error" ? <Notice tone="error">{state.message}</Notice> : null}

        {state.step === "sent" ? (
          <Notice tone="info">
            Source transaction: <TxLink chainId={record.chainId} hash={state.hash} /> (fee{" "}
            {formatEther(state.fee)} {nativeSymbol})
          </Notice>
        ) : null}
      </ActionPanel>
    </div>
  );
}
