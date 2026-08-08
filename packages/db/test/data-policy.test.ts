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

  it("refuses to guess an unknown phase value", () => {
    expect(() => currentDataPhase({ COMPANYOS_DATA_PHASE: "prod" })).toThrow(/must be one of/);
  });

  it("rejects Stripe live credentials in phase0 and phase1", () => {
    for (const phase of ["phase0", "phase1"]) {
      for (const live of ["sk_live_abc123", "rk_live_abc", "pk_live_abc", "whsec_live_abc"]) {
        expect(() =>
          assertCredentialAllowed("stripe", live, { COMPANYOS_DATA_PHASE: phase })
        ).toThrow(ProductionDataRefused);
      }
    }
  });

  it("allows sandbox/test-mode credentials", () => {
    expect(() =>
      assertCredentialAllowed("stripe", "sk_test_abc123", { COMPANYOS_DATA_PHASE: "phase0" })
    ).not.toThrow();
    expect(() =>
      assertCredentialAllowed("stripe", "whsec_test_abc", { COMPANYOS_DATA_PHASE: "phase0" })
    ).not.toThrow();
  });

  it("only beta — the post-gate phase — permits production credentials", () => {
    expect(() =>
      assertCredentialAllowed("stripe", "sk_live_abc", { COMPANYOS_DATA_PHASE: "beta" })
    ).not.toThrow();
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

  it("DOCUMENTED GAP: providers without test-mode key formats are not gated by shape", () => {
    // GitHub/Slack/Gmail tokens for a real company workspace are
    // byte-indistinguishable from throwaway-org tokens. This guard passing is
    // NOT evidence that such a token points at a test resource — those need an
    // explicit installation/scope allowlist (tracked separately).
    expect(() =>
      assertCredentialAllowed("github", "ghp_realCompanyToken", {
        COMPANYOS_DATA_PHASE: "phase0",
      })
    ).not.toThrow();
  });
});
