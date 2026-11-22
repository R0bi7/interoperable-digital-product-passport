import { expect, it, vi } from "vitest";

vi.mock("@/lib/env.server", () => ({ getServerEnv: vi.fn() }));

import { getServerEnv } from "@/lib/env.server";
import { GET } from "./route";

it("reports setup without exposing credentials or the allowlist", async () => {
  vi.mocked(getServerEnv).mockReturnValue({
    OPERATOR_PRIVATE_KEY: "secret",
    PINATA_JWT: "secret",
    ISSUER_ALLOWLIST: ["0x0000000000000000000000000000000000000001"],
  } as never);
  const response = await GET(
    new Request(
      "http://localhost/api/readiness?address=0x0000000000000000000000000000000000000001",
    ),
  );
  expect(await response.json()).toEqual({ publicationConfigured: true, allowlisted: true });
  expect(response.headers.get("Cache-Control")).toBe("no-store");
});
it("redacts configuration errors", async () => {
  vi.mocked(getServerEnv).mockImplementation(() => {
    throw new Error("secret value");
  });
  expect(await (await GET(new Request("http://localhost/api/readiness"))).json()).toEqual({
    publicationConfigured: false,
    allowlisted: null,
  });
});
