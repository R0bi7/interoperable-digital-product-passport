/** Request parsing for the summary API. Pure, so it is unit-tested without Ponder. */

export const STATUSES = ["held", "in_flight", "incomplete"] as const;
export type Status = (typeof STATUSES)[number];

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

export type ListQuery = {
  chainId: number | undefined;
  status: Status | undefined;
  limit: number;
  /** Exclusive lower bound on the token id (the last id of the previous page). */
  cursor: bigint | undefined;
};

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const DECIMAL = /^(0|[1-9][0-9]*)$/;

/** Token ids are decimal strings in URLs; they exceed 2^53, so never `Number`. */
export function parseTokenId(raw: string): Parsed<bigint> {
  if (!DECIMAL.test(raw)) return { ok: false, error: "tokenId must be a decimal integer" };
  return { ok: true, value: BigInt(raw) };
}

export function parseListQuery(query: {
  chainId?: string | undefined;
  status?: string | undefined;
  limit?: string | undefined;
  cursor?: string | undefined;
}): Parsed<ListQuery> {
  let chainId: number | undefined;
  if (query.chainId !== undefined && query.chainId !== "") {
    if (!DECIMAL.test(query.chainId) || !Number.isSafeInteger(Number(query.chainId))) {
      return { ok: false, error: "chainId must be a positive integer" };
    }
    chainId = Number(query.chainId);
  }

  let status: Status | undefined;
  if (query.status !== undefined && query.status !== "") {
    if (!(STATUSES as readonly string[]).includes(query.status)) {
      return { ok: false, error: `status must be one of ${STATUSES.join(", ")}` };
    }
    status = query.status as Status;
  }

  let limit = DEFAULT_LIMIT;
  if (query.limit !== undefined && query.limit !== "") {
    if (!DECIMAL.test(query.limit) || Number(query.limit) < 1) {
      return { ok: false, error: "limit must be a positive integer" };
    }
    limit = Math.min(Number(query.limit), MAX_LIMIT);
  }

  let cursor: bigint | undefined;
  if (query.cursor !== undefined && query.cursor !== "") {
    const parsed = parseTokenId(query.cursor);
    if (!parsed.ok) return { ok: false, error: "cursor must be a decimal token id" };
    cursor = parsed.value;
  }

  return { ok: true, value: { chainId, status, limit, cursor } };
}
