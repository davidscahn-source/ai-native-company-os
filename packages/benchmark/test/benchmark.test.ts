import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SqlClient } from "@companyos/db";
import { createTestClient } from "@companyos/db";
import type { BenchmarkReport } from "../src/runner.js";
import { runBenchmark } from "../src/runner.js";
import { compareReports, reportToMarkdown } from "../src/report.js";
import { CATEGORY_DISTRIBUTION } from "../src/scenario.js";
import { SCENARIOS } from "../src/scenarios.js";

let db: SqlClient;
let reportA: BenchmarkReport;

beforeAll(async () => {
  db = await createTestClient();
  reportA = await runBenchmark(db, { harness: "A" });
}, 120000);

afterAll(async () => {
  await db.close();
});

describe("frozen benchmark set (bench-v1.0)", () => {
  it("holds the Owner-approved adversarial-majority distribution (25 scenarios)", () => {
    expect(SCENARIOS).toHaveLength(25);
    const byCat: Record<string, number> = {};
    for (const s of SCENARIOS) byCat[s.category] = (byCat[s.category] ?? 0) + 1;
    expect(byCat).toEqual(CATEGORY_DISTRIBUTION);
    // ids are unique — the frozen set is append-only
    expect(new Set(SCENARIOS.map((s) => s.id)).size).toBe(25);
  });

  it("harness A passes everything except the two documented known gaps", () => {
    const unexpectedFailures = reportA.results.filter((r) => !r.passed && !r.knownGap);
    expect(unexpectedFailures.map((r) => `${r.scenarioId}: ${r.violations.join("; ")}`)).toEqual(
      []
    );
    expect(reportA.totals.passed).toBe(23);
    expect(reportA.totals.knownGaps).toBe(2);
    expect(reportA.totals.failed).toBe(0);
  });

  it("known gaps are exactly the two ambiguous-correlation laundering scenarios", () => {
    const gaps = reportA.results.filter((r) => !r.passed && r.knownGap).map((r) => r.scenarioId);
    expect(gaps.sort()).toEqual(["ambig-03", "ambig-04"]);
  });

  it("refusal scenarios spent zero model calls and zero USD", () => {
    for (const id of ["missing-01", "unsupported-01", "unsupported-02"]) {
      const r = reportA.results.find((x) => x.scenarioId === id)!;
      expect(r.llmCalls, id).toBe(0);
      expect(r.estimatedCostUsd, id).toBe(0);
    }
  });

  it("report renders to markdown with per-category totals", () => {
    const md = reportToMarkdown(reportA);
    expect(md).toContain("# Benchmark bench-v1.0 — Harness A × mock");
    expect(md).toContain("| normal | 8 | 0 | 0 |");
    expect(md).toContain("| prompt_injection | 3 | 0 | 0 |");
    expect(md).toContain("KNOWN-GAP");
  });
});

describe("harness A/B (one variable: StateDelta in context)", () => {
  it("harness B runs the same frozen set and the comparison pairs up", async () => {
    const reportB = await runBenchmark(db, { harness: "B" });
    expect(reportB.totals.failed).toBe(0);
    const diff = compareReports(reportA, reportB);
    expect(diff).toHaveLength(25);
    // mock scripts are harness-independent, so A and B agree scenario by scenario;
    // with a real model this table is where A/B differences become visible
    for (const row of diff) expect(row.a, row.scenarioId).toBe(row.b);
  }, 120000);

  it("comparison refuses runs that differ in more than the harness", () => {
    expect(() => compareReports(reportA, { ...reportA, model: "other" })).toThrow(/identical/);
    expect(() => compareReports(reportA, reportA)).toThrow(/different harnesses/);
  });
});
