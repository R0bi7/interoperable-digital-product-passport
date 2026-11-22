import { describe, expect, it } from "vitest";
import { canonicalize, passportEnvelopeSchema } from "../src/index";
import { fetchVerified, pinAndAssert, type UploadPath } from "./pinata";
import { VECTOR_CID, VECTOR_ENVELOPE } from "./vector";

const bytes = canonicalize(passportEnvelopeSchema.parse(VECTOR_ENVELOPE));
const jwt = process.env.PINATA_JWT;
const gateway = process.env.PINATA_GATEWAY || "gateway.pinata.cloud";
/** `sdk` (default), `legacy`, or `both`. See README.md "Pinata upload path". */
const PATHS: Record<string, UploadPath[]> = {
  sdk: ["sdk"],
  legacy: ["legacy"],
  both: ["sdk", "legacy"],
};
const pathSetting = process.env.PINATA_UPLOAD_PATH || "sdk";
const paths = PATHS[pathSetting];
if (!paths) {
  throw new Error(
    `PINATA_UPLOAD_PATH must be sdk, legacy or both, got ${JSON.stringify(pathSetting)}`,
  );
}

describe.skipIf(!jwt).each(paths)("Pinata round trip via %s (needs PINATA_JWT)", (path) => {
  it("pins the test vector under the predicted CID and reads back identical bytes", async () => {
    const cid = await pinAndAssert(path, jwt as string, bytes, "idpp-test-vector.json");
    expect(cid).toBe(VECTOR_CID);

    // Fresh pins can take a moment to appear on the gateway.
    let result = await fetchVerified(gateway, cid);
    for (let attempt = 0; !result.ok && attempt < 5; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      result = await fetchVerified(gateway, cid);
    }
    expect(result).toMatchObject({ ok: true });
    expect(result.ok && Buffer.from(result.bytes).equals(Buffer.from(bytes))).toBe(true);
  });
});
