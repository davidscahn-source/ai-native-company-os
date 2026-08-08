import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SqlClient } from "@companyos/db";
import { createTenant, createTestClient, withTenant } from "@companyos/db";
import { ingestPayload } from "../src/core/pipeline.js";
import { normalizeGithub } from "../src/github/normalizer.js";
import { normalizeStripe } from "../src/stripe/normalizer.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (provider: string, name: string): unknown =>
  JSON.parse(readFileSync(join(here, "..", "src", provider, "fixtures", name), "utf8"));

const STRIPE_FIXTURES = [
  "customer_created.json",
  "customer_updated.json",
  "invoice_payment_failed.json",
  "invoice_paid.json",
  "subscription_deleted.json",
  "unhandled_type.json",
];
const GITHUB_FIXTURES = [
  "issue_opened_bug.json",
  "issue_opened_plain.json",
  "pr_opened.json",
  "pr_merged.json",
];

describe("ingestion pipeline (end-to-end, deterministic — zero LLM)", () => {
  let db: SqlClient;
  let tenant: string;

  const ingestAll = async () => {
    for (const f of STRIPE_FIXTURES) {
      await ingestPayload(
        db,
        tenant,
        "stripe",
        `stripe:${f}`,
        fixture("stripe", f),
        normalizeStripe
      );
    }
    for (const f of GITHUB_FIXTURES) {
      await ingestPayload(
        db,
        tenant,
        "github",
        `github:${f}`,
        fixture("github", f),
        normalizeGithub
      );
    }
  };

  const counts = async () => {
    return withTenant(db, tenant, async (tx) => {
      const one = async (sql: string) => Number((await tx.query<{ n: string }>(sql))[0]!.n);
      return {
        raw: await one("select count(*) as n from raw_events"),
        events: await one("select count(*) as n from events"),
        entities: await one("select count(*) as n from entities"),
        links: await one("select count(*) as n from source_links"),
      };
    });
  };

  beforeAll(async () => {
    db = await createTestClient();
    tenant = await createTenant(db, "pipeline-test");
    await ingestAll();
  });

  afterAll(async () => {
    await db.close();
  });

  it("stores every payload verbatim in raw_events", async () => {
    expect((await counts()).raw).toBe(10);
  });

  it("produces canonical events for handled payloads only", async () => {
    const c = await counts();
    expect(c.events).toBe(9); // 10 fixtures - 1 deliberately unhandled
  });

  it("resolves the same stripe customer across customer/invoice/subscription payloads", async () => {
    const customers = await withTenant(db, tenant, (tx) =>
      tx.query<{ id: string; canonical: { email?: string } }>(
        `select id, canonical from entities where type = 'customer'`
      )
    );
    expect(customers).toHaveLength(1); // cus_A1 referenced by 5 payloads → one entity
    expect(customers[0]!.canonical.email).toBe("alice@example.com");
  });

  it("links payment.failed to the resolved customer entity (graph evidence path)", async () => {
    const rows = await withTenant(db, tenant, (tx) =>
      tx.query<{ entity_id: string | null }>(
        `select entity_id from events where event_type = 'payment.failed'`
      )
    );
    expect(rows[0]!.entity_id).not.toBeNull();
  });

  it("keeps one repository entity across all github payloads", async () => {
    const repos = await withTenant(db, tenant, (tx) =>
      tx.query(`select id from entities where type = 'repository'`)
    );
    expect(repos).toHaveLength(1);
  });

  it("is idempotent: full replay of all payloads changes nothing", async () => {
    const before = await counts();
    await ingestAll();
    expect(await counts()).toEqual(before);
  });

  it("records failed normalization without losing the raw payload", async () => {
    await ingestPayload(db, tenant, "stripe", "stripe:malformed", { nope: 1 }, normalizeStripe);
    const failed = await withTenant(db, tenant, (tx) =>
      tx.query<{ processing_status: string }>(
        `select processing_status from raw_events where dedup_key = 'stripe:malformed'`
      )
    );
    expect(failed[0]!.processing_status).toBe("failed");
  });
});
