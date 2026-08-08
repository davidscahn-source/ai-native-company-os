import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SqlClient } from "@companyos/db";
import { createTenant, createTestClient, withTenant } from "@companyos/db";
import { ingestAllFixtures } from "@companyos/connectors/testing";
import { computeDelta } from "../src/delta.js";
import { computeSnapshot, loadSnapshot, metricEvidence, saveSnapshot } from "../src/projector.js";

// Fixture time facts: stripe events occur 2025-08-07 (unix 17546004xx),
// github events occur 2026-08-07. Cutoffs are always explicit inputs.
const CUT_ALL = "2026-12-31T00:00:00Z";
const CUT_STRIPE_EARLY = "2025-08-07T20:54:00Z"; // after customer.created only
const CUT_BEFORE_GITHUB = "2026-01-01T00:00:00Z";

describe("company state projector (deterministic, LLM-free)", () => {
  let db: SqlClient;
  let tenant: string;

  beforeAll(async () => {
    db = await createTestClient();
    tenant = await createTenant(db, "state-test");
    await ingestAllFixtures(db, tenant);
  });

  afterAll(async () => {
    await db.close();
  });

  it("computes the full-state snapshot from canonical data", async () => {
    const snap = await withTenant(db, tenant, (tx) => computeSnapshot(tx, CUT_ALL));
    expect(snap.state).toEqual({
      customers: 1,
      repositories: 1,
      open_bugs: 1,
      bugs_detected: 1,
      failed_payments: 1,
      failed_payment_value: 42000,
      payments_completed: 1,
      subscriptions_cancelled: 1,
      prs_merged: 1,
    });
    expect(snap.completeness).toEqual({ stripe: true, github: true });
    expect(snap.sourceWatermark.github).toBe("2026-08-07T14:00:00.000Z");
  });

  it("cutoff is respected: before github data, github metrics and completeness vanish", async () => {
    const snap = await withTenant(db, tenant, (tx) => computeSnapshot(tx, CUT_BEFORE_GITHUB));
    expect(snap.state.bugs_detected).toBe(0);
    expect(snap.state.prs_merged).toBe(0);
    // entity metrics are cutoff-scoped too: the repo/bug entities are first
    // observed in github payloads dated after this cutoff
    expect(snap.state.repositories).toBe(0);
    expect(snap.state.open_bugs).toBe(0);
    expect(snap.state.customers).toBe(1);
    expect(snap.completeness.github).toBeUndefined();
    expect(snap.completeness.stripe).toBe(true);
  });

  it("every metric traces back to concrete rows (evidence count === metric value)", async () => {
    await withTenant(db, tenant, async (tx) => {
      const snap = await computeSnapshot(tx, CUT_ALL);
      for (const metric of [
        "customers",
        "repositories",
        "open_bugs",
        "bugs_detected",
        "failed_payments",
        "payments_completed",
        "subscriptions_cancelled",
        "prs_merged",
      ] as const) {
        const evidence = await metricEvidence(tx, metric, CUT_ALL);
        expect(evidence.length, metric).toBe(snap.state[metric]);
      }
      const valueEvidence = await metricEvidence(tx, "failed_payment_value", CUT_ALL);
      expect(valueEvidence.length).toBe(1); // the payment.failed event carrying 42000
    });
  });

  it("delta between cutoffs reports exactly what changed", async () => {
    await withTenant(db, tenant, async (tx) => {
      const early = await computeSnapshot(tx, CUT_STRIPE_EARLY);
      const all = await computeSnapshot(tx, CUT_ALL);
      const delta = computeDelta(early, all);
      const byMetric = Object.fromEntries(delta.changes.map((c) => [c.metric, c.change]));
      expect(byMetric).toMatchObject({
        failed_payments: 1,
        failed_payment_value: 42000,
        payments_completed: 1,
        subscriptions_cancelled: 1,
        bugs_detected: 1,
        prs_merged: 1,
        // entity metrics move with the cutoff: repo + bug first observed later
        repositories: 1,
        open_bugs: 1,
      });
      // the customer was already observed before the early cutoff
      expect(byMetric.customers).toBeUndefined();
    });
  });

  it("is deterministic and replay-safe: re-ingesting everything changes nothing", async () => {
    const before = await withTenant(db, tenant, (tx) => computeSnapshot(tx, CUT_ALL));
    await ingestAllFixtures(db, tenant); // full replay
    const after = await withTenant(db, tenant, (tx) => computeSnapshot(tx, CUT_ALL));
    expect(after).toEqual(before);
  });

  it("persists idempotently and loads back byte-identical", async () => {
    await withTenant(db, tenant, async (tx) => {
      const snap = await computeSnapshot(tx, CUT_ALL);
      await saveSnapshot(tx, snap);
      await saveSnapshot(tx, snap); // second save is a no-op
      const rows = await tx.query(`select id from company_state_snapshots`);
      expect(rows).toHaveLength(1);
      expect(await loadSnapshot(tx, CUT_ALL)).toEqual(snap);
    });
  });

  it("state is tenant-scoped like everything else", async () => {
    const tenantB = await createTenant(db, "state-test-b");
    const snap = await withTenant(db, tenantB, (tx) => computeSnapshot(tx, CUT_ALL));
    expect(snap.state.customers).toBe(0);
    expect(snap.completeness).toEqual({});
    expect(await withTenant(db, tenantB, (tx) => loadSnapshot(tx, CUT_ALL))).toBeNull();
  });
});
