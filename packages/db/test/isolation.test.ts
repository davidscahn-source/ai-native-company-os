import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SqlClient } from "../src/client.js";
import { createTestClient, withTenant } from "../src/client.js";
import { createTenant, ingestRawEvent, upsertEntity } from "../src/repo.js";

/**
 * Cross-tenant penetration suite.
 * These tests attack the isolation model on purpose; every test asserts the attack FAILS.
 */
describe("tenant isolation (penetration)", () => {
  let db: SqlClient;
  let tenantA: string;
  let tenantB: string;

  beforeAll(async () => {
    db = await createTestClient();
    tenantA = await createTenant(db, "tenant-a");
    tenantB = await createTenant(db, "tenant-b");
    await withTenant(db, tenantA, async (tx) => {
      await ingestRawEvent(tx, { provider: "stripe", dedupKey: "evt_a1", payload: { n: 1 } });
      await upsertEntity(tx, {
        provider: "stripe",
        sourceType: "customer",
        sourceId: "cus_A",
        entityType: "customer",
        displayName: "Alice Corp",
        canonical: { email: "alice@a.com" },
      });
    });
  });

  afterAll(async () => {
    await db.close();
  });

  it("tenant B cannot read tenant A's raw events", async () => {
    const rows = await withTenant(db, tenantB, (tx) => tx.query("select * from raw_events"));
    expect(rows).toHaveLength(0);
  });

  it("tenant B cannot read tenant A's entities or source links", async () => {
    const entities = await withTenant(db, tenantB, (tx) => tx.query("select * from entities"));
    const links = await withTenant(db, tenantB, (tx) => tx.query("select * from source_links"));
    expect(entities).toHaveLength(0);
    expect(links).toHaveLength(0);
  });

  it("a query with no tenant context sees nothing", async () => {
    const rows = await db.query("select * from entities");
    expect(rows).toHaveLength(0);
  });

  it("tenant B cannot forge an insert into tenant A (explicit tenant_id is rejected)", async () => {
    await expect(
      withTenant(db, tenantB, (tx) =>
        tx.query(
          `insert into entities (id, tenant_id, type) values (gen_random_uuid(), $1, 'customer')`,
          [tenantA]
        )
      )
    ).rejects.toThrow(/row-level security/i);
  });

  it("tenant B cannot update or delete tenant A's rows (0 rows affected)", async () => {
    await withTenant(db, tenantB, async (tx) => {
      await tx.query(`update entities set display_name = 'pwned'`);
      await tx.query(`delete from raw_events`);
    });
    const after = await withTenant(db, tenantA, (tx) =>
      tx.query<{ display_name: string }>("select display_name from entities")
    );
    expect(after[0]?.display_name).toBe("Alice Corp");
    const raws = await withTenant(db, tenantA, (tx) => tx.query("select * from raw_events"));
    expect(raws).toHaveLength(1);
  });

  it("tenant B cannot see tenant A in the tenants table", async () => {
    const rows = await withTenant(db, tenantB, (tx) =>
      tx.query<{ id: string }>("select id from tenants")
    );
    expect(rows.map((r) => r.id)).toEqual([tenantB]);
  });

  it("same-source ids in different tenants stay separate entities", async () => {
    await withTenant(db, tenantB, (tx) =>
      upsertEntity(tx, {
        provider: "stripe",
        sourceType: "customer",
        sourceId: "cus_A",
        entityType: "customer",
        canonical: { email: "alice@a.com" },
      })
    );
    const aEntities = await withTenant(db, tenantA, (tx) => tx.query("select id from entities"));
    const bEntities = await withTenant(db, tenantB, (tx) => tx.query("select id from entities"));
    expect(aEntities).toHaveLength(1);
    expect(bEntities).toHaveLength(1);
    expect(aEntities[0]).not.toEqual(bEntities[0]);
  });
});
