import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SqlClient } from "@companyos/db";
import { createTenant, createTestClient, withTenant } from "@companyos/db";
import { generateCompany, ingestCompany, seedsOf } from "@companyos/simulator";
import { BASELINE_VERSION, detectDeterministically } from "../src/deterministic-baseline.js";
import { scoreUtility } from "../src/utility.js";
import type { UtilityScore } from "../src/utility.js";

/**
 * The first real measurement the lab produces. Deterministic rules only — no
 * model, no Owner credentials needed — establishing the floor any intelligence
 * harness must clear to justify its cost.
 */

const SEEDS = seedsOf("dev", 5);

let db: SqlClient;
const scores: UtilityScore[] = [];

beforeAll(async () => {
  db = await createTestClient();
  for (const seed of SEEDS) {
    const company = generateCompany({ seed, purpose: "development" });
    const tenant = await createTenant(db, `baseline-${seed}`);
    await ingestCompany(db, tenant, company);
    const score = await withTenant(db, tenant, async (tx) => {
      const surfaced = await detectDeterministically(tx, { capturedUntil: company.endAt });
      return scoreUtility(tx, { seed, groundTruth: company.groundTruth, surfaced });
    });
    scores.push(score);
  }
}, 300000);

afterAll(async () => {
  await db.close();
});

const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
const round = (x: number): number => Math.round(x * 1000) / 1000;

describe("deterministic baseline (the floor an LLM harness must beat)", () => {
  it("stores the baseline as a committed snapshot, not console output", () => {
    const priority = scores.map((s) => s.priorityAccuracy).filter((v): v is number => v !== null);
    const summary = {
      baselineVersion: BASELINE_VERSION,
      seeds: SEEDS.length,
      signalRecall: round(mean(scores.map((s) => s.signalRecall))),
      signalPrecision: round(mean(scores.map((s) => s.signalPrecision))),
      noiseRatio: round(mean(scores.map((s) => s.noiseRatio))),
      priorityAccuracy: priority.length > 0 ? round(mean(priority)) : null,
      falseCausalClaims: scores.reduce((n, s) => n + s.falseCausalClaims, 0),
      meanSurfaced: round(mean(scores.map((s) => s.surfacedCount))),
    };
    // A stored snapshot makes the floor diffable: any future change to the
    // generator, the scorer, or the rules shows up as a reviewable delta
    // instead of scrolling past in CI output.
    expect(summary).toMatchSnapshot();

    // The rules were written against these exact planted shapes, so recall
    // must be perfect — anything less means the scorer or generator drifted.
    expect(summary.signalRecall).toBe(1);
    // Rules cannot invent causality, so this must be zero by construction.
    expect(summary.falseCausalClaims).toBe(0);
  });

  it("the baseline is deterministic: same seed, same score", async () => {
    const seed = SEEDS[0]!;
    const company = generateCompany({ seed, purpose: "development" });
    const run = async (name: string): Promise<UtilityScore> => {
      const tenant = await createTenant(db, name);
      await ingestCompany(db, tenant, company);
      return withTenant(db, tenant, async (tx) => {
        const surfaced = await detectDeterministically(tx, { capturedUntil: company.endAt });
        return scoreUtility(tx, { seed, groundTruth: company.groundTruth, surfaced });
      });
    };
    const a = await run("baseline-rep-a");
    const b = await run("baseline-rep-b");
    expect(JSON.stringify({ ...a, signals: a.signals })).toBe(
      JSON.stringify({ ...b, signals: b.signals })
    );
  }, 120000);

  it("respects the cutoff: an earlier capturedUntil cannot see the planted churn", async () => {
    const seed = SEEDS[0]!;
    const company = generateCompany({ seed, purpose: "development" });
    const tenant = await createTenant(db, "baseline-cutoff");
    await ingestCompany(db, tenant, company);
    const early = new Date(new Date(company.endAt).getTime() - 30 * 24 * 3600 * 1000).toISOString();
    const score = await withTenant(db, tenant, async (tx) => {
      const surfaced = await detectDeterministically(tx, { capturedUntil: early });
      return scoreUtility(tx, { seed, groundTruth: company.groundTruth, surfaced });
    });
    // The planted failures happen in the last 21 days, so before them the
    // churn signal is genuinely undetectable — a lab that "found" it here
    // would be scoring on data the system never saw.
    const churn = score.signals.find((s) => s.signalId === "signal-a-churn")!;
    expect(churn.detected).toBe(false);
  }, 120000);
});
