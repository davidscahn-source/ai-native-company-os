import { Rng } from "./rng.js";
import { assertSeedUsageAllowed, seedClassOf } from "./seeds.js";
import type {
  GeneratedCompany,
  GeneratedPayload,
  GroundTruthNonRelationship,
  GroundTruthRelationship,
  PlantedNoise,
  PlantedSignal,
} from "./ground-truth.js";

/**
 * Deterministic synthetic company generator (M3c Stage A).
 *
 * Emits PROVIDER-SHAPED payloads, not canonical rows, so the generated
 * company flows through exactly the same connectors → graph → state path as
 * a real one. A lab that bypassed ingestion would be testing a system we
 * do not ship.
 *
 * Same seed ⇒ byte-identical company. Nothing here reads the clock.
 */

export type Scale = "small" | "standard";

interface Volumes {
  customers: number;
  bugs: number;
  prs: number;
  noiseEvents: number;
}

/** `small` keeps CI fast; `standard` is the size the lab is judged at. */
const VOLUMES: Record<Scale, Volumes> = {
  small: { customers: 40, bugs: 12, prs: 15, noiseEvents: 6 },
  standard: { customers: 400, bugs: 80, prs: 120, noiseEvents: 40 },
};

const PLANS = [
  { name: "starter", amount: 4900 },
  { name: "pro", amount: 19900 },
  { name: "enterprise", amount: 129900 },
] as const;

const DAY_MS = 24 * 3600 * 1000;

/** How far before the window customers may already exist (backfilled history). */
const BACKFILL_DAYS = 300;

export interface GenerateOptions {
  seed: number;
  /** Why this company is being generated — gates holdout seeds. */
  purpose: "development" | "tuning" | "final-evaluation";
  /** Explicit end of the simulated window. Never defaults to now(). */
  endAt?: string;
  days?: number;
  scale?: Scale;
}

