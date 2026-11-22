import { MANIFEST, whiskyDistilleryAbi } from "@idpp/passport-config";
import { z } from "zod";
import { publicClientFor } from "@/features/read/live";
import { indexerBaseUrl } from "@/lib/indexer/client";

const decimal = z.string().regex(/^\d+$/);
export const statusSchema = z.object({
  deploymentId: z.string(),
  chains: z.array(
    z.object({
      chainId: z.number().int(),
      indexedBlock: decimal.nullable(),
      latestBlock: decimal.nullable(),
      toleranceBlocks: decimal,
      caughtUp: z.boolean(),
    }),
  ),
});
const publicationSchema = z.object({
  publicationConfigured: z.boolean(),
  allowlisted: z.boolean().nullable(),
});

export type ReadinessItem = { label: string; ok: boolean; detail: string };

export function indexerItems(status: z.infer<typeof statusSchema>): ReadinessItem[] {
  if (status.deploymentId !== MANIFEST.deploymentId) {
    return [
      {
        label: "Indexer",
        ok: false,
        detail: "Different deployment. Use the indexer for this app's deployment.",
      },
    ];
  }
  return MANIFEST.chains.map(({ chainId, network }) => {
    const rows = status.chains.filter((c) => c.chainId === chainId);
    const row = rows.length === 1 ? rows[0] : undefined;
    const present = row?.indexedBlock != null && row.latestBlock != null;
    return {
      label: network,
      ok: !!row?.caughtUp && present,
      detail: !present
        ? "Progress unavailable. Check the indexer and its chain providers."
        : `Indexed ${row.indexedBlock} of ${row.latestBlock}; ${row.caughtUp ? "within" : "outside"} the indexer's catch-up allowance (${row.toleranceBlocks} blocks).`,
    };
  });
}

async function bounded<T>(task: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("check timed out")), 12_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function json(url: string) {
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error("check unavailable");
  return response.json();
}

export async function checkReadiness(address?: string) {
  const base = indexerBaseUrl();
  const [indexer, publication, chains] = await Promise.all([
    base
      ? json(`${base}/api/status`)
          .then((body) => indexerItems(statusSchema.parse(body)))
          .catch(() => [
            {
              label: "Indexer",
              ok: false,
              detail: "Status unavailable. Start the matching indexer and check its URL.",
            },
          ])
      : Promise.resolve([
          {
            label: "Indexer",
            ok: false,
            detail: "Fixture mode: live discovery and catch-up are not checked.",
          },
        ]),
    json(`/api/readiness${address ? `?address=${encodeURIComponent(address)}` : ""}`)
      .then((body) => publicationSchema.parse(body))
      .catch(() => null),
    base
      ? Promise.all(
          MANIFEST.chains.map(async (chain): Promise<ReadinessItem> => {
            try {
              await bounded(
                publicClientFor(chain.chainId).readContract({
                  address: chain.address,
                  abi: whiskyDistilleryAbi,
                  functionName: "nextTokenId",
                }),
              );
              return {
                label: chain.network,
                ok: true,
                detail: "Passport contract read succeeded from this browser.",
              };
            } catch {
              return {
                label: chain.network,
                ok: false,
                detail: "Contract read failed. Retry or check the chain provider.",
              };
            }
          }),
        )
      : Promise.resolve([
          {
            label: "Chains",
            ok: false,
            detail: "Fixture mode: live contract access is not checked.",
          },
        ]),
  ]);
  return { indexer, chains, publication };
}
