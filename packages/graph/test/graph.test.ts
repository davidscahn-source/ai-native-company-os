import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Queryable, SqlClient } from "@companyos/db";
import {
  addRelationship,
  createTenant,
  createTestClient,
  upsertEntity,
  withTenant,
} from "@companyos/db";
import { ingestAllFixtures } from "@companyos/connectors/testing";
import { impactedCustomers, neighbors, pathBetween, timeline } from "../src/queries.js";

describe("graph queries (deterministic, provenance-backed)", () => {
  let db: SqlClient;
  let tenant: string;
  let customerId: string;
  let invoiceId: string;
  let subscriptionId: string;
  let repoId: string;

  const entityIdBySource = async (tx: Queryable, sourceType: string, sourceId: string) => {
    const rows = await tx.query<{ entity_id: string }>(
      `select entity_id from source_links where source_type = $1 and source_id = $2`,
      [sourceType, sourceId]
    );
    return rows[0]!.entity_id;
  };

  beforeAll(async () => {
    db = await createTestClient();
    tenant = await createTenant(db, "graph-test");
    await ingestAllFixtures(db, tenant);
    await withTenant(db, tenant, async (tx) => {
      customerId = await entityIdBySource(tx, "customer", "cus_A1");
      invoiceId = await entityIdBySource(tx, "invoice", "in_100");
      subscriptionId = await entityIdBySource(tx, "subscription", "sub_9");
      repoId = await entityIdBySource(tx, "repository", "555");
    });
  });

  afterAll(async () => {
    await db.close();
  });

  it("every pipeline-created relationship carries provenance (rule + event ids)", async () => {
    const rels = await withTenant(db, tenant, (tx) =>
      tx.query<{ evidence: { rule?: string; eventIds?: string[] } }>(
        `select evidence from relationships`
      )
    );
    expect(rels.length).toBeGreaterThanOrEqual(6);
    for (const r of rels) {
      expect(r.evidence.rule).toBe("provider_fk");
      expect(r.evidence.eventIds!.length).toBeGreaterThan(0);
    }
  });

  it("neighbors depth 1: customer ↔ invoices + subscription", async () => {
    const rows = await withTenant(db, tenant, (tx) => neighbors(tx, customerId, { depth: 1 }));
    const types = rows.map((r) => r.type).sort();
    expect(types).toEqual(["invoice", "invoice", "subscription"]);
  });

  it("timeline returns the entity's events newest-first", async () => {
    const rows = await withTenant(db, tenant, (tx) => timeline(tx, customerId));
    expect(rows.length).toBe(4); // created, updated, payment.failed, payment.completed
    const times = rows.map((r) => new Date(r.occurred_at).getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it("pathBetween: invoice → customer → subscription (depth 2, edge types intact)", async () => {
    const path = await withTenant(db, tenant, (tx) => pathBetween(tx, invoiceId, subscriptionId));
    expect(path).not.toBeNull();
    expect(path!.nodes).toEqual([invoiceId, customerId, subscriptionId]);
    // in_100 is the payment_failed invoice — its FK edge is billed_to, not paid.
    expect(path!.edgeTypes).toEqual(["billed_to", "owns"]);
  });

  it("pathBetween returns null across disconnected providers", async () => {
    const path = await withTenant(db, tenant, (tx) => pathBetween(tx, invoiceId, repoId));
    expect(path).toBeNull();
  });

  it("impactedCustomers walks incident → deployment → customer", async () => {
    await withTenant(db, tenant, async (tx) => {
      const incidentId = await upsertEntity(tx, {
        provider: "sentry",
        sourceType: "incident",
        sourceId: "inc_1",
        entityType: "incident",
        displayName: "API error spike",
      });
      const deploymentId = await upsertEntity(tx, {
        provider: "github",
        sourceType: "deployment",
        sourceId: "dep_1",
        entityType: "deployment",
      });
      await addRelationship(tx, {
        fromEntityId: incidentId,
        toEntityId: deploymentId,
        type: "related_to",
        evidence: { rule: "time_window_test" },
      });
      await addRelationship(tx, {
        fromEntityId: deploymentId,
        toEntityId: customerId,
        type: "affects",
        evidence: { rule: "time_window_test" },
      });
      const impacted = await impactedCustomers(tx, incidentId);
      expect(impacted).toHaveLength(1);
      expect(impacted[0]).toMatchObject({ id: customerId, distance: 2 });
    });
  });

  it("depth guards: hard caps and invalid values throw", async () => {
    await withTenant(db, tenant, async (tx) => {
      await expect(neighbors(tx, customerId, { depth: 3 })).rejects.toThrow(/hard cap/);
      await expect(pathBetween(tx, invoiceId, subscriptionId, { maxDepth: 5 })).rejects.toThrow(
        /hard cap/
      );
      await expect(neighbors(tx, customerId, { depth: 0 })).rejects.toThrow(/positive integer/);
    });
  });

  it("cross-tenant: another tenant cannot traverse to or link this tenant's entities", async () => {
    const tenantB = await createTenant(db, "graph-test-b");
    await withTenant(db, tenantB, async (tx) => {
      const own = await upsertEntity(tx, {
        provider: "stripe",
        sourceType: "customer",
        sourceId: "cus_B",
        entityType: "customer",
      });
      // traversal from a leaked uuid finds nothing
      expect(await neighbors(tx, customerId, { depth: 2 })).toHaveLength(0);
      expect(await pathBetween(tx, own, customerId)).toBeNull();
      // forging an edge to tenant A's entity is rejected outright
      await expect(
        addRelationship(tx, {
          fromEntityId: own,
          toEntityId: customerId,
          type: "affects",
          evidence: { rule: "attack" },
        })
      ).rejects.toThrow(/visible to the current tenant/);
    });
  });

  it("records a latency baseline (PGlite — relative baseline, not production numbers)", async () => {
    const timings: Record<string, number> = {};
    await withTenant(db, tenant, async (tx) => {
      const bench = async (name: string, fn: () => Promise<unknown>) => {
        const runs = 20;
        const start = performance.now();
        for (let i = 0; i < runs; i++) await fn();
        timings[name] = Number(((performance.now() - start) / runs).toFixed(2));
      };
      await bench("neighbors_d2", () => neighbors(tx, customerId, { depth: 2 }));
      await bench("timeline", () => timeline(tx, customerId));
      await bench("pathBetween_d4", () => pathBetween(tx, invoiceId, subscriptionId));
      await bench("impactedCustomers", () => impactedCustomers(tx, customerId));
    });
    console.warn(`[latency-baseline ms/query] ${JSON.stringify(timings)}`);
    for (const [name, ms] of Object.entries(timings)) {
      expect(ms, `${name} exceeded relative baseline`).toBeLessThan(250);
    }
  });
});
