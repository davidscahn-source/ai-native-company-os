import type { Queryable } from "@companyos/db";
import type { InsightDraft } from "./insight.js";

/**
 * Action flow v1 (M3b Proof 4): recommendation → approval → safe action.
 *
 * Hard rules, enforced here and nowhere overridable by the model:
 * - the ONLY executable action type is tasks.create_internal (risk tier 1)
 * - nothing executes without an explicit prior approval record
 * - execution is idempotent (one internal task per action, DB-enforced)
 * - risk tiers above 1 cannot even be proposed in v1
 */

export const ACTION_TASKS_CREATE_INTERNAL = "tasks.create_internal";
export const MAX_EXECUTABLE_RISK_TIER = 1;

export interface ActionRow {
  id: string;
  run_id: string;
  action_type: string;
  risk_tier: number;
  status: "proposed" | "approved" | "rejected" | "executed";
  payload: { title: string; body: string };
  approved_by: string | null;
}

/**
 * Deterministic mapping from an ACCEPTED recommendation insight to a proposed
 * action. The model never proposes actions directly — it proposes insights,
 * and this code decides what (if anything) becomes actionable.
 */
export async function proposeActionFromRecommendation(
  tx: Queryable,
  runId: string,
  insight: InsightDraft
): Promise<string> {
  if (insight.kind !== "recommendation") {
    throw new Error("only recommendations can propose actions");
  }
  const rows = await tx.query<{ id: string }>(
    `insert into actions (tenant_id, run_id, action_type, risk_tier, payload)
     values (nullif(current_setting('app.tenant_id', true), '')::uuid, $1, $2, 1, $3)
     returning id`,
    [
      runId,
      ACTION_TASKS_CREATE_INTERNAL,
      JSON.stringify({ title: insight.statement, body: `category: ${insight.category}` }),
    ]
  );
  return rows[0]!.id;
}

/** Records the human decision. Approval is a precondition of execution, never implied. */
export async function decideAction(
  tx: Queryable,
  actionId: string,
  decision: "approved" | "rejected",
  decidedBy: string
): Promise<void> {
  const rows = await tx.query<{ id: string }>(
    `update actions set status = $2, approved_by = $3, decided_at = now()
     where id = $1 and status = 'proposed' returning id`,
    [actionId, decision, decidedBy]
  );
  if (rows.length === 0) {
    throw new Error("action is not in proposed state (or not visible in this tenant)");
  }
}

/**
 * Executes an approved risk-1 action. Anything else refuses loudly.
 * Returns the created internal task id.
 */
export async function executeAction(tx: Queryable, actionId: string): Promise<string> {
  const rows = await tx.query<ActionRow>(`select * from actions where id = $1`, [actionId]);
  const action = rows[0];
  if (!action) throw new Error("action not found in this tenant");
  if (action.status !== "approved") {
    throw new Error(`refusing to execute action in status '${action.status}' — approval required`);
  }
  if (action.action_type !== ACTION_TASKS_CREATE_INTERNAL) {
    throw new Error(`unsupported action type '${action.action_type}'`);
  }
  if (action.risk_tier > MAX_EXECUTABLE_RISK_TIER) {
    throw new Error(`risk tier ${action.risk_tier} exceeds executable maximum`);
  }

  const task = await tx.query<{ id: string }>(
    `insert into internal_tasks (tenant_id, title, body, created_from_action)
     values (nullif(current_setting('app.tenant_id', true), '')::uuid, $1, $2, $3)
     on conflict (tenant_id, created_from_action) do nothing
     returning id`,
    [action.payload.title, action.payload.body, actionId]
  );
  await tx.query(`update actions set status = 'executed', executed_at = now() where id = $1`, [
    actionId,
  ]);
  if (task.length > 0) return task[0]!.id;
  // idempotent replay: the task already exists for this action
  const existing = await tx.query<{ id: string }>(
    `select id from internal_tasks where created_from_action = $1`,
    [actionId]
  );
  return existing[0]!.id;
}
