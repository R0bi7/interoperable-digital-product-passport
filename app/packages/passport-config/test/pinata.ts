/**
 * Pinata upload paths used by the integration test. The app's own pinning code lives in
 * `apps/web/src/lib/pinata`; this file only proves which upload path yields the IDPP CID.
 */
import { PinataSDK } from "pinata";
import { computeCidV1, verifyContent } from "../src/index";

export type UploadPath = "sdk" | "legacy";

const LEGACY_ENDPOINT = "https://api.pinata.cloud/pinning/pinFileToIPFS";

function toFile(bytes: Uint8Array, name: string): File {
  return new File([bytes as Uint8Array<ArrayBuffer>], name, { type: "application/json" });
}

/** Current SDK, public network, CID version 1. Returns the CID Pinata reports. */
export async function uploadViaSdk(jwt: string, bytes: Uint8Array, name: string): Promise<string> {
  const pinata = new PinataSDK({ pinataJwt: jwt });
  const result = await pinata.upload.public.file(toFile(bytes, name)).cidVersion("v1");
  return result.cid;
}

/** Legacy pinning endpoint with `pinataOptions: { cidVersion: 1 }`. */
export async function uploadViaLegacy(
  jwt: string,
  bytes: Uint8Array,
  name: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const form = new FormData();
  form.append("file", toFile(bytes, name));
  form.append("pinataOptions", JSON.stringify({ cidVersion: 1 }));
  form.append("pinataMetadata", JSON.stringify({ name }));
  const response = await fetchImpl(LEGACY_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}` },
    body: form,
  });
  if (!response.ok) {
    throw new Error(`pinFileToIPFS ${response.status}: ${await response.text()}`);
  }
  const body = (await response.json()) as { IpfsHash?: string };
  if (!body.IpfsHash) throw new Error("pinFileToIPFS returned no IpfsHash");
  return body.IpfsHash;
}

/**
 * Uploads `bytes` and asserts the returned CID equals the locally predicted one.
 * A different CID is a hard failure; it is never adopted.
 */
export async function pinAndAssert(
  path: UploadPath,
  jwt: string,
  bytes: Uint8Array,
  name: string,
): Promise<string> {
  const predicted = computeCidV1(bytes);
  const returned =
    path === "sdk" ? await uploadViaSdk(jwt, bytes, name) : await uploadViaLegacy(jwt, bytes, name);
  if (returned !== predicted) {
    throw new Error(`Pinata (${path}) returned ${returned}, predicted ${predicted}`);
  }
  return returned;
}

export type FetchResult =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; reason: string; status?: number };

/** Fetches raw bytes for `cid` from a gateway host and checks them against the CID. */
export async function fetchVerified(
  gatewayHost: string,
  cid: string,
  fetchImpl: typeof fetch = fetch,
): Promise<FetchResult> {
  let response: Response;
  try {
    response = await fetchImpl(`https://${gatewayHost}/ipfs/${cid}`);
  } catch (error) {
    return { ok: false, reason: `gateway request failed: ${(error as Error).message}` };
  }
  if (!response.ok) {
    return { ok: false, status: response.status, reason: `gateway returned ${response.status}` };
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const content = verifyContent(bytes, cid);
  return content.ok ? { ok: true, bytes } : { ok: false, reason: content.reason };
}
