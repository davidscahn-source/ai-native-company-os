import { describe, expect, it } from "vitest";
import { decryptCredential, encryptCredential } from "../src/crypto.js";

const KEY = "a".repeat(64);
const OTHER_KEY = "b".repeat(64);

describe("credential encryption", () => {
  it("round-trips", () => {
    const stored = encryptCredential("sk_test_secret", KEY);
    expect(stored).not.toContain("sk_test_secret");
    expect(decryptCredential(stored, KEY)).toBe("sk_test_secret");
  });

  it("produces distinct ciphertexts per call (fresh IV)", () => {
    expect(encryptCredential("x", KEY)).not.toBe(encryptCredential("x", KEY));
  });

  it("rejects a wrong key", () => {
    const stored = encryptCredential("x", KEY);
    expect(() => decryptCredential(stored, OTHER_KEY)).toThrow();
  });

  it("rejects tampered ciphertext (GCM auth)", () => {
    const stored = encryptCredential("x", KEY);
    const parts = stored.split(".");
    const data = Buffer.from(parts[2]!, "base64");
    data[0] = data[0]! ^ 0xff;
    const tampered = `${parts[0]}.${parts[1]}.${data.toString("base64")}`;
    expect(() => decryptCredential(tampered, KEY)).toThrow();
  });

  it("rejects short keys", () => {
    expect(() => encryptCredential("x", "deadbeef")).toThrow(/32 bytes/);
  });
});
