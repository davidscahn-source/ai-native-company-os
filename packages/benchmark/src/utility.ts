import type { Queryable } from "@companyos/db";
import type { EvidenceRef, InsightDraft } from "@companyos/intelligence";
import type { GroundTruth, PlantedSignal } from "@companyos/simulator";

/**
 * Utility scoring (M3c Stage B).
 *
 * The safety benchmark asks "does the system refuse to lie?". This asks the
 * other half: "does it find what actually matters, and does it rank it first?"
 *
 * Everything here is deterministic. The model's answer is the input; the score
 * is pure code, so a run is reproducible and a regression is attributable.
 */

export const UTILITY_BENCHMARK_VERSION = "utility-v1.0";

/**
 * Ground truth speaks provider keys ("customer:cus_1000_0"); insights cite DB
 * uuids. This resolves the former to the latter through source_links, which is
 * the same mapping the product itself uses.
 */
export async function resolveGroundTruthKeys(
  tx: Queryable,
  keys: string[]
): Promise<Map<string, string>> {
  const resolved = new Map<string, string>();
  for (const key of keys) {
    const sep = key.indexOf(":");
    if (sep === -1) continue;
    const sourceType = key.slice(0, sep);
    const sourceId = key.slice(sep + 1);
    const rows = await tx.query<{ entity_id: string }>(
      `select entity_id from source_links where source_type = $1 and source_id = $2`,
      [sourceType, sourceId]
    );
    const entityId = rows[0]?.entity_id;
    if (entityId !== undefined) resolved.set(key, entityId);
  }
  return resolved;
}

/** All DB ids that count as evidence for a signal: its entities and their events. */
async function signalEvidenceIds(tx: Queryable, signal: PlantedSignal): Promise<Set<string>> {
  const entityByKey = await resolveGroundTruthKeys(tx, signal.evidenceKeys);
  const ids = new Set<string>(entityByKey.values());
  if (entityByKey.size > 0) {
    const rows = await tx.query<{ id: string }>(
      `select id from events where entity_id = any($1::uuid[])`,
      [[...entityByKey.values()]]
    );
    for (const r of rows) ids.add(r.id);
  }
  return ids;
}

export interface SignalOutcome {
  signalId: string;
  priority: number;
  detected: boolean;
  /** Position of the first insight that detected it, in presentation order. */
  detectedAtRank: number | null;
  /** Of the refs cited by detecting insights, the share that belong to this signal. */
  evidenceAccuracy: number | null;
}

export interface UtilityScore {
  benchmarkVersion: string;
  seed: number;
  /** detected signals / planted signals */
  signalRecall: number;
  /** insights that map to a planted signal / all surfaced insights */
  signalPrecision: number;
  /** surfaced insights matching no planted signal / all surfaced insights */
  noiseRatio: number;
  /**
   * Pairwise concordance between ground-truth priority and presentation rank,
   * over detected signals. 1 = the most important thing was surfaced first.
   * null when fewer than two signals were detected (no pair to compare).
   */
  priorityAccuracy: number | null;
  /** Mean evidence accuracy over detected signals. */
  evidenceAccuracy: number | null;
  /** Claims that linked a pair the generator declared explicitly UNRELATED. */
  falseCausalClaims: number;
  surfacedCount: number;
  signals: SignalOutcome[];
}

export interface ScoreInput {
  seed: number;
  groundTruth: GroundTruth;
  /** Insights in the order the founder would read them. */
  surfaced: InsightDraft[];
}

export async function scoreUtility(tx: Queryable, input: ScoreInput): Promise<UtilityScore> {
  const { groundTruth, surfaced } = input;

  const evidenceBySignal = new Map<string, Set<string>>();
  for (const s of groundTruth.signals) {
    evidenceBySignal.set(s.id, await signalEvidenceIds(tx, s));
  }

  const citedIds = (i: InsightDraft): string[] => i.evidenceRefs.map((r: EvidenceRef) => r.id);

  const outcomes: SignalOutcome[] = [];
  for (const signal of groundTruth.signals) {
    const owned = evidenceBySignal.get(signal.id)!;
    let rank: number | null = null;
    let hits = 0;
    let cited = 0;
    for (const [i, insight] of surfaced.entries()) {
      const ids = citedIds(insight);
      const matched = ids.filter((id) => owned.has(id));
      if (matched.length === 0) continue;
      if (rank === null) rank = i;
      hits += matched.length;
      cited += ids.length;
    }
    outcomes.push({
      signalId: signal.id,
      priority: signal.priority,
      detected: rank !== null,
      detectedAtRank: rank,
      evidenceAccuracy: cited > 0 ? hits / cited : null,
    });
  }

  // An insight is "on target" when it cites evidence belonging to any signal.
  const allSignalIds = new Set<string>();
  for (const set of evidenceBySignal.values()) for (const id of set) allSignalIds.add(id);
  const onTarget = surfaced.filter((i) => citedIds(i).some((id) => allSignalIds.has(id)));

  // A false causal claim links a pair the generator declared unrelated. The
  // decoys exist precisely to make this measurable.
  const nonRelatedPairs = await Promise.all(
    groundTruth.nonRelationships.map(async (nr) => {
      const m = await resolveGroundTruthKeys(tx, [nr.aKey, nr.bKey]);
      return [m.get(nr.aKey), m.get(nr.bKey)] as const;
    })
  );
  let falseCausalClaims = 0;
  for (const insight of surfaced) {
    const ids = new Set(citedIds(insight));
    for (const [a, b] of nonRelatedPairs) {
      if (a !== undefined && b !== undefined && ids.has(a) && ids.has(b)) {
        falseCausalClaims += 1;
        break;
      }
    }
  }

  const detected = outcomes.filter((o) => o.detected);
  const evAcc = detected.map((o) => o.evidenceAccuracy).filter((v): v is number => v !== null);

  return {
    benchmarkVersion: UTILITY_BENCHMARK_VERSION,
    seed: input.seed,
    signalRecall:
      groundTruth.signals.length === 0 ? 0 : detected.length / groundTruth.signals.length,
    signalPrecision: surfaced.length === 0 ? 0 : onTarget.length / surfaced.length,
    noiseRatio: surfaced.length === 0 ? 0 : (surfaced.length - onTarget.length) / surfaced.length,
    priorityAccuracy: pairwiseConcordance(detected),
    evidenceAccuracy: evAcc.length === 0 ? null : evAcc.reduce((a, b) => a + b, 0) / evAcc.length,
    falseCausalClaims,
    surfacedCount: surfaced.length,
    signals: outcomes,
  };
}

/**
 * Fraction of signal pairs whose presentation order agrees with their
 * ground-truth priority. Finding all ten problems is worth little if the
 * critical one is ninth — this is the metric that says so.
 */
function pairwiseConcordance(detected: SignalOutcome[]): number | null {
  if (detected.length < 2) return null;
  let agree = 0;
  let total = 0;
  for (let i = 0; i < detected.length; i++) {
    for (let j = i + 1; j < detected.length; j++) {
      const a = detected[i]!;
      const b = detected[j]!;
      if (a.priority === b.priority) continue;
      total += 1;
      const moreImportant = a.priority < b.priority ? a : b;
      const lessImportant = a.priority < b.priority ? b : a;
      if (moreImportant.detectedAtRank! < lessImportant.detectedAtRank!) agree += 1;
    }
  }
  return total === 0 ? null : agree / total;
}
