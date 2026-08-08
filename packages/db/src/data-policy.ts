/**
 * Data readiness gate (docs/DATA-READINESS.md), enforced as CODE.
 *
 * A prose rule saying "no production data before the gate" is not a control —
 * someone pastes a live key and nothing stops them. Policy is deterministic
 * (Operating Mandate: deterministic systems own policy), so the credential
 * chokepoint refuses production credentials until the phase is raised
 * explicitly and deliberately.
 *
 * HONEST LIMITATION: this guard is only as strong as the provider's key
 * format. Stripe distinguishes live from test keys, so Stripe is genuinely
 * gated here. GitHub, Slack, and Gmail have NO test-mode key format — a token
 * for a company's real workspace is byte-indistinguishable from a token for a
 * throwaway test org. Those providers must be gated by an explicit
 * scope/installation allowlist (tracked separately); do not read a passing
 * guard as proof that a GitHub token points at a test repository.
 */

export type DataPhase = "phase0" | "phase1" | "beta";

const PHASES: readonly DataPhase[] = ["phase0", "phase1", "beta"];

/**
 * Current phase, from COMPANYOS_DATA_PHASE. Defaults to the most restrictive
 * phase: production data requires a deliberate, visible act, never a default.
 */
export function currentDataPhase(env: Record<string, string | undefined>): DataPhase {
  const raw = env.COMPANYOS_DATA_PHASE;
  if (raw === undefined || raw === "") return "phase0";
  if (!PHASES.includes(raw as DataPhase)) {
    throw new Error(
      `COMPANYOS_DATA_PHASE must be one of ${PHASES.join(" | ")} (got "${raw}") — ` +
        `refusing to guess a data-safety posture`
    );
  }
  return raw as DataPhase;
}

/**
 * Known production-credential shapes. Matching a pattern is proof of a
 * production credential; NOT matching proves nothing (see limitation above).
 */
const PRODUCTION_KEY_PATTERNS: { pattern: RegExp; what: string }[] = [
  { pattern: /^sk_live_/, what: "Stripe live secret key" },
  { pattern: /^rk_live_/, what: "Stripe live restricted key" },
  { pattern: /^pk_live_/, what: "Stripe live publishable key" },
  { pattern: /^whsec_live_/, what: "Stripe live webhook secret" },
];

/** Providers whose credentials this guard can actually classify. */
export const GATEABLE_PROVIDERS = ["stripe"] as const;

export class ProductionDataRefused extends Error {}

/**
 * Throws if `secret` is a recognized production credential and the current
 * phase has not been raised to `beta` (the post-gate phase).
 *
 * The error deliberately never includes the secret — only its classification.
 */
export function assertCredentialAllowed(
  provider: string,
  secret: string,
  env: Record<string, string | undefined> = process.env
): void {
  const phase = currentDataPhase(env);
  if (phase === "beta") return; // gate explicitly passed; see DATA-READINESS.md

  for (const { pattern, what } of PRODUCTION_KEY_PATTERNS) {
    if (pattern.test(secret)) {
      throw new ProductionDataRefused(
        `refusing to store a ${what} for provider "${provider}" in data phase "${phase}". ` +
          `Phase 0/1 permit provider sandbox/test-mode credentials only. ` +
          `Production company data requires the data-readiness gate ` +
          `(docs/DATA-READINESS.md) and COMPANYOS_DATA_PHASE=beta.`
      );
    }
  }
}
