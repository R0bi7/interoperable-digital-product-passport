import { z } from "zod";

/**
 * Indexer summary API types. `PassportSummary` is the copy of the type in
 * docs/TECHNICAL-REFERENCE.md ("Indexer summary API"); the zod schema below validates responses
 * against it, because the indexer is not trusted to be well-formed.
 */
export type TimelineEntry = {
  kind: "issued" | "revised" | "transferred" | "sent" | "received";
  chainId: number;
  txHash: string;
  blockNumber: string;
  timestamp: string;
  /** LayerZero message guid; present on `sent` and `received`. */
  guid?: string;
};

export type PassportSummary = {
  deploymentId: string;
  tokenId: string;
  originChainId: number;
  currentChainId: number | null;
  status: "held" | "in_flight" | "incomplete";
  owner: string | null;
  revision: string | null;
  cid: string | null;
  progress: { chainId: number; indexedBlock: string; latestBlock: string }[];
  revisions: {
    revision: string;
    cid: string;
    chainId: number;
    author: string;
    txHash: string;
    timestamp: string;
    conflict: boolean;
  }[];
  timeline: TimelineEntry[];
};

export type PassportStatus = PassportSummary["status"];
export const PASSPORT_STATUSES: readonly PassportStatus[] = ["held", "in_flight", "incomplete"];

export type PassportPage = { items: PassportSummary[]; nextCursor: string | null };

export type PassportQuery = {
  chainId?: number;
  status?: PassportStatus;
  limit?: number;
  cursor?: string;
};

/** Decimal string without leading zeros: ids and revisions stay strings, never `Number`. */
const uintString = z.string().regex(/^(0|[1-9][0-9]*)$/, "expected a decimal integer string");
const chainId = z.number().int().positive();

const timelineEntrySchema = z.object({
  kind: z.enum(["issued", "revised", "transferred", "sent", "received"]),
  chainId,
  txHash: z.string(),
  blockNumber: uintString,
  timestamp: uintString,
  guid: z.string().optional(),
});

export const passportSummarySchema = z.object({
  deploymentId: z.string(),
  tokenId: uintString,
  originChainId: chainId,
  currentChainId: chainId.nullable(),
  status: z.enum(["held", "in_flight", "incomplete"]),
  owner: z.string().nullable(),
  revision: uintString.nullable(),
  cid: z.string().nullable(),
  progress: z.array(z.object({ chainId, indexedBlock: uintString, latestBlock: uintString })),
  revisions: z.array(
    z.object({
      revision: uintString,
      cid: z.string(),
      chainId,
      author: z.string(),
      txHash: z.string(),
      timestamp: uintString,
      conflict: z.boolean(),
    }),
  ),
  timeline: z.array(timelineEntrySchema),
}) satisfies z.ZodType<PassportSummary, unknown>;

export const passportPageSchema = z.object({
  items: z.array(passportSummarySchema),
  nextCursor: z.string().nullable(),
}) satisfies z.ZodType<PassportPage, unknown>;
