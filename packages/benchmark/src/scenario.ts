import type { LlmMessage } from "@companyos/llm";
import type { Answerability } from "@companyos/intelligence";
import type { InsightDraft } from "@companyos/intelligence";
import type { LlmCallRecord } from "@companyos/llm";
import type { Queryable, SqlClient } from "@companyos/db";

/**
 * Benchmark scenario contract (M3b §4). Frozen once the benchmark version
 * ships: scenario ids and grading are append-only so scores stay comparable
 * across harnesses and models.
 *
 * The benchmark grades the SYSTEM (context builder + validator + answerability
 * + gateway), not the model's manners: mock scripts simulate both obedient and
 * adversarial models, and grading asserts what the system must guarantee
 * regardless of what the model tried to do.
 */

export const BENCHMARK_VERSION = "bench-v1.0";

export type ScenarioCategory =
  | "normal"
  | "missing_stale"
  | "ambiguous_correlation"
  | "prompt_injection"
  | "cross_tenant"
  | "provider_failure"
  | "unsupported";

/** Owner-approved adversarial-majority distribution (총 25). */
export const CATEGORY_DISTRIBUTION: Record<ScenarioCategory, number> = {
  normal: 8,
  missing_stale: 4,
  ambiguous_correlation: 4,
  prompt_injection: 3,
  cross_tenant: 2,
  provider_failure: 2,
  unsupported: 2,
};

/** Values the scenario setup can hand to the model script and grader. */
export type ScenarioEnv = Record<string, string>;

export interface ScenarioOutcome {
  scenarioId: string;
  mode: "ask" | "brief";
  /** ask mode only */
  verdict: Answerability | null;
  modelConsulted: boolean;
  accepted: InsightDraft[];
  rejected: { draft: InsightDraft; reason: string }[];
  /** brief mode: insights per section key */
  sectionCounts: Record<string, number> | null;
  /** rows actually persisted to insights for this run */
  persisted: number;
  /** every gateway call the run made (the ledger) */
  llmRecords: LlmCallRecord[];
  /** rendered user prompt the model saw ("" when the model was never consulted) */
  promptSeen: string;
  /** unhandled harness error, if the run threw */
  error: string | null;
}

export interface Scenario {
  id: string;
  category: ScenarioCategory;
  title: string;
  mode: "ask" | "brief";
  question?: string;
  /** capturedUntil for the snapshot (always explicit — never "now") */
  cutoff: string;
  /** staleness knobs for ask mode */
  askedAt?: string;
  staleAfterMs?: number;
  /** extra data planted before the run (injection payloads, foreign tenants...) */
  setup?: (db: SqlClient, tenant: string, env: ScenarioEnv) => Promise<void>;
  /** gateway wiring: normal = primary works; fallback = primary dies, fallback works; failing = all attempts die */
  gateway?: "normal" | "fallback" | "failing";
  /** the scripted model (mock runs). Real-model runs replace this, nothing else. */
  modelScript: (messages: LlmMessage[], env: ScenarioEnv) => string;
  /** returns violations; empty array = pass */
  grade: (outcome: ScenarioOutcome, env: ScenarioEnv) => string[];
  /**
   * Documented harness v1 gap: the scenario is EXPECTED to fail today and the
   * report counts it separately. Removing the flag (not the scenario) is how a
   * harness upgrade claims the fix.
   */
  knownGap?: boolean;
}

/** Helper: first evidence ref of a type visible in the rendered context. */
export function refInContext(messages: LlmMessage[], type: "event" | "entity", nth = 0): string {
  const ctx = messages.find((m) => m.role === "user")?.content ?? "";
  const all = [...ctx.matchAll(new RegExp(`\\[${type}:([0-9a-f-]{36})\\]`, "g"))];
  const m = all[nth];
  if (!m) throw new Error(`no ${type} ref #${nth} visible in context`);
  return m[1]!;
}

/** Helper: does any accepted insight satisfy the predicate? */
export function anyAccepted(outcome: ScenarioOutcome, pred: (i: InsightDraft) => boolean): boolean {
  return outcome.accepted.some(pred);
}

export async function countInsights(tx: Queryable, runId: string): Promise<number> {
  const rows = await tx.query<{ n: string }>(
    `select count(*) as n from insights where run_id = $1`,
    [runId]
  );
  return Number(rows[0]!.n);
}
