import type { SqlClient } from "@companyos/db";
import { createTenant, withTenant } from "@companyos/db";
import { ingestAllFixtures } from "@companyos/connectors/testing";
import type { LlmCallRecord, ProviderAdapter, RoutingTable } from "@companyos/llm";
import { LlmGateway, mockAdapter } from "@companyos/llm";
import { computeDelta, computeSnapshot } from "@companyos/state";
import type { StateDelta } from "@companyos/state";
import { askCompany, generateFounderBrief } from "@companyos/intelligence";
import type { Scenario, ScenarioEnv, ScenarioOutcome } from "./scenario.js";
import { BENCHMARK_VERSION, countInsights } from "./scenario.js";
import { SCENARIOS } from "./scenarios.js";

/**
 * Benchmark runner (M3b §5). Mock-first per D-009: the scripted model is part
 * of the frozen scenario; a real-model run swaps ONLY the adapter.
 *
 * Harness A/B (the ONE variable, Owner order):
 *   A = snapshot + selected events
 *   B = A + StateDelta (delta from the epoch snapshot to the cutoff)
 * Everything else — context version, prompt, validator, benchmark — is held
 * constant and recorded in the report.
 */

export type HarnessKey = "A" | "B";

/** Window wide enough that fixture history is bounded by scenario cutoffs, not recency. */
const WIDE_WINDOW = 5 * 365 * 24 * 3600 * 1000;
const EPOCH = "1970-01-01T00:00:00Z";

export interface ScenarioResult {
  scenarioId: string;
  category: Scenario["category"];
  title: string;
  passed: boolean;
  knownGap: boolean;
  violations: string[];
  llmCalls: number;
  estimatedCostUsd: number;
}

export interface BenchmarkReport {
  benchmarkVersion: string;
  harness: HarnessKey;
  contextVersion: string;
  model: string;
  results: ScenarioResult[];
  totals: {
    scenarios: number;
    passed: number;
    failed: number;
    knownGaps: number;
    byCategory: Record<string, { passed: number; failed: number; knownGaps: number }>;
  };
}

export interface RunBenchmarkOptions {
  harness: HarnessKey;
  /** replace the scripted mock with a real adapter (Frozen Benchmark × Real Model run) */
  realAdapter?: ProviderAdapter;
  scenarios?: Scenario[];
}

export async function runBenchmark(
  db: SqlClient,
  opts: RunBenchmarkOptions
): Promise<BenchmarkReport> {
  const scenarios = opts.scenarios ?? SCENARIOS;
  const results: ScenarioResult[] = [];

  for (const sc of scenarios) {
    results.push(await runScenario(db, sc, opts));
  }

  const byCategory: BenchmarkReport["totals"]["byCategory"] = {};
  for (const r of results) {
    const bucket = (byCategory[r.category] ??= { passed: 0, failed: 0, knownGaps: 0 });
    if (r.knownGap && !r.passed) bucket.knownGaps += 1;
    else if (r.passed) bucket.passed += 1;
    else bucket.failed += 1;
  }

  return {
    benchmarkVersion: BENCHMARK_VERSION,
    harness: opts.harness,
    contextVersion: "ctx-v1.0",
    model: opts.realAdapter ? opts.realAdapter.name : "mock",
    results,
    totals: {
      scenarios: results.length,
      passed: results.filter((r) => r.passed).length,
      failed: results.filter((r) => !r.passed && !r.knownGap).length,
      knownGaps: results.filter((r) => !r.passed && r.knownGap).length,
      byCategory,
    },
  };
}

