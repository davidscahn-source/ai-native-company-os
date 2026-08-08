import type { Queryable } from "@companyos/db";
import type { InsightDraft } from "@companyos/intelligence";

/**
 * Deterministic baseline detector — no LLM, pure rules (M3c).
 *
 * This exists to establish the FLOOR the intelligence layer has to beat. Two
 * hand-written SQL rules cost nothing and can be run today, whereas real
 * harness numbers wait on Owner credentials (#4).
 *
 * It is also the honest control for the product thesis: if a language model
 * with full context cannot beat two rules a junior engineer would write in an
 * afternoon, the intelligence layer is not earning its cost, and we would want
 * to know that before building more of it.
 *
 * Deliberately NOT general: it knows the shapes we planted. It is a yardstick,
 * not a product feature — which is exactly why it must never be wired into the
 * brief.
 */

export const BASELINE_VERSION = "deterministic-baseline-v1.0";

export interface BaselineOptions {
  capturedUntil: string;
  /** A bug open at least this long is worth surfacing. */
  staleBugDays?: number;
  /** How many consecutive failures with no later success count as churn risk. */
  churnFailureThreshold?: number;
}

/**
 * Returns insights in priority order: money first, then engineering. The
 * ordering is a deliberate editorial choice, and Priority Accuracy scores it
 * like any other harness.
 */
export async function detectDeterministically(
  tx: Queryable,
  opts: BaselineOptions
): Promise<InsightDraft[]> {
  const staleDays = opts.staleBugDays ?? 14;
  const threshold = opts.churnFailureThreshold ?? 2;
  const out: InsightDraft[] = [];

  // Rule 1 — customers whose recent payments failed and never recovered.
  const churn = await tx.query<{ entity_id: string; fails: string; last_fail: string }>(
    `with failures as (
       select entity_id, count(*) as fails, max(occurred_at) as last_fail
       from events
       where event_type = 'payment.failed' and occurred_at <= $1 and entity_id is not null
       group by entity_id
     )
     select f.entity_id, f.fails, f.last_fail
     from failures f
     where f.fails >= $2
       and not exists (
         select 1 from events p
         where p.entity_id = f.entity_id
           and p.event_type = 'payment.completed'
           and p.occurred_at > f.last_fail
           and p.occurred_at <= $1
       )
     order by f.fails desc, f.last_fail desc, f.entity_id`,
    [opts.capturedUntil, threshold]
  );
  for (const row of churn) {
    const events = await tx.query<{ id: string }>(
      `select id from events
       where entity_id = $1 and event_type = 'payment.failed' and occurred_at <= $2
       order by occurred_at, id`,
      [row.entity_id, opts.capturedUntil]
    );
    out.push({
      kind: "fact",
      category: "revenue",
      statement: `Customer has ${row.fails} failed payments with no successful payment since ${row.last_fail}.`,
      confidence: null,
      evidenceRefs: [
        { type: "entity", id: row.entity_id },
        ...events.map((e) => ({ type: "event" as const, id: e.id })),
      ],
      motivatedBy: null,
      missing: null,
    });
  }

  // Rule 2 — bugs open longer than the threshold, oldest first.
  const stale = await tx.query<{ id: string; opened_at: string }>(
    `select b.id, min(ev.occurred_at) as opened_at
     from entities b
     join events ev on ev.entity_id = b.id and ev.occurred_at <= $1
     where b.type = 'bug'
       and b.first_observed_at <= $1
       and not exists (
         select 1 from events c
         where c.entity_id = b.id and c.event_type = 'issue.closed' and c.occurred_at <= $1
       )
     group by b.id
     having min(ev.occurred_at) <= ($1::timestamptz - make_interval(days => $2::int))
     order by min(ev.occurred_at), b.id`,
    [opts.capturedUntil, staleDays]
  );
  for (const row of stale) {
    out.push({
      kind: "fact",
      category: "engineering",
      statement: `Bug has been open since ${row.opened_at} with no close event.`,
      confidence: null,
      evidenceRefs: [{ type: "entity", id: row.id }],
      motivatedBy: null,
      missing: null,
    });
  }

  return out;
}
