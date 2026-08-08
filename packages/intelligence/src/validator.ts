import type { Queryable } from "@companyos/db";
import type { EvidenceRef, InsightDraft } from "./insight.js";

export interface ValidationOutcome {
  accepted: InsightDraft[];
  rejected: { draft: InsightDraft; reason: string }[];
}

/**
 * Evidence Validator (M3 §5): runs AFTER generation, BEFORE persistence.
 * The LLM is never the authority on evidence validity — this code is.
 * All lookups run tenant-scoped (RLS), so a cross-tenant or fabricated
 * evidence id simply does not resolve, and the claim is rejected.
 */
export async function validateInsights(
  tx: Queryable,
  drafts: InsightDraft[]
): Promise<ValidationOutcome> {
  const accepted: InsightDraft[] = [];
  const rejected: { draft: InsightDraft; reason: string }[] = [];

  for (const draft of drafts) {
    const reason = await validateOne(tx, draft, drafts);
    if (reason === null) accepted.push(draft);
    else rejected.push({ draft, reason });
  }
  return { accepted, rejected };
}

async function validateOne(
  tx: Queryable,
  draft: InsightDraft,
  batch: InsightDraft[]
): Promise<string | null> {
  if (draft.category === "critical" && draft.kind !== "unknown") {
    if (draft.evidenceRefs.length === 0) return "critical insight without evidence";
  }
  switch (draft.kind) {
    case "fact": {
      if (draft.evidenceRefs.length === 0) return "fact without evidence";
      const valid = await resolveEvidence(tx, draft.evidenceRefs);
      if (valid < draft.evidenceRefs.length) return "fact evidence does not resolve in this tenant";
      return null;
    }
    case "inference": {
      if (typeof draft.confidence !== "number" || draft.confidence < 0 || draft.confidence > 1)
        return "inference without confidence in [0,1]";
      if (draft.evidenceRefs.length === 0) return "inference without supporting evidence";
      const valid = await resolveEvidence(tx, draft.evidenceRefs);
      if (valid === 0) return "inference evidence does not resolve in this tenant";
      return null;
    }
    case "recommendation": {
      if (draft.motivatedBy === null || draft.motivatedBy === undefined)
        return "recommendation without motivating fact/inference";
      const target = batch[draft.motivatedBy];
      if (!target || (target.kind !== "fact" && target.kind !== "inference"))
        return "recommendation motivatedBy does not point at a fact/inference";
      return null;
    }
    case "unknown": {
      if (!draft.missing || draft.missing.length === 0)
        return "unknown without a reason for unanswerability";
      return null;
    }
  }
}

async function resolveEvidence(tx: Queryable, refs: EvidenceRef[]): Promise<number> {
  let valid = 0;
  for (const ref of refs) {
    const table = ref.type === "event" ? "events" : "entities";
    const rows = await tx
      .query<{ id: string }>(`select id from ${table} where id = $1::uuid`, [ref.id])
      .catch(() => [] as { id: string }[]); // malformed uuid → does not resolve
    if (rows.length > 0) valid += 1;
  }
  return valid;
}

/** Persist accepted insights only. */
export async function saveInsights(
  tx: Queryable,
  runId: string,
  harnessVersion: string,
  sourceWatermark: Record<string, string>,
  drafts: InsightDraft[]
): Promise<number> {
  let saved = 0;
  for (const d of drafts) {
    await tx.query(
      `insert into insights (tenant_id, run_id, kind, category, statement, confidence,
         evidence, source_watermark, harness_version)
       values (nullif(current_setting('app.tenant_id', true), '')::uuid,
         $1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        runId,
        d.kind,
        d.category,
        d.statement,
        d.confidence ?? null,
        JSON.stringify(d.evidenceRefs),
        JSON.stringify(sourceWatermark),
        harnessVersion,
      ]
    );
    saved += 1;
  }
  return saved;
}
