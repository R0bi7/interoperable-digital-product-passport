import "server-only";
import { PinataSDK } from "pinata";

/**
 * The two Pinata upload paths documented in the passport-config README. Both yield the IDPP CID
 * (CIDv1, raw, sha2-256) against live Pinata (verified 2026-10-12, README "Pinata upload path"). The
 * upload stays isolated behind `PinUploader` and `pinEnvelope` never trusts the CID an uploader
 * reports, so a future SDK or service change fails loudly instead of changing a CID.
 */
export type UploadPath = "sdk" | "legacy";

export const DEFAULT_UPLOAD_PATH: UploadPath = "sdk";

/** Uploads exactly `bytes` and returns the CID the service reports. */
export interface PinUploader {
  readonly path: UploadPath;
  upload(bytes: Uint8Array, name: string): Promise<string>;
}

const LEGACY_ENDPOINT = "https://api.pinata.cloud/pinning/pinFileToIPFS";

function toFile(bytes: Uint8Array, name: string): File {
  return new File([bytes as Uint8Array<ArrayBuffer>], name, { type: "application/json" });
}

/** Pinata SDK 2.5.6: `pinata.upload.public.file(file).cidVersion("v1")`. */
export function createSdkUploader(jwt: string): PinUploader {
  return {
    path: "sdk",
    async upload(bytes, name) {
      const pinata = new PinataSDK({ pinataJwt: jwt });
      const result = await pinata.upload.public.file(toFile(bytes, name)).cidVersion("v1");
      return result.cid;
    },
  };
}

/** `POST /pinning/pinFileToIPFS` with `pinataOptions: { cidVersion: 1 }`. */
export function createLegacyUploader(jwt: string, fetchImpl: typeof fetch = fetch): PinUploader {
  return {
    path: "legacy",
    async upload(bytes, name) {
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
    },
  };
}

/** `PINATA_UPLOAD_PATH`: `sdk` (default) or `legacy`. Anything else is a configuration error. */
export function resolveUploadPath(value: string | undefined): UploadPath {
  if (value === undefined || value === "") return DEFAULT_UPLOAD_PATH;
  if (value === "sdk" || value === "legacy") return value;
  throw new Error(`PINATA_UPLOAD_PATH must be "sdk" or "legacy", got ${JSON.stringify(value)}`);
}

export function createUploader(path: UploadPath, jwt: string): PinUploader {
  return path === "legacy" ? createLegacyUploader(jwt) : createSdkUploader(jwt);
}
