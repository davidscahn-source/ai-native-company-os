import type { Queryable } from "@companyos/db";

/**
 * Company State projector (v0.7 design, implemented deterministically in M2).
 * The LLM never computes state — it only ever explains state computed here.
 *
 * `capturedUntil` is always an explicit input: the same events + the same
 * cutoff must produce byte-identical state, no matter when it runs.
 */

export interface CompanyState {
  customers: number;
  repositories: number;
  open_bugs: number;
  bugs_detected: number;
  failed_payments: number;
  failed_payment_value: number;
  payments_completed: number;
  subscriptions_cancelled: number;
  prs_merged: number;
}

export interface CompanyStateSnapshot {
  capturedUntil: string;
  state: CompanyState;
  /** newest occurred_at per source — feeds answerability ("how fresh is this?") */
  sourceWatermark: Record<string, string>;
  /** which sources have any data at all — feeds answerability ("can we know this?") */
  completeness: Record<string, boolean>;
}

/** metric → the event type its value (and evidence) is derived from */
const EVENT_METRICS: Record<string, string> = {
  bugs_detected: "bug.detected",
  failed_payments: "payment.failed",
  failed_payment_value: "payment.failed",
  payments_completed: "payment.completed",
  subscriptions_cancelled: "subscription.cancelled",
  prs_merged: "pr.merged",
};

export async function computeSnapshot(
  tx: Queryable,
  capturedUntil: string
): Promise<CompanyStateSnapshot> {
  const one = async (sql: string, params: unknown[]): Promise<number> =>
    Number((await tx.query<{ n: string }>(sql, params))[0]!.n);

  const eventCount = (type: string): Promise<number> =>
    one(`select count(*) as n from events where event_type = $1 and occurred_at <= $2`, [
      type,
      capturedUntil,
    ]);

  // Entity metrics are cutoff-scoped via first_observed_at (payload-derived,
  // deterministic). NULL first_observed_at is excluded: an entity whose first
  // observation is unknown cannot be proven to exist before any cutoff.
  const state: CompanyState = {
    customers: await one(
      `select count(*) as n from entities where type = 'customer' and first_observed_at <= $1`,
      [capturedUntil]
    ),
    repositories: await one(
      `select count(*) as n from entities where type = 'repository' and first_observed_at <= $1`,
      [capturedUntil]
    ),
    open_bugs: await one(
      `select count(*) as n from entities b
       where b.type = 'bug' and b.first_observed_at <= $1 and not exists (
         select 1 from events ev
         where ev.entity_id = b.id and ev.event_type = 'issue.closed' and ev.occurred_at <= $1
       )`,
      [capturedUntil]
    ),
    bugs_detected: await eventCount(EVENT_METRICS.bugs_detected!),
    failed_payments: await eventCount(EVENT_METRICS.failed_payments!),
    failed_payment_value: await one(
      `select coalesce(sum((payload->>'amount_due')::numeric), 0) as n
       from events where event_type = 'payment.failed' and occurred_at <= $1`,
      [capturedUntil]
    ),
    payments_completed: await eventCount(EVENT_METRICS.payments_completed!),
    subscriptions_cancelled: await eventCount(EVENT_METRICS.subscriptions_cancelled!),
    prs_merged: await eventCount(EVENT_METRICS.prs_merged!),
  };

  const watermarks = await tx.query<{ source: string; max_at: string }>(
    `select source, max(occurred_at) as max_at from events
     where occurred_at <= $1 group by source order by source`,
    [capturedUntil]
  );
  const sourceWatermark: Record<string, string> = {};
  const completeness: Record<string, boolean> = {};
  for (const w of watermarks) {
    sourceWatermark[w.source] = new Date(w.max_at).toISOString();
    completeness[w.source] = true;
  }

  return { capturedUntil, state, sourceWatermark, completeness };
}

/**
 * Traceability (M2 priority 9): every metric maps back to concrete rows.
 * Returns the ids that make up a metric's value.
 */
export async function metricEvidence(
  tx: Queryable,
  metric: keyof CompanyState,
  capturedUntil: string
): Promise<string[]> {
  const eventType = EVENT_METRICS[metric];
  if (eventType) {
    const rows = await tx.query<{ id: string }>(
      `select id from events where event_type = $1 and occurred_at <= $2 order by id`,
      [eventType, capturedUntil]
    );
    return rows.map((r) => r.id);
  }
  if (metric === "customers" || metric === "repositories") {
    const rows = await tx.query<{ id: string }>(
      `select id from entities where type = $1 and first_observed_at <= $2 order by id`,
      [metric === "customers" ? "customer" : "repository", capturedUntil]
    );
    return rows.map((r) => r.id);
  }
  if (metric === "open_bugs") {
    const rows = await tx.query<{ id: string }>(
      `select b.id from entities b
       where b.type = 'bug' and b.first_observed_at <= $1 and not exists (
         select 1 from events ev
         where ev.entity_id = b.id and ev.event_type = 'issue.closed' and ev.occurred_at <= $1
       ) order by b.id`,
      [capturedUntil]
    );
    return rows.map((r) => r.id);
  }
  throw new Error(`no evidence rule for metric ${String(metric)}`);
}

/** Persist a snapshot. Idempotent per (tenant, captured_until). */
export async function saveSnapshot(tx: Queryable, snap: CompanyStateSnapshot): Promise<void> {
  await tx.query(
    `insert into company_state_snapshots (tenant_id, captured_until, state, source_watermark, completeness)
     values (nullif(current_setting('app.tenant_id', true), '')::uuid, $1, $2, $3, $4)
     on conflict (tenant_id, captured_until) do nothing`,
    [
      snap.capturedUntil,
      JSON.stringify(snap.state),
      JSON.stringify(snap.sourceWatermark),
      JSON.stringify(snap.completeness),
    ]
  );
}

export async function loadSnapshot(
  tx: Queryable,
  capturedUntil: string
): Promise<CompanyStateSnapshot | null> {
  const rows = await tx.query<{
    state: CompanyState;
    source_watermark: Record<string, string>;
    completeness: Record<string, boolean>;
  }>(
    `select state, source_watermark, completeness
     from company_state_snapshots where captured_until = $1`,
    [capturedUntil]
  );
  const row = rows[0];
  return row
    ? {
        capturedUntil,
        state: row.state,
        sourceWatermark: row.source_watermark,
        completeness: row.completeness,
      }
    : null;
}
