import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SqlClient } from "@companyos/db";
import { createTenant, createTestClient, withTenant } from "@companyos/db";
import { computeSnapshot } from "@companyos/state";
import { generateCompany } from "../src/generator.js";
import { ingestCompany } from "../src/ingest.js";
import { Rng } from "../src/rng.js";
import { assertSeedUsageAllowed, HoldoutSeedMisuse, seedClassOf, seedsOf } from "../src/seeds.js";

const DEV_SEED = 1000;

describe("seeded rng", () => {
  it("is fully deterministic and independent of call site", () => {
    const a = new Rng(42);
    const b = new Rng(42);
    const seqA = Array.from({ length: 20 }, () => a.next());
    const seqB = Array.from({ length: 20 }, () => b.next());
    expect(seqA).toEqual(seqB);
    expect(new Set(seqA).size).toBeGreaterThan(15); // not a constant stream
  });

  it("forked streams are stable and differ per label", () => {
    const seqOf = (label: string): number[] => {
      const r = new Rng(7).fork(label);
      return Array.from({ length: 5 }, () => r.next());
    };
    expect(seqOf("bugs")).toEqual(seqOf("bugs"));
    expect(seqOf("bugs")).not.toEqual(seqOf("payments"));
  });

  it("rejects a non-integer seed rather than silently coercing", () => {
    expect(() => new Rng(1.5)).toThrow(/integer/);
  });
});

describe("seed classes (overfit protection enforced in code)", () => {
  it("classifies the declared ranges and refuses unknown seeds", () => {
    expect(seedClassOf(1000)).toBe("dev");
    expect(seedClassOf(2000)).toBe("validation");
    expect(seedClassOf(9000)).toBe("holdout");
    expect(() => seedClassOf(5)).toThrow(/no declared class/);
  });

  it("holdout seeds throw unless the caller is the final evaluation", () => {
    expect(() => assertSeedUsageAllowed(9000, "development")).toThrow(HoldoutSeedMisuse);
    expect(() => assertSeedUsageAllowed(9000, "tuning")).toThrow(HoldoutSeedMisuse);
    expect(() => assertSeedUsageAllowed(9000, "final-evaluation")).not.toThrow();
  });

  it("dev seeds cannot be used for final evaluation (the harness saw them)", () => {
    expect(() => assertSeedUsageAllowed(1000, "final-evaluation")).toThrow(HoldoutSeedMisuse);
  });

  it("the generator itself refuses a holdout seed used for development", () => {
    expect(() => generateCompany({ seed: 9001, purpose: "development" })).toThrow(
      HoldoutSeedMisuse
    );
  });

  it("hands out non-overlapping seed lists", () => {
    const dev = seedsOf("dev", 5);
    const holdout = seedsOf("holdout", 5);
    expect(dev.some((s) => holdout.includes(s))).toBe(false);
    expect(() => seedsOf("holdout", 500)).toThrow(/only/);
  });
});

