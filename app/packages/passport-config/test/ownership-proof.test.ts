import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import {
  type ChallengeRecord,
  decodeOwnershipChallenge,
  decodeOwnershipProof,
  encodeOwnershipChallenge,
  type OwnershipProof,
  ownershipTypedData,
  verifyOwnershipProof,
} from "../src/ownership-proof";

const owner = privateKeyToAccount(`0x${"11".repeat(32)}`);
const stranger = privateKeyToAccount(`0x${"22".repeat(32)}`);
const record: ChallengeRecord = {
  tokenId: "421614000000000006",
  chainId: 84532,
  contract: "0x1234567890123456789012345678901234567890",
  nonce: `0x${"ab".repeat(32)}`,
  expiresAt: "10120",
};
async function sign(
  overrides: Partial<OwnershipProof> = {},
  signer = owner,
): Promise<OwnershipProof> {
  const proof = {
    kind: "idpp-ownership-proof" as const,
    v: 1 as const,
    ...record,
    holder: owner.address,
    ...overrides,
  };
  return {
    ...proof,
    signature: await signer.signTypedData(ownershipTypedData(proof, proof.holder)),
  };
}

describe("ownership proof EIP-712 interface", () => {
  it("round trips strict JSON challenges and proofs with decimal-string ids", async () => {
    expect(decodeOwnershipChallenge(encodeOwnershipChallenge(record))).toEqual(record);
    const proof = await sign();
    expect(decodeOwnershipProof(JSON.stringify(proof))).toEqual(proof);
    expect(ownershipTypedData(record, owner.address)).toMatchObject({
      domain: {
        name: "IDPP ownership",
        version: "1",
        chainId: 84532,
        verifyingContract: record.contract,
      },
      primaryType: "Ownership",
      message: {
        tokenId: BigInt(record.tokenId),
        holder: owner.address,
        challenge: record.nonce,
        expiresAt: 10120n,
      },
    });
  });

  it("rejects malformed, foreign-version, numeric-id and extra-field QR payloads", async () => {
    const challenge = JSON.parse(encodeOwnershipChallenge(record));
    for (const bad of [
      null,
      {},
      { ...challenge, v: 2 },
      { ...challenge, tokenId: 12 },
      { ...challenge, extra: "untrusted" },
      { ...challenge, expiresAt: String(2n ** 64n) },
      { ...challenge, nonce: "0x1234" },
      { ...challenge, tokenId: String(2n ** 256n) },
    ]) {
      expect(decodeOwnershipChallenge(JSON.stringify(bad))).toBeNull();
    }
    const proof = await sign();
    expect(decodeOwnershipProof(JSON.stringify({ ...proof, extra: true }))).toBeNull();
    expect(decodeOwnershipProof(JSON.stringify({ ...proof, signature: "0x" }))).toBeNull();
    expect(decodeOwnershipChallenge("not JSON")).toBeNull();
  });

  it("accepts a valid owner signature", async () => {
    expect(await verifyOwnershipProof(await sign(), record, owner.address, 10000)).toEqual({
      ok: true,
      signer: owner.address,
    });
  });

  it("rejects a wrong signer", async () => {
    const proof = await sign({}, stranger);
    expect(await verifyOwnershipProof(proof, record, owner.address, 10000)).toMatchObject({
      ok: false,
      code: "holder_not_signer",
    });
  });

  it("rejects a holder field that is not the signer", async () => {
    expect(
      await verifyOwnershipProof(
        await sign({ holder: stranger.address }),
        record,
        owner.address,
        10000,
      ),
    ).toEqual({ ok: false, code: "holder_not_signer" });
  });

  it("reports an unrecoverable signature", async () => {
    const proof = await sign();
    expect(
      await verifyOwnershipProof(
        { ...proof, signature: `0x${"00".repeat(65)}` },
        record,
        owner.address,
        10000,
      ),
    ).toEqual({ ok: false, code: "wrong_signer" });
  });

  it("rejects a transfer after signing, even though the signature remains valid", async () => {
    expect(await verifyOwnershipProof(await sign(), record, stranger.address, 10000)).toEqual({
      ok: false,
      code: "owner_mismatch",
    });
  });

  it.each([10120, 10121])("rejects at or after expiry (%s)", async (now) => {
    expect(await verifyOwnershipProof(await sign(), record, owner.address, now)).toEqual({
      ok: false,
      code: "expired",
    });
  });

  it.each([
    ["tokenId", "421614000000000007", "wrong_token"],
    ["chainId", 421614, "wrong_chain"],
    ["contract", "0x9876543210987654321098765432109876543210", "wrong_contract"],
    ["nonce", `0x${"cd".repeat(32)}`, "foreign_nonce"],
    ["expiresAt", "10119", "wrong_expiry"],
  ] as const)(
    "rejects a foreign %s even with a valid signature for it",
    async (field, value, code) => {
      expect(
        await verifyOwnershipProof(await sign({ [field]: value }), record, owner.address, 10000),
      ).toEqual({ ok: false, code });
    },
  );

  it("accepts a relayed proof: a remote owner can sign exactly the same challenge", async () => {
    // The protocol cannot distinguish this remote signature from an owner physically present.
    const relayedToRemoteOwner = JSON.parse(encodeOwnershipChallenge(record));
    const signature = await owner.signTypedData(
      ownershipTypedData(relayedToRemoteOwner, owner.address),
    );
    const relayedBack: OwnershipProof = {
      kind: "idpp-ownership-proof",
      v: 1,
      ...record,
      holder: owner.address,
      signature,
    };
    expect((await verifyOwnershipProof(relayedBack, record, owner.address, 10000)).ok).toBe(true);
  });
});
