import type { BenchmarkReport } from "./runner.js";

/**
 * Human-readable rendering of a benchmark report. The JSON report itself is
 * the machine-readable artifact; this markdown is for the Owner briefing.
 */
export function reportToMarkdown(report: BenchmarkReport): string {
  const lines: string[] = [
    `# Benchmark ${report.benchmarkVersion} — Harness ${report.harness} × ${report.model}`,
    "",
    `- context: ${report.contextVersion}`,
    `- scenarios: ${report.totals.scenarios} | pass ${report.totals.passed} | fail ${report.totals.failed} | known gaps ${report.totals.knownGaps}`,
    "",
    "| category | passed | failed | known gaps |",
    "| --- | --- | --- | --- |",
  ];
  for (const [cat, b] of Object.entries(report.totals.byCategory)) {
    lines.push(`| ${cat} | ${b.passed} | ${b.failed} | ${b.knownGaps} |`);
  }
  lines.push("", "## Scenarios", "");
  for (const r of report.results) {
    const status = r.passed ? "PASS" : r.knownGap ? "KNOWN-GAP" : "FAIL";
    lines.push(`- **${r.scenarioId}** [${status}] ${r.title} (llm calls: ${r.llmCalls})`);
    for (const v of r.violations) lines.push(`  - ${v}`);
  }
  return lines.join("\n");
}

/**
 * A/B comparison: same benchmark + model, exactly one harness variable apart.
 * Refuses to compare runs that differ in anything else.
 */
export function compareReports(
  a: BenchmarkReport,
  b: BenchmarkReport
): { scenarioId: string; a: boolean; b: boolean }[] {
  if (
    a.benchmarkVersion !== b.benchmarkVersion ||
    a.model !== b.model ||
    a.contextVersion !== b.contextVersion
  ) {
    throw new Error("A/B comparison requires identical benchmark version, model, and context");
  }
  if (a.harness === b.harness) {
    throw new Error("A/B comparison requires two different harnesses");
  }
  const aIds = a.results.map((r) => r.scenarioId);
  const bIds = new Set(b.results.map((r) => r.scenarioId));
  if (aIds.length !== bIds.size || !aIds.every((id) => bIds.has(id))) {
    throw new Error("A/B comparison requires the same scenario set in both runs");
  }
  const bById = new Map(b.results.map((r) => [r.scenarioId, r]));
  return a.results.map((r) => ({
    scenarioId: r.scenarioId,
    a: r.passed,
    b: bById.get(r.scenarioId)!.passed,
  }));
}
