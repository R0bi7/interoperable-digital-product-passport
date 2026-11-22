const UINT256_MAX = 2n ** 256n - 1n;
const DECIMAL = /^(0|[1-9][0-9]*)$/;
const PASSPORT_PATH = /(?:^|\/)passport\/(0|[1-9][0-9]*)\/?$/;

/** Strict decimal token id (no sign, no leading zeros, at most uint256) as `bigint`; else `null`. */
export function parseTokenId(text: string): bigint | null {
  if (!DECIMAL.test(text)) return null;
  const value = BigInt(text);
  return value <= UINT256_MAX ? value : null;
}

/**
 * Token id from what a QR code or a user typed: a plain decimal id, a `/passport/<id>` path, or a
 * URL ending in that path. Ids exceed 2^53, so this never goes through `Number`.
 */
export type PassportRef = { tokenId: bigint; deploymentId?: string };

export function extractPassportRef(input: string): PassportRef | null {
  const text = input.trim();
  const plain = parseTokenId(text);
  if (plain !== null) return { tokenId: plain };
  let url: URL;
  try {
    url = new URL(text, "http://passport.invalid");
  } catch {
    return null;
  }
  const match = PASSPORT_PATH.exec(url.pathname);
  const tokenId = match?.[1] ? parseTokenId(match[1]) : null;
  if (tokenId === null) return null;
  const deploymentId = url.searchParams.get("deployment") ?? undefined;
  return { tokenId, ...(deploymentId !== undefined ? { deploymentId } : {}) };
}

export function extractTokenId(input: string): bigint | null {
  return extractPassportRef(input)?.tokenId ?? null;
}

export function passportPath(tokenId: bigint | string, deploymentId?: string): string {
  return `/passport/${tokenId.toString()}${deploymentId !== undefined ? `?deployment=${encodeURIComponent(deploymentId)}` : ""}`;
}

/** Absolute URL of a passport page, the text a passport QR code carries. */
export function passportUrl(
  origin: string,
  tokenId: bigint | string,
  deploymentId?: string,
): string {
  return new URL(passportPath(tokenId, deploymentId), origin).toString();
}