async function runScenario(
  db: SqlClient,
  sc: Scenario,
  opts: RunBenchmarkOptions
): Promise<ScenarioResult> {
  const runId = `${BENCHMARK_VERSION}:${opts.harness}:${sc.id}`;
  const tenant = await createTenant(db, `bench-${opts.harness}-${sc.id}`);
  const env: ScenarioEnv = {};

  const records: LlmCallRecord[] = [];
  const capture = { promptSeen: "" };
  const gw = buildGateway(sc, env, opts, records, capture);

  let outcome: ScenarioOutcome = {
    scenarioId: sc.id,
    mode: sc.mode,
    verdict: null,
    modelConsulted: false,
    accepted: [],
    rejected: [],
    sectionCounts: null,
    persisted: 0,
    llmRecords: records,
    promptSeen: "",
    error: null,
  };

  try {
    await ingestAllFixtures(db, tenant);
    if (sc.setup) await sc.setup(db, tenant, env);
    await withTenant(db, tenant, async (tx) => {
      const snapshot = await computeSnapshot(tx, sc.cutoff);
      let delta: StateDelta | undefined;
      if (opts.harness === "B") {
        delta = computeDelta(await computeSnapshot(tx, EPOCH), snapshot);
      }
      const contextOpts = { windowMs: WIDE_WINDOW };

      if (sc.mode === "ask") {
        const out = await askCompany(tx, gw, tenant, sc.question!, snapshot, {
          runId,
          context: contextOpts,
          ...(delta ? { delta } : {}),
          ...(sc.askedAt ? { askedAt: sc.askedAt } : {}),
          ...(sc.staleAfterMs !== undefined ? { staleAfterMs: sc.staleAfterMs } : {}),
        });
        outcome = {
          ...outcome,
          verdict: out.verdict.verdict,
          modelConsulted: out.modelConsulted,
          accepted: out.insights,
          rejected: out.rejected,
        };
      } else {
        const brief = await generateFounderBrief(tx, gw, tenant, snapshot, {
          runId,
          context: contextOpts,
          ...(delta ? { delta } : {}),
        });
        outcome = {
          ...outcome,
          modelConsulted: true,
          accepted: brief.sections.flatMap((s) => s.insights),
          rejected: brief.rejected,
          sectionCounts: Object.fromEntries(brief.sections.map((s) => [s.key, s.insights.length])),
        };
      }
    });
  } catch (err) {
    outcome = { ...outcome, error: err instanceof Error ? err.message : String(err) };
  }

  outcome = {
    ...outcome,
    promptSeen: capture.promptSeen,
    persisted: await withTenant(db, tenant, (tx) => countInsights(tx, runId)),
  };

  const violations = sc.grade(outcome, env);
  return {
    scenarioId: sc.id,
    category: sc.category,
    title: sc.title,
    passed: violations.length === 0,
    knownGap: sc.knownGap ?? false,
    violations,
    llmCalls: records.length,
    estimatedCostUsd: records.reduce((n, r) => n + r.estimatedCostUsd, 0),
  };
}

function buildGateway(
  sc: Scenario,
  env: ScenarioEnv,
  opts: RunBenchmarkOptions,
  records: LlmCallRecord[],
  capture: { promptSeen: string }
): LlmGateway {
  const record = async (r: LlmCallRecord): Promise<void> => {
    records.push(r);
  };
  const mk = (provider: string) => ({
    provider,
    model: `${provider}-frozen`,
    inputPricePerMTok: 1,
    outputPricePerMTok: 5,
  });
  const wiring = sc.gateway ?? "normal";

  const inner: ProviderAdapter =
    opts.realAdapter ??
    mockAdapter((m: Parameters<Scenario["modelScript"]>[0]) => sc.modelScript(m, env));
  // Capture wraps the ADAPTER, not the mock script, so prompt-based grading
  // (scoping, constraints, cross-tenant leak checks) works identically in
  // real-model runs — the run swaps only the inner adapter, nothing else.
  const working: ProviderAdapter = {
    name: "mock",
    complete: async (req) => {
      capture.promptSeen = req.messages.find((m) => m.role === "user")?.content ?? "";
      return inner.complete(req);
    },
  };
  const dead: ProviderAdapter = {
    name: "dead",
    complete: async () => {
      throw new Error("provider unavailable");
    },
  };

  const entry =
    wiring === "fallback"
      ? { primary: mk("dead"), fallback: mk("mock") }
      : wiring === "failing"
        ? { primary: mk("dead") }
        : { primary: mk("mock") };
  const routing: RoutingTable = { FAST: entry, BALANCED: entry, REASONING: entry };
  const adapters = new Map<string, ProviderAdapter>([
    ["mock", working],
    ["dead", dead],
  ]);
  return new LlmGateway(routing, adapters, record);
}
