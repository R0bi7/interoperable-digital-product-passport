import {
  type PassportPage,
  type PassportQuery,
  type PassportSummary,
  passportPageSchema,
  passportSummarySchema,
} from "./types";

export * from "./types";

/**
 * Base URL of the indexer's summary API. Read as a literal `process.env.NEXT_PUBLIC_…` expression so
 * Next inlines it. Unset or empty means "use the mock fixtures" (`./mock`), not a default URL, so
 * the read path works without the indexer.
 */
export function indexerBaseUrl(): string | undefined {
  const value = process.env.NEXT_PUBLIC_INDEXER_URL;
  return value ? value.replace(/\/+$/, "") : undefined;
}

export class IndexerError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "IndexerError";
  }
}

type FetchLike = typeof fetch;

async function getJson(
  url: string,
  fetchImpl: FetchLike,
): Promise<{ status: number; body: unknown }> {
  let response: Response;
  try {
    response = await fetchImpl(url, { headers: { accept: "application/json" } });
  } catch (error) {
    throw new IndexerError(`indexer unreachable: ${(error as Error).message}`);
  }
  if (response.status === 404) return { status: 404, body: null };
  if (!response.ok)
    throw new IndexerError(`indexer answered HTTP ${response.status}`, response.status);
  try {
    return { status: response.status, body: await response.json() };
  } catch {
    throw new IndexerError("indexer answered with invalid JSON", response.status);
  }
}

/** `GET /api/passports?chainId=&status=&limit=&cursor=` */
export async function fetchPassports(
  baseUrl: string,
  query: PassportQuery = {},
  fetchImpl: FetchLike = fetch,
): Promise<PassportPage> {
  const params = new URLSearchParams();
  if (query.chainId !== undefined) params.set("chainId", String(query.chainId));
  if (query.status !== undefined) params.set("status", query.status);
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  if (query.cursor !== undefined) params.set("cursor", query.cursor);
  const search = params.size > 0 ? `?${params}` : "";
  const { body } = await getJson(`${baseUrl}/api/passports${search}`, fetchImpl);
  const parsed = passportPageSchema.safeParse(body);
  if (!parsed.success) {
    throw new IndexerError(
      `unexpected /api/passports response: ${parsed.error.issues[0]?.message}`,
    );
  }
  return parsed.data;
}

/** `GET /api/passports/:tokenId`; `null` when the indexer does not know the token. */
export async function fetchPassport(
  baseUrl: string,
  tokenId: bigint,
  fetchImpl: FetchLike = fetch,
): Promise<PassportSummary | null> {
  const { status, body } = await getJson(
    `${baseUrl}/api/passports/${tokenId.toString()}`,
    fetchImpl,
  );
  if (status === 404) return null;
  const parsed = passportSummarySchema.safeParse(body);
  if (!parsed.success) {
    throw new IndexerError(
      `unexpected /api/passports/:tokenId response: ${parsed.error.issues[0]?.message}`,
    );
  }
  if (parsed.data.tokenId !== tokenId.toString()) {
    throw new IndexerError(`indexer answered for token ${parsed.data.tokenId}, not ${tokenId}`);
  }
  return parsed.data;
}
