import { describe, it, expect, beforeAll } from "vitest";

beforeAll(() => {
  process.env.ENCRYPTION_KEY = "a".repeat(64);
});

describe("crypto (AES-256-GCM)", () => {
  it("round-trips plaintext", async () => {
    const { encrypt, decrypt } = await import("@/lib/crypto");
    const secret = "ya29.a0AfB_byD-example-oauth-token-🎉";
    const encrypted = encrypt(secret);
    expect(encrypted).not.toContain(secret);
    expect(decrypt(encrypted)).toBe(secret);
  });

  it("produces a different ciphertext per call (random IV)", async () => {
    const { encrypt } = await import("@/lib/crypto");
    expect(encrypt("same input")).not.toBe(encrypt("same input"));
  });

  it("rejects tampered ciphertext (auth tag)", async () => {
    const { encrypt, decrypt } = await import("@/lib/crypto");
    const encrypted = encrypt("secret");
    const raw = Buffer.from(encrypted, "base64");
    raw[raw.length - 1] ^= 0xff;
    expect(() => decrypt(raw.toString("base64"))).toThrow();
  });

  it("masks secrets for display", async () => {
    const { maskSecret } = await import("@/lib/crypto");
    expect(maskSecret("AIzaSyExample1234567890")).toBe("AIza…7890");
    expect(maskSecret("short")).toBe("••••");
  });
});
