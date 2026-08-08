import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SqlClient } from "@companyos/db";
import { createTenant, createTestClient, withTenant } from "@companyos/db";
import { ingestAllFixtures } from "@companyos/connectors/testing";
import { computeSnapshot } from "@companyos/state";
import type { LlmMessage, RoutingTable } from "@companyos/llm";
import { LlmGateway, mockAdapter } from "@companyos/llm";
import { askCompany } from "../src/ask.js";
import { generateFounderBrief, sectionFor } from "../src/brief.js";

const CUT_ALL = "2026-12-31T00:00:00Z";
const WIDE = { windowMs: 3 * 365 * 24 * 3600 * 1000 };

const ROUTING: RoutingTable = (() => {
  const entry = {
    primary: { provider: "mock", model: "mock-m", inputPricePerMTok: 1, outputPricePerMTok: 5 },
  };
  return { FAST: entry, BALANCED: entry, REASONING: entry };
})();

/** Scripted model: emits facts citing the FIRST event id it finds in the context. */
function scriptedGateway(script: (messages: LlmMessage[]) => string): LlmGateway {
  return new LlmGateway(ROUTING, new Map([["mock", mockAdapter(script)]]), async () => {});
}

function firstRef(messages: LlmMessage[], type: "event" | "entity"): string {
  const ctx = messages.find((m) => m.role === "user")?.content ?? "";
  const m = ctx.match(new RegExp(`\\[${type}:([0-9a-f-]{36})\\]`));
  if (!m) throw new Error(`no ${type} ref visible in context`);
  return m[1]!;
}

let db: SqlClient;
let tenant: string;

beforeAll(async () => {
  db = await createTestClient();
  tenant = await createTenant(db, "founder-loop-test");
  await ingestAllFixtures(db, tenant);
}, 30000);

afterAll(async () => {
  await db.close();
});

describe("founder brief v1 (mock model, hard truth boundary)", () => {
  it("assembles 5 sections from validated insights and persists them", async () => {
    await withTenant(db, tenant, async (tx) => {
      const snap = await computeSnapshot(tx, CUT_ALL);
      const gw = scriptedGateway((messages) =>
        JSON.stringify([
          {
            kind: "fact",
            category: "revenue",
            statement: "결제 실패 1건",
            evidenceRefs: [{ type: "event", id: firstRef(messages, "event") }],
          },
          {
            kind: "unknown",
            category: "unknown_signal",
            statement: "지원 채널 미연결",
            missing: "Slack 미연결",
          },
        ])
      );
      const brief = await generateFounderBrief(tx, gw, tenant, snap, {
        runId: "brief-run-1",
        context: WIDE,
      });
      expect(brief.sections.map((s) => s.key)).toEqual([
        "what_changed",
        "what_to_worry",
        "revenue",
        "engineering",
        "unknowns",
      ]);
      expect(brief.sections.find((s) => s.key === "revenue")!.insights).toHaveLength(1);
      expect(brief.sections.find((s) => s.key === "unknowns")!.insights).toHaveLength(1);
      expect(brief.rejected).toHaveLength(0);
      const rows = await tx.query(`select id from insights where run_id = 'brief-run-1'`);
      expect(rows).toHaveLength(2);
    });
  });

  it("hallucinated evidence is rejected and lands in brief.rejected, not sections", async () => {
    await withTenant(db, tenant, async (tx) => {
      const snap = await computeSnapshot(tx, CUT_ALL);
      const gw = scriptedGateway(() =>
        JSON.stringify([
          {
            kind: "fact",
            category: "critical",
            statement: "프로덕션 전면 장애",
            evidenceRefs: [{ type: "event", id: "00000000-0000-4000-8000-000000000000" }],
          },
        ])
      );
      const brief = await generateFounderBrief(tx, gw, tenant, snap, {
        runId: "brief-run-2",
        context: WIDE,
      });
      expect(brief.sections.every((s) => s.insights.length === 0)).toBe(true);
      expect(brief.rejected).toHaveLength(1);
      expect(brief.rejected[0]!.reason).toMatch(/does not resolve/);
      const rows = await tx.query(`select id from insights where run_id = 'brief-run-2'`);
      expect(rows).toHaveLength(0);
    });
  });

  it("sectionFor is a total, fixed-priority mapping", () => {
    const base = { statement: "x", evidenceRefs: [], confidence: null, motivatedBy: null };
    expect(sectionFor({ ...base, kind: "unknown", category: "critical", missing: "m" })).toBe(
      "unknowns"
    );
    expect(sectionFor({ ...base, kind: "fact", category: "critical" })).toBe("what_to_worry");
    expect(sectionFor({ ...base, kind: "inference", category: "revenue" })).toBe("revenue");
    expect(sectionFor({ ...base, kind: "fact", category: "engineering" })).toBe("engineering");
    expect(sectionFor({ ...base, kind: "fact", category: "customer" })).toBe("what_changed");
  });
});

