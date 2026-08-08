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
 * format, and it covers FEWER credentials than one might assume:
 *   - Stripe API keys DO distinguish live from test (`sk_live_`/`sk_test_`),
 *     so those are genuinely gated.
 *   - Stripe WEBHOOK SIGNING SECRETS do NOT: both modes issue `whsec_<random>`.
 *     A production webhook secret is indistinguishable from a test one.
 *   - GitHub, Slack, and Gmail have NO test-mode key format at all — a token
 *     for a company's real workspace is byte-identical in shape to a token
 *     for a throwaway test org.
 * Everything in the second and third groups must be gated by an explicit
 * installation/scope allowlist instead. A passing guard is NOT evidence that
 * a credential points at a sandbox resource.
 */

export type DataPhase = "phase0" | "phase1" | "phase2" | "phase3";

const PHASES: readonly DataPhase[] = ["phase0", "phase1", "phase2", "phase3"];

/** Phases at or beyond the Phase 2 data-readiness gate may hold production data. */
const POST_GATE_PHASES: readonly DataPhase[] = ["phase2", "phase3"];

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
 * Known production-credential shapes. Matching one is proof of a production
 * credential; NOT matching proves nothing (see limitation above).
 *
 * Deliberately unanchored: credentials are commonly stored as a JSON blob
 * (Stripe needs key + webhook secret; a GitHub App needs three fields), so a
 * live key can sit anywhere inside the string, not just at position 0.
 */
const PRODUCTION_KEY_PATTERNS: { pattern: RegExp; what: string }[] = [
  { pattern: /\bsk_live_[A-Za-z0-9]/, what: "Stripe live secret key" },
  { pattern: /\brk_live_[A-Za-z0-9]/, what: "Stripe live restricted key" },
  { pattern: /\bpk_live_[A-Za-z0-9]/, what: "Stripe live publishable key" },
];

/** Providers whose credentials this guard can actually classify by shape. */
export const GATEABLE_PROVIDERS = ["stripe"] as const;

export class ProductionDataRefused extends Error {}

/**
 * Throws if `secret` contains a recognized production credential and the
 * current phase has not passed the Phase 2 data-readiness gate.
 *
 * The error deliberately never includes the secret — only its classification.
 */
export function assertCredentialAllowed(
  provider: string,
  secret: string,
  env: Record<string, string | undefined> = process.env
): void {
  const phase = currentDataPhase(env);
  if (POST_GATE_PHASES.includes(phase)) return; // gate passed; see DATA-READINESS.md

  for (const { pattern, what } of PRODUCTION_KEY_PATTERNS) {
    if (pattern.test(secret)) {
      throw new ProductionDataRefused(
        `refusing to store a ${what} for provider "${provider}" in data phase "${phase}". ` +
          `Phase 0/1 permit provider sandbox/test-mode credentials only. ` +
          `Production company data requires the data-readiness gate ` +
          `(docs/DATA-READINESS.md) and COMPANYOS_DATA_PHASE=phase2.`
      );
    }
  }
}