export function generateCompany(opts: GenerateOptions): GeneratedCompany {
  const { seed, purpose } = opts;
  assertSeedUsageAllowed(seed, purpose);

  const endAt = opts.endAt ?? "2026-06-30T00:00:00Z";
  const days = opts.days ?? 90;
  const scale = opts.scale ?? "small";
  const vol = VOLUMES[scale];

  const endMs = new Date(endAt).getTime();
  if (Number.isNaN(endMs)) throw new Error(`invalid endAt: ${endAt}`);
  const startMs = endMs - days * DAY_MS;
  /** Day 0 = start of the window; fractional days allowed. */
  const at = (day: number): string => new Date(startMs + day * DAY_MS).toISOString();
  const unix = (day: number): number => Math.floor((startMs + day * DAY_MS) / 1000);

  const root = new Rng(seed);
  const payloads: GeneratedPayload[] = [];
  const signals: PlantedSignal[] = [];
  const noise: PlantedNoise[] = [];
  const relationships: GroundTruthRelationship[] = [];
  const nonRelationships: GroundTruthNonRelationship[] = [];

  const repoId = 500000 + seed;
  const repoName = `acme-${seed}/platform`;

  // ── background: customers and their billing history ──────────────────────
  const rc = root.fork("customers");
  interface Customer {
    id: string;
    plan: (typeof PLANS)[number];
    createdDay: number;
  }
  const customers: Customer[] = [];

  for (let i = 0; i < vol.customers; i++) {
    const id = `cus_${seed}_${i}`;
    // Enterprise customers are rare, which is what makes one churning matter.
    const plan = rc.chance(0.08) ? PLANS[2] : rc.chance(0.35) ? PLANS[1] : PLANS[0];
    // A company with 400 customers did not acquire all of them in the last 90
    // days. Most pre-date the window (backfill) and therefore carry a full
    // billing history inside it — that background density is what makes the
    // planted churn signal a real detection test instead of a freebie.
    const createdDay = rc.chance(0.75) ? -rc.next() * BACKFILL_DAYS : rc.next() * (days - 5);
    customers.push({ id, plan, createdDay });
    payloads.push({
      provider: "stripe",
      dedupKey: `evt_${seed}_cust_${i}`,
      occurredAt: at(createdDay),
      payload: {
        id: `evt_${seed}_cust_${i}`,
        type: "customer.created",
        created: unix(createdDay),
        data: {
          object: {
            id,
            object: "customer",
            email: `founder${i}@customer${i}.example`,
            name: `Customer ${i}`,
          },
        },
      },
    });
  }

  // Monthly invoices per customer; a small share fail, which is normal noise.
  const rp = root.fork("payments");
  let invoiceNo = 0;
  for (const c of customers) {
    for (let cycleDay = c.createdDay + 30; cycleDay < days - 1; cycleDay += 30) {
      // Only bill inside the observable window; earlier cycles are history we
      // do not need to replay.
      if (cycleDay < 0) continue;
      const failed = rp.chance(0.06);
      const invId = `in_${seed}_${invoiceNo++}`;
      payloads.push({
        provider: "stripe",
        dedupKey: `evt_${invId}`,
        occurredAt: at(cycleDay),
        payload: {
          id: `evt_${invId}`,
          type: failed ? "invoice.payment_failed" : "invoice.paid",
          created: unix(cycleDay),
          data: {
            object: {
              id: invId,
              object: "invoice",
              customer: c.id,
              amount_due: c.plan.amount,
              currency: "usd",
            },
          },
        },
      });
      relationships.push({
        fromKey: `invoice:${invId}`,
        toKey: `customer:${c.id}`,
        type: "billing",
      });
    }
  }

  // ── background: engineering activity ─────────────────────────────────────
  const rb = root.fork("bugs");
  let issueNo = 0;
  for (let i = 0; i < vol.bugs; i++) {
    const openedDay = rb.next() * (days - 10);
    const id = 900000 + seed * 100 + issueNo;
    const number = 1000 + issueNo;
    issueNo++;
    payloads.push({
      provider: "github",
      dedupKey: `gh_${seed}_issue_open_${i}`,
      occurredAt: at(openedDay),
      payload: issuePayload(
        "opened",
        id,
        number,
        `Bug: checkout error ${i}`,
        ["bug"],
        at(openedDay),
        repoId,
        repoName
      ),
    });
    // Most bugs get fixed within a normal window — that is what makes a
    // 21-day-old open bug stand out rather than blend in.
    if (rb.chance(0.8)) {
      const closedDay = openedDay + rb.next() * 6 + 0.5;
      if (closedDay < days) {
        payloads.push({
          provider: "github",
          dedupKey: `gh_${seed}_issue_close_${i}`,
          occurredAt: at(closedDay),
          payload: issuePayload(
            "closed",
            id,
            number,
            `Bug: checkout error ${i}`,
            ["bug"],
            at(closedDay),
            repoId,
            repoName
          ),
        });
      }
    }
  }

  const rpr = root.fork("prs");
  for (let i = 0; i < vol.prs; i++) {
    const openedDay = rpr.next() * (days - 3);
    const id = 700000 + seed * 100 + i;
    payloads.push({
      provider: "github",
      dedupKey: `gh_${seed}_pr_open_${i}`,
      occurredAt: at(openedDay),
      payload: prPayload(
        "opened",
        id,
        2000 + i,
        `Change ${i}`,
        false,
        at(openedDay),
        repoId,
        repoName
      ),
    });
    const mergedDay = openedDay + rpr.next() * 2 + 0.2;
    if (mergedDay < days) {
      payloads.push({
        provider: "github",
        dedupKey: `gh_${seed}_pr_merge_${i}`,
        occurredAt: at(mergedDay),
        payload: prPayload(
          "closed",
          id,
          2000 + i,
          `Change ${i}`,
          true,
          at(mergedDay),
          repoId,
          repoName
        ),
      });
    }
  }

  // ── SIGNAL A: high-value customer, repeated failures, then silence ───────
  const rs = root.fork("signal-a");
  const enterprise = customers.filter(
    (c) => c.plan.name === "enterprise" && c.createdDay < days - 40
  );
  const victim = enterprise.length > 0 ? rs.pick(enterprise) : customers[0]!;
  const failA = days - 21;
  const failB = days - 13;
  for (const [n, day] of [failA, failB].entries()) {
    const invId = `in_${seed}_churn_${n}`;
    payloads.push({
      provider: "stripe",
      dedupKey: `evt_${invId}`,
      occurredAt: at(day),
      payload: {
        id: `evt_${invId}`,
        type: "invoice.payment_failed",
        created: unix(day),
        data: {
          object: {
            id: invId,
            object: "invoice",
            customer: victim.id,
            amount_due: victim.plan.amount,
            currency: "usd",
          },
        },
      },
    });
    relationships.push({
      fromKey: `invoice:${invId}`,
      toKey: `customer:${victim.id}`,
      type: "billing",
    });
  }
  signals.push({
    id: "signal-a-churn",
    kind: "churn_risk",
    priority: 1,
    truth:
      `High-value customer ${victim.id} (${victim.plan.name}, ${victim.plan.amount / 100} USD/cycle) ` +
      `failed payment twice (day ${failA} and ${failB}) and has had no successful payment since.`,
    evidenceKeys: [
      `customer:${victim.id}`,
      `invoice:in_${seed}_churn_0`,
      `invoice:in_${seed}_churn_1`,
    ],
    observableFrom: at(failB),
  });

  // ── SIGNAL B: a bug that never got fixed ─────────────────────────────────
  const staleDay = days - 21;
  const staleId = 950000 + seed;
  payloads.push({
    provider: "github",
    dedupKey: `gh_${seed}_stale_bug`,
    occurredAt: at(staleDay),
    payload: issuePayload(
      "opened",
      staleId,
      4242,
      "Bug: payment webhook intermittently dropped",
      ["bug"],
      at(staleDay),
      repoId,
      repoName
    ),
  });
  signals.push({
    id: "signal-b-stale-bug",
    kind: "stale_bug",
    priority: 2,
    truth: `Bug #4242 has been open ${21} days with no close event, far beyond the typical resolution window.`,
    evidenceKeys: [`issue:${staleId}`],
    observableFrom: at(staleDay + 7),
  });

  // ── NOISE: things that look connected but are not ────────────────────────
  const rn = root.fork("noise");
  for (let i = 0; i < vol.noiseEvents; i++) {
    const day = 5 + rn.next() * (days - 15);
    const decoyCustomer = rn.pick(customers.filter((c) => c.id !== victim.id));
    const invId = `in_${seed}_noise_${i}`;
    // A failed payment...
    payloads.push({
      provider: "stripe",
      dedupKey: `evt_${invId}`,
      occurredAt: at(day),
      payload: {
        id: `evt_${invId}`,
        type: "invoice.payment_failed",
        created: unix(day),
        data: {
          object: {
            id: invId,
            object: "invoice",
            customer: decoyCustomer.id,
            amount_due: decoyCustomer.plan.amount,
            currency: "usd",
          },
        },
      },
    });
    // ...and, minutes later, a completely unrelated bug in another area.
    const decoyIssue = 960000 + seed * 100 + i;
    const bugDay = day + 0.01; // ~15 minutes later
    payloads.push({
      provider: "github",
      dedupKey: `gh_${seed}_noise_issue_${i}`,
      occurredAt: at(bugDay),
      payload: issuePayload(
        "opened",
        decoyIssue,
        5000 + i,
        `Bug: docs sidebar overlaps on mobile ${i}`,
        ["bug"],
        at(bugDay),
        repoId,
        repoName
      ),
    });
    payloads.push({
      provider: "github",
      dedupKey: `gh_${seed}_noise_issue_close_${i}`,
      occurredAt: at(bugDay + 1),
      payload: issuePayload(
        "closed",
        decoyIssue,
        5000 + i,
        `Bug: docs sidebar overlaps on mobile ${i}`,
        ["bug"],
        at(bugDay + 1),
        repoId,
        repoName
      ),
    });
    noise.push({
      id: `noise-${i}`,
      description:
        `Payment failure for ${decoyCustomer.id} and an unrelated docs-layout bug were generated ` +
        `~15 minutes apart by independent streams. There is no causal link.`,
      unrelatedKeys: [`customer:${decoyCustomer.id}`, `issue:${decoyIssue}`],
    });
    nonRelationships.push({
      aKey: `invoice:${invId}`,
      bKey: `issue:${decoyIssue}`,
      temptation: "occurred ~15 minutes apart",
    });
  }

  // Chronological order: ingestion should replay a timeline, not a bag.
  payloads.sort((a, b) =>
    a.occurredAt === b.occurredAt
      ? a.dedupKey.localeCompare(b.dedupKey)
      : a.occurredAt.localeCompare(b.occurredAt)
  );

  return {
    seed,
    seedClass: seedClassOf(seed),
    endAt,
    days,
    payloads,
    groundTruth: { signals, noise, relationships, nonRelationships },
    counts: {
      payloads: payloads.length,
      customers: customers.length,
      signals: signals.length,
      noise: noise.length,
      nonRelationships: nonRelationships.length,
    },
  };
}

function issuePayload(
  action: "opened" | "closed",
  id: number,
  number: number,
  title: string,
  labels: string[],
  isoAt: string,
  repoId: number,
  repoName: string
): unknown {
  return {
    action,
    issue: {
      id,
      number,
      title,
      labels: labels.map((name) => ({ name })),
      created_at: isoAt,
      updated_at: isoAt,
    },
    repository: { id: repoId, full_name: repoName },
  };
}

function prPayload(
  action: "opened" | "closed",
  id: number,
  number: number,
  title: string,
  merged: boolean,
  isoAt: string,
  repoId: number,
  repoName: string
): unknown {
  return {
    action,
    pull_request: {
      id,
      number,
      title,
      merged,
      created_at: isoAt,
      updated_at: isoAt,
    },
    repository: { id: repoId, full_name: repoName },
  };
}
