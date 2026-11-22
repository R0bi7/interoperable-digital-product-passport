import { describe, expect, it } from "vitest";
import { describeCameraError } from "./camera-error";

describe("describeCameraError", () => {
  it("explains a denied permission", () => {
    const text = describeCameraError(
      new Error("Error getting userMedia, error = NotAllowedError: Permission denied"),
      true,
    );
    expect(text).toMatch(/denied/i);
    expect(text).toMatch(/browser settings/i);
  });

  it("recognises a string rejection, a missing camera and a busy camera", () => {
    expect(describeCameraError("NotAllowedError: Permission denied", true)).toMatch(/denied/i);
    expect(describeCameraError("NotFoundError: Requested device not found", true)).toMatch(
      /no camera/i,
    );
    expect(describeCameraError(new Error("NotReadableError: Could not start video"), true)).toMatch(
      /in use/i,
    );
  });

  it("names a page without camera API before anything else", () => {
    expect(describeCameraError(new Error("NotAllowedError"), false)).toMatch(/https or localhost/);
  });

  it("falls back to a bounded raw message", () => {
    const text = describeCameraError(new Error("x".repeat(500)), true);
    expect(text.startsWith("The camera could not be started")).toBe(true);
    expect(text.length).toBeLessThan(200);
  });
});
