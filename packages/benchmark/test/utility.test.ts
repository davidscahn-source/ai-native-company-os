import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SqlClient } from "@companyos/db";
import { createTenant, createTestClient, withTenant } from "@companyos/db";
import type { InsightDraft } from "@companyos/intelligence";
import { generateCompany, ingestCompany } from "@companyos/simulator";
import type { GeneratedCompany } from "@companyos/simulator";
import { resolveGroundTruthKeys, scoreUtility } from "../src/utility.js";

/**
 * The scorer is the instrument the whole lab reads from, so it is tested the
 * way an instrument should be: with inputs whose correct score we already
 * know — a perfect answer, a total miss, a noise-chaser, and a right answer
 * citing the wrong rows.
 */

const SEED = 1000;

let db: SqlClient;
let tenant: string;
let company: GeneratedCompany;
/** provider key → db uuid, for building test insights that cite real rows */
let ids: Map<string, string>;

const insight = (refs: string[], kind: InsightDraft["kind"] = "fact"): InsightDraft => ({
  kind,
  category: "revenue",
  statement: "test claim",
  confidence: kind === "inference" ? 0.7 : null,
  evidenceRefs: refs.map((id) => ({ type: "entity", id })),
  motivatedBy: null,
  missing: null,
});

beforeAll(async () => {
  db = await createTestClient();
  tenant = await createTenant(db, "utility-score");
  company = generateCompany({ seed: SEED, purpose: "development" });
  await ingestCompany(db, tenant, company);
  const allKeys = [
    ...company.groundTruth.signals.flatMap((s) => s.evidenceKeys),
    ...company.groundTruth.nonRelationships.flatMap((nr) => [nr.aKey, nr.bKey]),
  ];
  ids = await withTenant(db, tenant, (tx) => resolveGroundTruthKeys(tx, allKeys));
}, 120000);

afterAll(async () => {
  await db.close();
});

function keyId(key: string): string {
  const id = ids.get(key);
  if (id === undefined) throw new Error(`ground truth key ${key} did not resolve`);
  return id;
}

describe("utility scoring", () => {
  it("resolves ground-truth provider keys to real canonical rows", () => {
    for (const s of company.groundTruth.signals) {
      const anyResolved = s.evidenceKeys.some((k) => ids.has(k));
      expect(anyResolved, `no evidence key of ${s.id} resolved`).toBe(true);
    }
  });

  it("a perfect answer scores recall 1, noise 0, priority 1", async () => {
    const [first, second] = [...company.groundTruth.signals].sort(
      (a, b) => a.priority - b.priority
    );
    const surfaced = [
      insight([keyId(first!.evidenceKeys.find((k) => ids.has(k))!)]),
      insight([keyId(second!.evidenceKeys.find((k) => ids.has(k))!)]),
    ];
    const score = await withTenant(db, tenant, (tx) =>
      scoreUtility(tx, { seed: SEED, groundTruth: company.groundTruth, surfaced })
    );
    expect(score.signalRecall).toBe(1);
    expect(score.signalPrecision).toBe(1);
    expect(score.noiseRatio).toBe(0);
    expect(score.priorityAccuracy).toBe(1);
    expect(score.falseCausalClaims).toBe(0);
  });

  it("PRIORITY: finding everything but ranking the critical signal last is penalised", async () => {
    const [first, second] = [...company.groundTruth.signals].sort(
      (a, b) => a.priority - b.priority
    );
    // same two findings, reversed order
    const surfaced = [
      insight([keyId(second!.evidenceKeys.find((k) => ids.has(k))!)]),
      insight([keyId(first!.evidenceKeys.find((k) => ids.has(k))!)]),
    ];
    const score = await withTenant(db, tenant, (tx) =>
      scoreUtility(tx, { seed: SEED, groundTruth: company.groundTruth, surfaced })
    );
    expect(score.signalRecall).toBe(1); // recall alone would call this perfect
    expect(score.priorityAccuracy).toBe(0); // priority accuracy catches it
  });

  it("a total miss scores recall 0 and noise 1", async () => {
    const decoy = company.groundTruth.nonRelationships[0]!;
    const surfaced = [insight([keyId(decoy.aKey)]), insight([keyId(decoy.bKey)])];
    const score = await withTenant(db, tenant, (tx) =>
      scoreUtility(tx, { seed: SEED, groundTruth: company.groundTruth, surfaced })
    );
    expect(score.signalRecall).toBe(0);
    expect(score.signalPrecision).toBe(0);
    expect(score.noiseRatio).toBe(1);
    expect(score.priorityAccuracy).toBeNull();
  });

  it("NOISE TRAP: linking a declared non-relationship is counted as a false causal claim", async () => {
    const decoy = company.groundTruth.nonRelationships[0]!;
    const surfaced = [
      insight([keyId(decoy.aKey), keyId(decoy.bKey)], "inference"), // "the bug caused the failure"
    ];
    const score = await withTenant(db, tenant, (tx) =>
      scoreUtility(tx, { seed: SEED, groundTruth: company.groundTruth, surfaced })
    );
    expect(score.falseCausalClaims).toBe(1);
  });

  it("EVIDENCE: the right conclusion citing wrong rows scores below 1", async () => {
    const churn = company.groundTruth.signals.find((s) => s.kind === "churn_risk")!;
    const decoy = company.groundTruth.nonRelationships[0]!;
    const surfaced = [
      insight([keyId(churn.evidenceKeys.find((k) => ids.has(k))!), keyId(decoy.bKey)]),
    ];
    const score = await withTenant(db, tenant, (tx) =>
      scoreUtility(tx, { seed: SEED, groundTruth: company.groundTruth, surfaced })
    );
    const churnOutcome = score.signals.find((s) => s.signalId === churn.id)!;
    expect(churnOutcome.detected).toBe(true);
    expect(churnOutcome.evidenceAccuracy).toBeLessThan(1);
    expect(churnOutcome.evidenceAccuracy).toBeGreaterThan(0);
  });

  it("saying nothing is not a way to score well", async () => {
    const score = await withTenant(db, tenant, (tx) =>
      scoreUtility(tx, { seed: SEED, groundTruth: company.groundTruth, surfaced: [] })
    );
    expect(score.signalRecall).toBe(0);
    expect(score.signalPrecision).toBe(0);
    expect(score.noiseRatio).toBe(0); // nothing surfaced, so nothing is noise
    expect(score.surfacedCount).toBe(0);
  });

  it("padding the brief with irrelevant findings lowers precision without helping recall", async () => {
    const churn = company.groundTruth.signals.find((s) => s.kind === "churn_risk")!;
    const hit = insight([keyId(churn.evidenceKeys.find((k) => ids.has(k))!)]);
    const filler = company.groundTruth.nonRelationships
      .slice(0, 4)
      .map((nr) => insight([keyId(nr.bKey)]));
    const score = await withTenant(db, tenant, (tx) =>
      scoreUtility(tx, { seed: SEED, groundTruth: company.groundTruth, surfaced: [hit, ...filler] })
    );
    expect(score.signalPrecision).toBeCloseTo(1 / 5);
    expect(score.noiseRatio).toBeCloseTo(4 / 5);
  });
});
