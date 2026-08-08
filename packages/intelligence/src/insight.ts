/** Structured Insight Contract (M3 §2) — the only shape model output may take. */

export type InsightKind = "fact" | "inference" | "recommendation" | "unknown";

export type InsightCategory =
  "critical" | "revenue" | "customer" | "engineering" | "unknown_signal";

export interface EvidenceRef {
  type: "event" | "entity";
  id: string;
}

export interface InsightDraft {
  kind: InsightKind;
  category: InsightCategory;
  statement: string;
  /** required for inference; null otherwise */
  confidence?: number | null | undefined;
  evidenceRefs: EvidenceRef[];
  /** recommendation: index of the fact/inference in the same batch motivating it */
  motivatedBy?: number | null | undefined;
  /** unknown: why the system cannot answer / what is missing */
  missing?: string | null | undefined;
}

/**
 * Parse model output into drafts. The model returns a JSON array; anything
 * unparseable is a generation failure — never silently coerced.
 */
export function parseInsightDrafts(raw: string): InsightDraft[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(raw));
  } catch {
    throw new Error("model output is not valid JSON");
  }
  if (!Array.isArray(parsed)) throw new Error("model output is not an array");
  return parsed.map((item, i) => {
    const o = item as Record<string, unknown>;
    const kind = o.kind;
    if (kind !== "fact" && kind !== "inference" && kind !== "recommendation" && kind !== "unknown")
      throw new Error(`insight[${i}]: invalid kind ${String(kind)}`);
    const category = o.category;
    if (
      category !== "critical" &&
      category !== "revenue" &&
      category !== "customer" &&
      category !== "engineering" &&
      category !== "unknown_signal"
    )
      throw new Error(`insight[${i}]: invalid category ${String(category)}`);
    if (typeof o.statement !== "string" || o.statement.length === 0)
      throw new Error(`insight[${i}]: missing statement`);
    const refs = Array.isArray(o.evidenceRefs) ? (o.evidenceRefs as EvidenceRef[]) : [];
    return {
      kind,
      category,
      statement: o.statement,
      confidence: typeof o.confidence === "number" ? o.confidence : null,
      evidenceRefs: refs.filter(
        (r) => (r.type === "event" || r.type === "entity") && typeof r.id === "string"
      ),
      motivatedBy: typeof o.motivatedBy === "number" ? o.motivatedBy : null,
      missing: typeof o.missing === "string" ? o.missing : null,
    };
  });
}

function extractJson(raw: string): string {
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) return raw;
  return raw.slice(start, end + 1);
}
