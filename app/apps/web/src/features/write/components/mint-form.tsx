"use client";

import { MANIFEST } from "@idpp/passport-config";
import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { isAddress } from "viem";
import { useAccount, useSignMessage } from "wagmi";
import { ConnectGate } from "@/components/connect-gate";
import { DataEditor } from "@/features/write/components/data-editor";
import { buttonClass, Field, inputClass, Notice, TxLink } from "@/features/write/components/ui";
import {
  ApiClientError,
  getJson,
  type MintChallenge,
  type MintResponse,
  postJson,
} from "@/features/write/lib/api";
import { buildData, type Draft, type Granularity, type Kind } from "@/features/write/lib/draft";
import { chainName } from "@/features/write/lib/links";
import { mintDefaults } from "@/features/write/lib/mint-defaults";
import { checkEnvelope } from "@/features/write/lib/successor";

export function MintForm() {
  const { address: account } = useAccount();
  const { signMessageAsync } = useSignMessage();

  const [kind, setKind] = useState<Kind>("cask");
  const [granularity, setGranularity] = useState<Granularity>("item");
  const [chainId, setChainId] = useState<number>(MANIFEST.chains[0]?.chainId ?? 0);
  const [recipient, setRecipient] = useState<string | undefined>(undefined);
  const [draft, setDraft] = useState<Draft>(() => mintDefaults("cask"));

  const to = recipient ?? account ?? "";
  const data = buildData(kind, granularity, draft);
  const preview = checkEnvelope({
    schema: "idpp-passport/1",
    deploymentId: MANIFEST.deploymentId,
    tokenId: "0",
    revision: "0",
    previousCid: null,
    kind,
    granularity,
    data,
  });
  const problem = !account
    ? "Connect the issuer wallet to sign the mint challenge."
    : !isAddress(to)
      ? "Recipient is not a valid address."
      : !preview.ok
        ? preview.message
        : undefined;

  const mint = useMutation<MintResponse, Error>({
    mutationFn: async () => {
      if (!account) throw new Error("wallet not connected");
      const challenge = await getJson<MintChallenge>(
        `/api/mint/challenge?address=${encodeURIComponent(account)}`,
      );
      const signature = await signMessageAsync({ message: challenge.message });
      return postJson<MintResponse>("/api/mint", {
        chainId,
        to,
        envelopeData: { kind, granularity, data },
        address: account,
        signature,
      });
    },
  });

  const error = mint.error;
  return (
    <form
      className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]"
      aria-busy={mint.isPending}
      onSubmit={(event) => {
        event.preventDefault();
        mint.mutate();
      }}
    >
      <div className="min-w-0 space-y-8">
        <fieldset disabled={mint.isPending} className="min-w-0 space-y-5">
          <legend className="mb-1 text-lg font-semibold tracking-tight">Passport setup</legend>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Kind">
              <select
                className={inputClass}
                value={kind}
                onChange={(event) => {
                  setKind(event.target.value as Kind);
                  setDraft(mintDefaults(event.target.value as Kind));
                }}
              >
                <option value="cask">Cask</option>
                <option value="bottle">Bottle</option>
              </select>
            </Field>
            <Field label="Granularity">
              <select
                className={inputClass}
                value={granularity}
                onChange={(event) => setGranularity(event.target.value as Granularity)}
              >
                <option value="item">Item</option>
                <option value="batch">Batch</option>
              </select>
            </Field>
            <Field label="Chain">
              <select
                className={inputClass}
                value={chainId}
                onChange={(event) => setChainId(Number(event.target.value))}
              >
                {MANIFEST.chains.map((chain) => (
                  <option key={chain.chainId} value={chain.chainId}>
                    {chainName(chain.chainId)}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field
            label="Recipient (holder of the new passport)"
            hint="Defaults to the connected wallet."
          >
            <input
              className={`${inputClass} font-mono`}
              value={to}
              onChange={(event) => setRecipient(event.target.value)}
              placeholder="0x…"
            />
          </Field>
        </fieldset>
        <fieldset disabled={mint.isPending} className="min-w-0 space-y-5 border-t pt-6">
          <legend className="float-left mb-2 w-full text-lg font-semibold tracking-tight">
            {kind === "cask" ? "Cask details" : "Bottle details"}
          </legend>
          <p className="clear-both text-sm leading-relaxed text-muted-foreground">
            Sample values are filled in for quick testing. Edit any field before minting.
          </p>
          <DataEditor kind={kind} granularity={granularity} draft={draft} onChange={setDraft} />

          <p className="text-xs text-muted-foreground">Fields marked * are required.</p>
        </fieldset>
      </div>

      <aside
        aria-label="Review and mint"
        className="min-w-0 rounded-xl border bg-card p-5 lg:sticky lg:top-48 xl:top-40"
      >
        <h2 className="text-lg font-semibold tracking-tight">Review and mint</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Check the details, then sign the one-time challenge in your wallet.
        </p>
        <dl className="my-5 space-y-3 border-y py-4 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Passport</dt>
            <dd className="text-right font-medium">
              {kind === "cask" ? "Cask" : "Bottle"} · {granularity === "item" ? "Item" : "Batch"}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Network</dt>
            <dd className="text-right font-medium">{chainName(chainId)}</dd>
          </div>
          <div className="space-y-1">
            <dt className="text-muted-foreground">Recipient</dt>
            <dd
              className={
                to ? "break-all font-mono text-xs leading-relaxed" : "text-sm text-muted-foreground"
              }
            >
              {to || "Connect your wallet to fill this in."}
            </dd>
          </div>
        </dl>
        {problem ? (
          <p role="status" className="mb-4 text-sm leading-relaxed">
            {problem}
          </p>
        ) : null}

        <div>
          <ConnectGate>
            <button
              type="submit"
              className={`${buttonClass} min-h-11 w-full whitespace-normal`}
              disabled={Boolean(problem) || mint.isPending}
            >
              {mint.isPending ? "Waiting for signature, pinning and minting…" : "Sign and mint"}
            </button>
          </ConnectGate>
        </div>

        <div className="mt-4 space-y-4" aria-live="polite">
          {error ? (
            <Notice tone="error">
              {error instanceof ApiClientError ? (
                <>
                  <strong>{error.code}</strong>: {error.message}
                  {error.code === "not_allowlisted" ? (
                    <> This wallet is not in the issuer allowlist, so no challenge was issued.</>
                  ) : null}
                </>
              ) : (
                error.message
              )}
            </Notice>
          ) : null}

          {mint.data ? (
            <Notice tone="ok">
              <dl className="grid gap-1">
                <div>
                  Token id: <span className="font-mono">{mint.data.tokenId}</span>
                </div>
                <div>
                  CID: <span className="break-all font-mono">{mint.data.cid}</span>
                </div>
                <div>
                  Transaction: <TxLink chainId={chainId} hash={mint.data.txHash} />
                </div>
                <div>
                  <Link className="underline" href={`/passport/${mint.data.tokenId}`}>
                    Open /passport/{mint.data.tokenId}
                  </Link>
                </div>
              </dl>
            </Notice>
          ) : null}
        </div>
      </aside>
    </form>
  );
}