describe("company generator (deterministic)", () => {
  it("same seed produces a byte-identical company", () => {
    const a = generateCompany({ seed: DEV_SEED, purpose: "development" });
    const b = generateCompany({ seed: DEV_SEED, purpose: "development" });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("different seeds produce different companies", () => {
    const a = generateCompany({ seed: 1000, purpose: "development" });
    const b = generateCompany({ seed: 1001, purpose: "development" });
    expect(JSON.stringify(a.payloads)).not.toBe(JSON.stringify(b.payloads));
  });

  it("never consults the clock: the window is a pure function of endAt/days", () => {
    const c = generateCompany({
      seed: DEV_SEED,
      purpose: "development",
      endAt: "2026-06-30T00:00:00Z",
      days: 90,
    });
    const last = c.payloads[c.payloads.length - 1]!.occurredAt;
    // Nothing may occur after the declared end; backfilled customer history
    // legitimately predates the 90-day window.
    expect(new Date(last).getTime()).toBeLessThanOrEqual(
      new Date("2026-06-30T00:00:00Z").getTime()
    );
    const inWindow = c.payloads.filter(
      (p) => new Date(p.occurredAt).getTime() >= new Date("2026-04-01T00:00:00Z").getTime()
    );
    expect(inWindow.length).toBeGreaterThan(c.payloads.length / 2);
  });

  it("emits payloads in chronological order", () => {
    const c = generateCompany({ seed: DEV_SEED, purpose: "development" });
    for (let i = 1; i < c.payloads.length; i++) {
      expect(c.payloads[i]!.occurredAt >= c.payloads[i - 1]!.occurredAt).toBe(true);
    }
  });

  it("dedup keys are unique — a duplicate would silently drop generated history", () => {
    const c = generateCompany({ seed: DEV_SEED, purpose: "development", scale: "standard" });
    const keys = c.payloads.map((p) => p.dedupKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("ground truth (signals AND noise)", () => {
  const company = generateCompany({ seed: DEV_SEED, purpose: "development" });

  it("plants the agreed signals with priorities and evidence keys", () => {
    const kinds = company.groundTruth.signals.map((s) => s.kind).sort();
    expect(kinds).toEqual(["churn_risk", "stale_bug"]);
    for (const s of company.groundTruth.signals) {
      expect(s.evidenceKeys.length).toBeGreaterThan(0);
      expect(s.priority).toBeGreaterThan(0);
      expect(s.truth.length).toBeGreaterThan(10);
    }
    // priorities are unique — Priority Accuracy needs a total order
    const priorities = company.groundTruth.signals.map((s) => s.priority);
    expect(new Set(priorities).size).toBe(priorities.length);
  });

  it("plants decoy noise — without it, calling every correlation a problem scores perfectly", () => {
    expect(company.groundTruth.noise.length).toBeGreaterThan(0);
    expect(company.groundTruth.nonRelationships.length).toBeGreaterThan(0);
    for (const nr of company.groundTruth.nonRelationships) {
      expect(nr.temptation).toContain("apart");
    }
  });

  it("noise never overlaps the planted signals' evidence", () => {
    const signalKeys = new Set(company.groundTruth.signals.flatMap((s) => s.evidenceKeys));
    for (const n of company.groundTruth.noise) {
      for (const key of n.unrelatedKeys) {
        expect(signalKeys.has(key), `${key} is both signal evidence and noise`).toBe(false);
      }
    }
  });

  it("declared relationships and non-relationships are disjoint", () => {
    const rel = new Set(
      company.groundTruth.relationships.map((r) => [r.fromKey, r.toKey].sort().join("|"))
    );
    for (const nr of company.groundTruth.nonRelationships) {
      expect(rel.has([nr.aKey, nr.bKey].sort().join("|"))).toBe(false);
    }
  });
});

describe("ingestion through the real pipeline", () => {
  let db: SqlClient;

  beforeAll(async () => {
    db = await createTestClient();
  }, 60000);

  afterAll(async () => {
    await db.close();
  });

  it("same seed ⇒ byte-identical canonical company state", async () => {
    const company = generateCompany({ seed: DEV_SEED, purpose: "development" });
    const snapshotFor = async (name: string): Promise<unknown> => {
      const tenant = await createTenant(db, name);
      const res = await ingestCompany(db, tenant, company);
      expect(res.failed).toBe(0);
      const snap = await withTenant(db, tenant, (tx) => computeSnapshot(tx, company.endAt));
      // ids are per-tenant uuids; the canonical STATE is what must match
      return { state: snap.state, completeness: snap.completeness };
    };
    const a = await snapshotFor("gen-a");
    const b = await snapshotFor("gen-b");
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("the planted signals are actually observable in canonical data", async () => {
    const company = generateCompany({ seed: DEV_SEED, purpose: "development" });
    const tenant = await createTenant(db, "gen-observable");
    await ingestCompany(db, tenant, company);

    await withTenant(db, tenant, async (tx) => {
      const snap = await computeSnapshot(tx, company.endAt);
      // Signal A: the churn customer's two failures are in the events table
      const churn = company.groundTruth.signals.find((s) => s.kind === "churn_risk")!;
      const customerKey = churn.evidenceKeys.find((k) => k.startsWith("customer:"))!;
      const sourceId = customerKey.split(":")[1]!;
      const rows = await tx.query<{ n: string }>(
        `select count(*) as n from events e
         join source_links sl on sl.entity_id = e.entity_id
         where e.event_type = 'payment.failed' and sl.source_id = $1`,
        [sourceId]
      );
      expect(Number(rows[0]!.n)).toBeGreaterThanOrEqual(2);

      // Signal B: the stale bug is still open at the cutoff
      expect(snap.state.open_bugs).toBeGreaterThan(0);
      const stale = await tx.query<{ n: string }>(
        `select count(*) as n from source_links where source_type = 'issue' and source_id = $1`,
        [
          company.groundTruth.signals
            .find((s) => s.kind === "stale_bug")!
            .evidenceKeys[0]!.split(":")[1]!,
        ]
      );
      expect(Number(stale[0]!.n)).toBe(1);
    });
  });
});
