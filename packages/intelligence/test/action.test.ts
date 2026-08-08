import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SqlClient } from "@companyos/db";
import { createTenant, createTestClient, withTenant } from "@companyos/db";
import type { InsightDraft } from "../src/insight.js";
import { decideAction, executeAction, proposeActionFromRecommendation } from "../src/action.js";

const REC: InsightDraft = {
  kind: "recommendation",
  category: "revenue",
  statement: "결제 재시도 안내 메일 검토",
  confidence: null,
  evidenceRefs: [],
  motivatedBy: 0,
  missing: null,
};

describe("action flow v1 (Proof 4: recommendation → approval → safe action)", () => {
  let db: SqlClient;
  let tenant: string;

  beforeAll(async () => {
    db = await createTestClient();
    tenant = await createTenant(db, "action-test");
  }, 30000);

  afterAll(async () => {
    await db.close();
  });

  it("full happy path: propose → approve → execute → internal task exists", async () => {
    await withTenant(db, tenant, async (tx) => {
      const actionId = await proposeActionFromRecommendation(tx, "run-a1", REC);
      await decideAction(tx, actionId, "approved", "owner@example.com");
      const taskId = await executeAction(tx, actionId);
      const tasks = await tx.query<{ title: string }>(
        `select title from internal_tasks where id = $1`,
        [taskId]
      );
      expect(tasks[0]!.title).toBe(REC.statement);
      const actions = await tx.query<{ status: string }>(
        `select status from actions where id = $1`,
        [actionId]
      );
      expect(actions[0]!.status).toBe("executed");
    });
  });

  it("execution without approval refuses loudly", async () => {
    await withTenant(db, tenant, async (tx) => {
      const actionId = await proposeActionFromRecommendation(tx, "run-a2", REC);
      await expect(executeAction(tx, actionId)).rejects.toThrow(/approval required/);
    });
  });

  it("rejected actions can never execute", async () => {
    await withTenant(db, tenant, async (tx) => {
      const actionId = await proposeActionFromRecommendation(tx, "run-a3", REC);
      await decideAction(tx, actionId, "rejected", "owner@example.com");
      await expect(executeAction(tx, actionId)).rejects.toThrow(/approval required/);
      // and a decided action cannot be re-decided
      await expect(decideAction(tx, actionId, "approved", "x")).rejects.toThrow(/not in proposed/);
    });
  });

  it("execution is idempotent: replay returns the same task, no duplicates", async () => {
    await withTenant(db, tenant, async (tx) => {
      const actionId = await proposeActionFromRecommendation(tx, "run-a4", REC);
      await decideAction(tx, actionId, "approved", "owner@example.com");
      const t1 = await executeAction(tx, actionId);
      // simulate a retry after the status update: force back to approved
      await tx.query(`update actions set status = 'approved' where id = $1`, [actionId]);
      const t2 = await executeAction(tx, actionId);
      expect(t2).toBe(t1);
      const count = await tx.query(`select id from internal_tasks where created_from_action = $1`, [
        actionId,
      ]);
      expect(count).toHaveLength(1);
    });
  });

  it("only recommendations propose actions", async () => {
    await withTenant(db, tenant, async (tx) => {
      await expect(
        proposeActionFromRecommendation(tx, "run-a5", { ...REC, kind: "fact" })
      ).rejects.toThrow(/only recommendations/);
    });
  });

  it("actions are tenant-isolated like everything else", async () => {
    const tenantB = await createTenant(db, "action-test-b");
    let actionId = "";
    await withTenant(db, tenant, async (tx) => {
      actionId = await proposeActionFromRecommendation(tx, "run-a6", REC);
    });
    await withTenant(db, tenantB, async (tx) => {
      const visible = await tx.query(`select id from actions where id = $1`, [actionId]);
      expect(visible).toHaveLength(0);
      await expect(decideAction(tx, actionId, "approved", "attacker")).rejects.toThrow(
        /not in proposed/
      );
      await expect(executeAction(tx, actionId)).rejects.toThrow(/not found/);
    });
  });
});
