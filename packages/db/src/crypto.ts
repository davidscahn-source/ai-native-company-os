import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { assertCredentialAllowed } from "./data-policy.js";

/**
 * Credential encryption (M1: envelope-lite).
 * AES-256-GCM with a root key supplied via environment/KMS — never stored in the DB.
 * Format: base64(iv).base64(tag).base64(ciphertext)
 * ADR-010: per-tenant DEKs wrap this in Phase 2; the storage format already allows it.
 *
 * This is also the data-readiness chokepoint: a credential that cannot be
 * encrypted cannot be stored, so the phase gate is enforced here rather than
 * in a document nobody executes (docs/DATA-READINESS.md, D-012).
 */
export function encryptCredential(
  plaintext: string,
  rootKeyHex: string,
  opts: { provider?: string } = {}
): string {
  assertCredentialAllowed(opts.provider ?? "unknown", plaintext);
  const key = keyFromHex(rootKeyHex);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${data.toString("base64")}`;
}

export function decryptCredential(stored: string, rootKeyHex: string): string {
  const key = keyFromHex(rootKeyHex);
  const [ivB64, tagB64, dataB64] = stored.split(".");
  if (!ivB64 || !tagB64 || !dataB64) throw new Error("malformed encrypted credential");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

function keyFromHex(hex: string): Buffer {
  const key = Buffer.from(hex, "hex");
  if (key.length !== 32) throw new Error("root key must be 32 bytes (64 hex chars)");
  return key;
}
