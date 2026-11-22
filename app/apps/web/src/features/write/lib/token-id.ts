/** Token ids are decimal strings in URLs and exceed 2^53, so they are parsed straight to bigint. */
export function parseTokenId(value: string): bigint | undefined {
  return /^(0|[1-9][0-9]{0,77})$/.test(value) ? BigInt(value) : undefined;
}
