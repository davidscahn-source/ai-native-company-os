import { describe, expect, it } from "vitest";
import { encryptCredential } from "../src/crypto.js";
import {
  assertCredentialAllowed,
  currentDataPhase,
  ProductionDataRefused,
} from "../src/data-policy.js";

const KEY = "a".repeat(64);

describe("data readiness gate (policy as code, not prose)", () => {
  it("defaults to the most restrictive phase when unset", () => {
    expect(currentDataPhase({})).toBe("phase0");
    expect(currentDataPhase({ COMPANYOS_DATA_PHASE: "" })).toBe("phase0");
  });

  it("accepts every documented phase and refuses to guess anything else", () => {
    for (const phase of ["phase0", "phase1", "phase2", "phase3"]) {
      expect(currentDataPhase({ COMPANYOS_DATA_PHASE: phase })).toBe(phase);
    }
    expect(() => currentDataPhase({ COMPANYOS_DATA_PHASE: "prod" })).toThrow(/must be one of/);
    expect(() => currentDataPhase({ COMPANYOS_DATA_PHASE: "beta" })).toThrow(/must be one of/);
  });

  it("rejects Stripe live credentials in the pre-gate phases", () => {
    for (const phase of ["phase0", "phase1"]) {
      for (const live of ["sk_live_abc123", "rk_live_abc123", "pk_live_abc123"]) {
        expect(() =>
          assertCredentialAllowed("stripe", live, { COMPANYOS_DATA_PHASE: phase })
        ).toThrow(ProductionDataRefused);
      }
    }
  });

  it("finds a live key anywhere in the payload, not just at position 0", () => {
    const blob = JSON.stringify({ apiKey: "sk_live_abc123", webhookSecret: "whsec_xyz" });
    expect(() =>
      assertCredentialAllowed("stripe", blob, { COMPANYOS_DATA_PHASE: "phase0" })
    ).toThrow(ProductionDataRefused);
    expect(() =>
      assertCredentialAllowed("stripe", "  sk_live_abc123\n", { COMPANYOS_DATA_PHASE: "phase0" })
    ).toThrow(ProductionDataRefused);
  });

  it("allows sandbox/test-mode credentials", () => {
    expect(() =>
      assertCredentialAllowed("stripe", "sk_test_abc123", { COMPANYOS_DATA_PHASE: "phase0" })
    ).not.toThrow();
    expect(() =>
      assertCredentialAllowed(
        "stripe",
        JSON.stringify({ apiKey: "sk_test_abc", webhookSecret: "whsec_abc" }),
        { COMPANYOS_DATA_PHASE: "phase0" }
      )
    ).not.toThrow();
  });

  it("only post-gate phases permit production credentials", () => {
    for (const phase of ["phase2", "phase3"]) {
      expect(() =>
        assertCredentialAllowed("stripe", "sk_live_abc", { COMPANYOS_DATA_PHASE: phase })
      ).not.toThrow();
    }
  });

  it("the refusal never echoes the secret itself", () => {
    try {
      assertCredentialAllowed("stripe", "sk_live_SUPERSECRETVALUE", {
        COMPANYOS_DATA_PHASE: "phase0",
      });
      throw new Error("should have refused");
    } catch (err) {
      expect(String(err)).not.toContain("SUPERSECRETVALUE");
      expect(String(err)).toContain("Stripe live secret key");
    }
  });

  it("the storage chokepoint enforces it: a live key cannot be encrypted, so it cannot be stored", () => {
    expect(() => encryptCredential("sk_live_abc", KEY, { provider: "stripe" })).toThrow(
      ProductionDataRefused
    );
    expect(() => encryptCredential("sk_test_abc", KEY, { provider: "stripe" })).not.toThrow();
  });

  describe("DOCUMENTED GAPS — pinned so they cannot be quietly forgotten", () => {
    it("Stripe webhook secrets are identical in live and test mode (whsec_<random>)", () => {
      // There is no such thing as a "whsec_live_" prefix. A production webhook
      // signing secret is indistinguishable from a test one, so this guard
      // cannot block it — an installation allowlist must.
      expect(() =>
        assertCredentialAllowed("stripe", "whsec_realProductionSecret", {
          COMPANYOS_DATA_PHASE: "phase0",
        })
      ).not.toThrow();
    });

    it("providers without test-mode key formats are not gated by shape", () => {
      // GitHub/Slack/Gmail tokens for a real company workspace are
      // byte-indistinguishable from throwaway-org tokens.
      expect(() =>
        assertCredentialAllowed("github", "ghp_realCompanyToken", {
          COMPANYOS_DATA_PHASE: "phase0",
        })
      ).not.toThrow();
    });
  });
});
