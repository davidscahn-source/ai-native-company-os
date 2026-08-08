import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SqlClient } from "@companyos/db";
import { createTenant, createTestClient, withTenant } from "@companyos/db";
import { ingestAllFixtures } from "@companyos/connectors/testing";
import type { CompanyStateSnapshot } from "@companyos/state";
import { computeSnapshot } from "@companyos/state";
import { assessAnswerability, classifyQuestion } from "../src/answerability.js";

describe("answerability engine (deterministic, model cannot override)", () => {
  let db: SqlClient;
  let tenant: string;
  let full: CompanyStateSnapshot;
  let stripeOnly: CompanyStateSnapshot;

  beforeAll(async () => {
    db = await createTestClient();
    tenant = await createTenant(db, "answer-test");
    await ingestAllFixtures(db, tenant);
    full = await withTenant(db, tenant, (tx) => computeSnapshot(tx, "2026-12-31T00:00:00Z"));
    stripeOnly = await withTenant(db, tenant, (tx) => computeSnapshot(tx, "2026-01-01T00:00:00Z"));
  });

  afterAll(async () => {
    await db.close();
  });

  it("classifies the five supported question classes (ko + en)", () => {
    expect(classifyQuestion("What changed today?")).toBe("what_changed");
    expect(classifyQuestion("오늘 뭐가 달라졌어?")).toBe("what_changed");
    expect(classifyQuestion("What should I worry about?")).toBe("what_to_worry");
    expect(classifyQuestion("매출에 위험 있어?")).toBe("revenue_risk");
    expect(classifyQuestion("어제 배포 이후 문제는?")).toBe("engineering_activity");
    expect(classifyQuestion("어떤 데이터가 없는 데이터야?")).toBe("missing_data");
  });

  it("full data → ANSWERABLE", () => {
    const v = assessAnswerability("What changed today?", full);
    expect(v.verdict).toBe("ANSWERABLE");
    expect(v.missingSources).toEqual([]);
  });

  it("github missing → engineering NOT_ANSWERABLE, mixed question PARTIALLY", () => {
    expect(assessAnswerability("어제 배포 이후 문제는?", stripeOnly).verdict).toBe(
      "NOT_ANSWERABLE"
    );
    const mixed = assessAnswerability("What changed today?", stripeOnly);
    expect(mixed.verdict).toBe("PARTIALLY_ANSWERABLE");
    expect(mixed.missingSources).toEqual(["github"]);
  });

  it("unsupported questions are NOT_ANSWERABLE, never improvised (M3 §6)", () => {
    const v = assessAnswerability("우리 회사 기업가치가 얼마야?", full);
    expect(v.verdict).toBe("NOT_ANSWERABLE");
    expect(v.questionClass).toBeNull();
  });

  it("stale watermark degrades to PARTIALLY_ANSWERABLE", () => {
    const v = assessAnswerability("매출에 위험 있어?", full, {
      askedAt: "2027-06-01T00:00:00Z",
      staleAfterMs: 24 * 3600 * 1000,
    });
    expect(v.verdict).toBe("PARTIALLY_ANSWERABLE");
    expect(v.staleSources).toContain("stripe");
  });

  it("missing_data questions are always answerable (that IS the answer)", () => {
    expect(assessAnswerability("어떤 데이터가 없는 데이터야?", stripeOnly).verdict).toBe(
      "ANSWERABLE"
    );
  });
});
