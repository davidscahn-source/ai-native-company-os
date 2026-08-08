import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SqlClient } from "@companyos/db";
import { createTenant, createTestClient, withTenant } from "@companyos/db";
import { ingestAllFixtures } from "@companyos/connectors";
import type { InsightDraft } from "../src/insight.js";
import { parseInsightDrafts } from "../src/insight.js";
import { saveInsights, validateInsights } from "../src/validator.js";

describe("evidence validator (the LLM is never the authority)", () => {
  let db: SqlClient;
  let tenantA: string;
  let tenantB: string;
  let realEventId: string;
  let realEntityId: string;

  beforeAll(async () => {
    db = await createTestClient();
    tenantA = await createTenant(db, "val-a");
    tenantB = await createTenant(db, "val-b");
    await ingestAllFixtures(db, tenantA);
    await withTenant(db, tenantA, async (tx) => {
      realEventId = (
        await tx.query<{ id: string }>(`select id from events where event_type = 'payment.failed'`)
      )[0]!.id;
      realEntityId = (
        await tx.query<{ id: string }>(`select id from entities where type = 'customer'`)
      )[0]!.id;
    });
  });

  afterAll(async () => {
    await db.close();
  });

  const fact = (refs: InsightDraft["evidenceRefs"]): InsightDraft => ({
    kind: "fact",
    category: "revenue",
    statement: "결제 실패 1건 발생",
    confidence: null,
    evidenceRefs: refs,
    motivatedBy: null,
    missing: null,
  });

  it("accepts a fact whose evidence resolves in-tenant", async () => {
    const out = await withTenant(db, tenantA, (tx) =>
      validateInsights(tx, [fact([{ type: "event", id: realEventId }])])
    );
    expect(out.accepted).toHaveLength(1);
  });

  it("rejects facts with missing, fabricated, or malformed evidence", async () => {
    const out = await withTenant(db, tenantA, (tx) =>
      validateInsights(tx, [
        fact([]),
        fact([{ type: "event", id: "00000000-0000-4000-8000-000000000000" }]),
        fact([{ type: "event", id: "not-a-uuid" }]),
      ])
    );
    expect(out.accepted).toHaveLength(0);
    expect(out.rejected.map((r) => r.reason)).toEqual([
      "fact without evidence",
      "fact evidence does not resolve in this tenant",
      "fact evidence does not resolve in this tenant",
    ]);
  });

  it("rejects cross-tenant evidence references (M3 benchmark case)", async () => {
    const out = await withTenant(db, tenantB, (tx) =>
      validateInsights(tx, [fact([{ type: "event", id: realEventId }])])
    );
    expect(out.accepted).toHaveLength(0);
    expect(out.rejected[0]!.reason).toMatch(/does not resolve/);
  });

  it("inference requires confidence in [0,1] AND resolving evidence", async () => {
    const base: InsightDraft = {
      kind: "inference",
      category: "customer",
      statement: "고객 이탈 위험",
      confidence: 0.7,
      evidenceRefs: [{ type: "entity", id: realEntityId }],
      motivatedBy: null,
      missing: null,
    };
    const out = await withTenant(db, tenantA, (tx) =>
      validateInsights(tx, [
        base,
        { ...base, confidence: null },
        { ...base, confidence: 1.5 },
        { ...base, evidenceRefs: [] },
      ])
    );
    expect(out.accepted).toHaveLength(1);
    expect(out.rejected).toHaveLength(3);
  });

  it("recommendation must point at a fact/inference in the batch", async () => {
    const batch: InsightDraft[] = [
      fact([{ type: "event", id: realEventId }]),
      {
        kind: "recommendation",
        category: "revenue",
        statement: "고객에게 결제 재시도 안내",
        confidence: null,
        evidenceRefs: [],
        motivatedBy: 0,
        missing: null,
      },
      {
        kind: "recommendation",
        category: "revenue",
        statement: "허공을 가리키는 추천",
        confidence: null,
        evidenceRefs: [],
        motivatedBy: 7,
        missing: null,
      },
    ];
    const out = await withTenant(db, tenantA, (tx) => validateInsights(tx, batch));
    expect(out.accepted).toHaveLength(2);
    expect(out.rejected[0]!.reason).toMatch(/does not point/);
  });

  it("unknown requires a stated reason; critical without evidence dies whole", async () => {
    const out = await withTenant(db, tenantA, (tx) =>
      validateInsights(tx, [
        {
          kind: "unknown",
          category: "unknown_signal",
          statement: "지원 티켓 동향은 알 수 없음",
          confidence: null,
          evidenceRefs: [],
          motivatedBy: null,
          missing: "Slack/Linear 미연결",
        },
        {
          kind: "unknown",
          category: "unknown_signal",
          statement: "이유 없는 모른다",
          confidence: null,
          evidenceRefs: [],
          motivatedBy: null,
          missing: null,
        },
        {
          kind: "inference",
          category: "critical",
          statement: "프로덕션 장애 의심",
          confidence: 0.9,
          evidenceRefs: [],
          motivatedBy: null,
          missing: null,
        },
      ])
    );
    expect(out.accepted).toHaveLength(1);
    expect(out.rejected.map((r) => r.reason)).toEqual([
      "unknown without a reason for unanswerability",
      "critical insight without evidence",
    ]);
  });

  it("persists only accepted insights, with watermark + harness version", async () => {
    await withTenant(db, tenantA, async (tx) => {
      const out = await validateInsights(tx, [
        fact([{ type: "event", id: realEventId }]),
        fact([]),
      ]);
      const saved = await saveInsights(
        tx,
        "run-x",
        "harness-v1",
        { stripe: "2025-08-07" },
        out.accepted
      );
      expect(saved).toBe(1);
      const rows = await tx.query<{ kind: string; harness_version: string }>(
        `select kind, harness_version from insights where run_id = 'run-x'`
      );
      expect(rows).toEqual([{ kind: "fact", harness_version: "harness-v1" }]);
    });
  });
});

describe("insight contract parsing", () => {
  it("parses a valid batch, tolerating surrounding prose", () => {
    const raw =
      'Here is my analysis:\n[{"kind":"fact","category":"revenue","statement":"x","evidenceRefs":[{"type":"event","id":"a"}]}]\nDone.';
    const drafts = parseInsightDrafts(raw);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.kind).toBe("fact");
  });

  it("rejects non-JSON, non-array, invalid kind/category, missing statement", () => {
    expect(() => parseInsightDrafts("no json here")).toThrow(/not valid JSON/);
    expect(() => parseInsightDrafts('{"kind":"fact"}')).toThrow();
    expect(() =>
      parseInsightDrafts('[{"kind":"opinion","category":"revenue","statement":"x"}]')
    ).toThrow(/invalid kind/);
    expect(() =>
      parseInsightDrafts('[{"kind":"fact","category":"vibes","statement":"x"}]')
    ).toThrow(/invalid category/);
    expect(() => parseInsightDrafts('[{"kind":"fact","category":"revenue"}]')).toThrow(/statement/);
  });
});