describe("ask v1 (verdict is computed before the model and cannot be overridden)", () => {
  it("NOT_ANSWERABLE refuses deterministically with zero model calls", async () => {
    await withTenant(db, tenant, async (tx) => {
      const snap = await computeSnapshot(tx, CUT_ALL);
      const gw = scriptedGateway(() => {
        throw new Error("model must not be consulted");
      });
      const out = await askCompany(tx, gw, tenant, "오늘 점심 뭐 먹지?", snap, {
        runId: "ask-0",
        context: WIDE,
      });
      expect(out.verdict.verdict).toBe("NOT_ANSWERABLE");
      expect(out.modelConsulted).toBe(false);
      expect(out.insights).toHaveLength(0);
      expect(gw.spent().calls).toBe(0);
    });
  });

  it("answerable revenue question consults the model with a stripe-scoped context", async () => {
    await withTenant(db, tenant, async (tx) => {
      const snap = await computeSnapshot(tx, CUT_ALL);
      let seenContext = "";
      const gw = scriptedGateway((messages) => {
        seenContext = messages.find((m) => m.role === "user")?.content ?? "";
        return JSON.stringify([
          {
            kind: "fact",
            category: "revenue",
            statement: "결제 실패 발생",
            evidenceRefs: [{ type: "event", id: firstRef(messages, "event") }],
          },
        ]);
      });
      const out = await askCompany(tx, gw, tenant, "매출 리스크 있어?", snap, {
        runId: "ask-1",
        persist: false,
        context: WIDE,
      });
      expect(out.verdict.verdict).toBe("ANSWERABLE");
      expect(out.verdict.questionClass).toBe("revenue_risk");
      expect(out.modelConsulted).toBe(true);
      expect(out.insights).toHaveLength(1);
      expect(seenContext).toContain("[stripe]");
      expect(seenContext).not.toContain("[github]");
    });
  });

  it("stale source downgrades to PARTIALLY and injects the hard constraint", async () => {
    await withTenant(db, tenant, async (tx) => {
      const snap = await computeSnapshot(tx, CUT_ALL);
      let prompt = "";
      const gw = scriptedGateway((messages) => {
        prompt = messages.find((m) => m.role === "user")?.content ?? "";
        return JSON.stringify([
          {
            kind: "unknown",
            category: "unknown_signal",
            statement: "stripe 데이터가 오래됨",
            missing: "stale stripe",
          },
        ]);
      });
      const out = await askCompany(tx, gw, tenant, "매출 리스크 있어?", snap, {
        runId: "ask-2",
        persist: false,
        context: WIDE,
        askedAt: "2027-06-01T00:00:00Z",
        staleAfterMs: 24 * 3600 * 1000,
      });
      expect(out.verdict.verdict).toBe("PARTIALLY_ANSWERABLE");
      expect(out.verdict.staleSources).toContain("stripe");
      expect(prompt).toContain("HARD CONSTRAINT");
      expect(out.insights[0]!.kind).toBe("unknown");
    });
  });
});
