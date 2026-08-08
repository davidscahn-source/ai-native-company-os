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
  // Recommendations may only be motivated by drafts that themselves survived
  // validation — a recommendation whose motivating claim was rejected as a
  // hallucination must die with it. Two passes (claims, then recs), but the
  // outcome preserves original batch order.
  const results: (InsightDraft | string)[] = new Array(drafts.length);
  const acceptedIndex = new Set<number>();

  for (const [i, draft] of drafts.entries()) {
    if (draft.kind === "recommendation") continue;
    const result = await validateClaim(tx, draft);
    results[i] = result;
    if (typeof result !== "string") acceptedIndex.add(i);
  }
  for (const [i, draft] of drafts.entries()) {
    if (draft.kind !== "recommendation") continue;
    results[i] = validateRecommendation(draft, drafts, acceptedIndex) ?? draft;
  }

  const accepted: InsightDraft[] = [];
  const rejected: { draft: InsightDraft; reason: string }[] = [];
  for (const [i, result] of results.entries()) {
    if (typeof result === "string") rejected.push({ draft: drafts[i]!, reason: result });
    else accepted.push(result);
  }
  return { accepted, rejected };
}

/** Returns the (possibly evidence-stripped) draft to accept, or a rejection reason. */
async function validateClaim(tx: Queryable, draft: InsightDraft): Promise<InsightDraft | string> {
  if (draft.category === "critical" && draft.kind !== "unknown") {
    if (draft.evidenceRefs.length === 0) return "critical insight without evidence";
  }
  switch (draft.kind) {
    case "fact": {
      if (draft.evidenceRefs.length === 0) return "fact without evidence";
      const resolved = await resolveEvidence(tx, draft.evidenceRefs);
      if (resolved.length < draft.evidenceRefs.length)
        return "fact evidence does not resolve in this tenant";
      return draft;
    }
    case "inference": {
      if (typeof draft.confidence !== "number" || draft.confidence < 0 || draft.confidence > 1)
        return "inference without confidence in [0,1]";
      if (draft.evidenceRefs.length === 0) return "inference without supporting evidence";
      const resolved = await resolveEvidence(tx, draft.evidenceRefs);
      if (resolved.length === 0) return "inference evidence does not resolve in this tenant";
      // Persist only refs that actually resolve — unresolved ids must never
      // reach insights.evidence under the "validated evidence" guarantee.
      return { ...draft, evidenceRefs: resolved };
    }
    case "unknown": {
      if (!draft.missing || draft.missing.length === 0)
        return "unknown without a reason for unanswerability";
      return draft;
    }
    default:
      return "unexpected draft kind";
  }
}

function validateRecommendation(
  draft: InsightDraft,
  batch: InsightDraft[],
  acceptedIndex: Set<number>
): string | null {
  if (draft.motivatedBy === null || draft.motivatedBy === undefined)
    return "recommendation without motivating fact/inference";
  const target = batch[draft.motivatedBy];
  if (!target || (target.kind !== "fact" && target.kind !== "inference"))
    return "recommendation motivatedBy does not point at a fact/inference";
  if (!acceptedIndex.has(draft.motivatedBy)) return "recommendation motivated by a rejected claim";
  return null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Returns the refs that resolve in this tenant (RLS-scoped lookups). */
async function resolveEvidence(tx: Queryable, refs: EvidenceRef[]): Promise<EvidenceRef[]> {
  const resolved: EvidenceRef[] = [];
  for (const ref of refs) {
    // Malformed ids are filtered in JS: a bad ::uuid cast would abort the
    // enclosing transaction and poison every later lookup in the batch.
    if (!UUID_RE.test(ref.id)) continue;
    const table = ref.type === "event" ? "events" : "entities";
    const rows = await tx.query<{ id: string }>(`select id from ${table} where id = $1::uuid`, [
      ref.id,
    ]);
    if (rows.length > 0) resolved.push(ref);
  }
  return resolved;
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
