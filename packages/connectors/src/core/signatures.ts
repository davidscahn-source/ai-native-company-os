import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Webhook signature verification — part of the shared Sync Harness.
 * Every connector's inbound payload passes one of these before anything is stored.
 */

const STRIPE_TOLERANCE_SECONDS = 300;

/** Stripe-Signature: t=<unix>,v1=<hmac>[,v1=...] over `${t}.${rawBody}` */
export function verifyStripeSignature(
  rawBody: string,
  header: string,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): boolean {
  const parts = header.split(",").map((p) => p.trim());
  const t = parts.find((p) => p.startsWith("t="))?.slice(2);
  const v1s = parts.filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  if (!t || v1s.length === 0) return false;
  const timestamp = Number(t);
  if (!Number.isFinite(timestamp)) return false;
  if (Math.abs(nowSeconds - timestamp) > STRIPE_TOLERANCE_SECONDS) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  return v1s.some((v1) => safeHexEqual(v1, expected));
}

/** X-Hub-Signature-256: sha256=<hmac> over the raw body */
export function verifyGithubSignature(rawBody: string, header: string, secret: string): boolean {
  if (!header.startsWith("sha256=")) return false;
  const provided = header.slice("sha256=".length);
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  return safeHexEqual(provided, expected);
}

function safeHexEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ba.length !== bb.length || ba.length === 0) return false;
  return timingSafeEqual(ba, bb);
}
