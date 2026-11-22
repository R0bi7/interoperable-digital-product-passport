/** Client for the write-path API routes. Errors carry the server's structured code. */
export class ApiClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

async function parse<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => undefined)) as
    | { error?: { code?: string; message?: string } }
    | undefined;
  if (!response.ok) {
    throw new ApiClientError(
      body?.error?.code ?? "http_error",
      body?.error?.message ?? `request failed with HTTP ${response.status}`,
      response.status,
    );
  }
  return body as T;
}

export async function getJson<T>(url: string): Promise<T> {
  return parse<T>(await fetch(url, { cache: "no-store" }));
}

export async function postJson<T>(url: string, body: unknown): Promise<T> {
  return parse<T>(
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

export type MintChallenge = { nonce: string; message: string };
export type MintResponse = { tokenId: string; cid: string; txHash: `0x${string}` };
