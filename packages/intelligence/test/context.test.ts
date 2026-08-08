import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SqlClient } from "@companyos/db";
import { createTenant, createTestClient, withTenant } from "@companyos/db";
import { ingestAllFixtures } from "@companyos/connectors/testing";
import { computeSnapshot } from "@companyos/state";
import { buildContext, CONTEXT_VERSION, renderContext } from "../src/context.js";

const CUT_ALL = "2026-12-31T00:00:00Z";
// Wide enough to reach back from CUT_ALL to the 2025 stripe fixtures.
const WIDE_WINDOW = 3 * 365 * 24 * 3600 * 1000;

describe("context builder (deterministic, auditable)", () => {
  let db: SqlClient;
  let tenant: string;

  beforeAll(async () => {
    db = await createTestClient();
    tenant = await createTenant(db, "ctx-test");
    await ingestAllFixtures(db, tenant);
  });

  afterAll(async () => {
    await db.close();
  });

  it("selects evidence with per-item why_selected and is deterministic", async () => {
    await withTenant(db, tenant, async (tx) => {
      const snap = await computeSnapshot(tx, CUT_ALL);
      const a = await buildContext(tx, snap, { windowMs: WIDE_WINDOW });
      const b = await buildContext(tx, snap, { windowMs: WIDE_WINDOW });
      expect(a).toEqual(b);
      expect(a.contextVersion).toBe(CONTEXT_VERSION);
      expect(a.evidence.length).toBeGreaterThan(0);
      for (const e of a.evidence) {
        expect(e.whySelected.length).toBeGreaterThan(0);
        expect(e.ref.id).toMatch(/^[0-9a-f-]{36}$/);
      }
    });
  });

  it("question class filters sources and records exclusions with reasons", async () => {
    await withTenant(db, tenant, async (tx) => {
      const snap = await computeSnapshot(tx, CUT_ALL);
      const pkg = await buildContext(tx, snap, {
        questionClass: "revenue_risk",
        windowMs: WIDE_WINDOW,
      });
      const eventEvidence = pkg.evidence.filter((e) => e.ref.type === "event");
      expect(eventEvidence.length).toBeGreaterThan(0);
      for (const e of eventEvidence) {
        expect(e.summary).toContain("[stripe]");
        expect(e.whySelected).toContain("revenue_risk");
      }
      const githubExclusions = pkg.excluded.filter((x) =>
        x.reason.startsWith("source_not_relevant")
      );
      expect(githubExclusions.length).toBeGreaterThan(0);
      expect(githubExclusions[0]!.summary).toContain("[github]");
    });
  });

  it("event budget is enforced and overflow lands in excluded, not dropped silently", async () => {
    await withTenant(db, tenant, async (tx) => {
      const snap = await computeSnapshot(tx, CUT_ALL);
      const pkg = await buildContext(tx, snap, { windowMs: WIDE_WINDOW, maxEvents: 2 });
      expect(pkg.evidence.filter((e) => e.ref.type === "event")).toHaveLength(2);
      const overBudget = pkg.excluded.filter((x) => x.reason === "over_event_budget:2");
      expect(overBudget.length).toBeGreaterThan(0);
    });
  });

  it("time window excludes old events with the window reason", async () => {
    await withTenant(db, tenant, async (tx) => {
      const snap = await computeSnapshot(tx, CUT_ALL);
      // 30d window from 2026-12-31 excludes both 2025 stripe and 2026-08 github events
      const pkg = await buildContext(tx, snap, {});
      const windowed = pkg.excluded.filter((x) => x.reason.startsWith("outside_window"));
      expect(windowed.length).toBeGreaterThan(0);
      expect(pkg.evidence.filter((e) => e.ref.type === "event")).toHaveLength(0);
    });
  });

  it("entities enter only via selected events; render is stable and cites refs", async () => {
    await withTenant(db, tenant, async (tx) => {
      const snap = await computeSnapshot(tx, CUT_ALL);
      const pkg = await buildContext(tx, snap, { windowMs: WIDE_WINDOW });
      const entityEvidence = pkg.evidence.filter((e) => e.ref.type === "entity");
      expect(entityEvidence.length).toBeGreaterThan(0);
      for (const e of entityEvidence) {
        expect(e.whySelected).toBe("referenced by a selected event");
      }
      const text = renderContext(pkg);
      expect(text).toContain(`[context ${CONTEXT_VERSION}]`);
      expect(text).toContain("company_state:");
      for (const e of pkg.evidence) {
        expect(text).toContain(`[${e.ref.type}:${e.ref.id}]`);
      }
      // excluded items are summarized as withheld, never enumerated to the model
      expect(text).not.toContain("outside_window");
    });
  });

  it("cross-tenant: another tenant's context contains nothing", async () => {
    const tenantB = await createTenant(db, "ctx-test-b");
    await withTenant(db, tenantB, async (tx) => {
      const snap = await computeSnapshot(tx, CUT_ALL);
      const pkg = await buildContext(tx, snap, { windowMs: WIDE_WINDOW });
      expect(pkg.evidence).toHaveLength(0);
      expect(pkg.excluded).toHaveLength(0);
    });
  });
});
