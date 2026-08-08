import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyGithubSignature, verifyStripeSignature } from "../src/core/signatures.js";

const SECRET = "whsec_test";
const BODY = JSON.stringify({ hello: "world" });

function stripeHeader(body: string, secret: string, t: number): string {
  const sig = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  return `t=${t},v1=${sig}`;
}

describe("verifyStripeSignature", () => {
  const now = 1754600000;

  it("accepts a valid signature within tolerance", () => {
    expect(verifyStripeSignature(BODY, stripeHeader(BODY, SECRET, now - 10), SECRET, now)).toBe(
      true
    );
  });

  it("rejects a wrong secret", () => {
    expect(verifyStripeSignature(BODY, stripeHeader(BODY, "other", now), SECRET, now)).toBe(false);
  });

  it("rejects a tampered body", () => {
    expect(verifyStripeSignature(BODY + "x", stripeHeader(BODY, SECRET, now), SECRET, now)).toBe(
      false
    );
  });

  it("rejects an expired timestamp (replay defense)", () => {
    expect(verifyStripeSignature(BODY, stripeHeader(BODY, SECRET, now - 3600), SECRET, now)).toBe(
      false
    );
  });

  it("rejects malformed headers", () => {
    expect(verifyStripeSignature(BODY, "garbage", SECRET, now)).toBe(false);
    expect(verifyStripeSignature(BODY, "t=abc,v1=zz", SECRET, now)).toBe(false);
  });
});

describe("verifyGithubSignature", () => {
  const header = "sha256=" + createHmac("sha256", SECRET).update(BODY).digest("hex");

  it("accepts a valid signature", () => {
    expect(verifyGithubSignature(BODY, header, SECRET)).toBe(true);
  });

  it("rejects wrong secret / tampered body / bad prefix", () => {
    expect(verifyGithubSignature(BODY, header, "other")).toBe(false);
    expect(verifyGithubSignature(BODY + "x", header, SECRET)).toBe(false);
    expect(verifyGithubSignature(BODY, header.replace("sha256=", "sha1="), SECRET)).toBe(false);
  });
});
