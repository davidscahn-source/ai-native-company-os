import type { Queryable } from "@companyos/db";
import type { CompanyStateSnapshot } from "@companyos/state";
import type { EvidenceRef } from "./insight.js";
import type { QuestionClass } from "./answerability.js";

/**
 * Context Builder (M3b §1). Deterministic: the same graph + snapshot + options
 * always produce the same ContextPackage. Every piece of evidence carries
 * WHY it was selected, and everything considered-but-dropped is recorded in
 * `excluded` with a reason — the package is auditable end to end.
 *
 * The builder never calls the model; it only prepares what the model sees.
 */

export const CONTEXT_VERSION = "ctx-v1.0";

/** Which sources matter per question class (mirrors answerability). */
const CLASS_SOURCES: Record<QuestionClass, string[] | null> = {
  what_changed: null, // null = all sources relevant
  what_to_worry: null,
  revenue_risk: ["stripe"],
  engineering_activity: ["github"],
  missing_data: null,
};

export interface ContextEvidence {
  ref: EvidenceRef;
  summary: string;
  whySelected: string;
}

export interface ContextExclusion {
  ref: EvidenceRef;
  summary: string;
  reason: string;
}

export interface ContextPackage {
  contextVersion: string;
  capturedUntil: string;
  questionClass: QuestionClass | null;
  /** deterministic company state — the model explains it, never computes it */
  state: CompanyStateSnapshot;
  evidence: ContextEvidence[];
  excluded: ContextExclusion[];
  limits: { windowMs: number; maxEvents: number; maxEntities: number };
}

export interface ContextOptions {
  questionClass?: QuestionClass | null;
  /** how far back from capturedUntil events are considered (default 30 days) */
  windowMs?: number;
  maxEvents?: number;
  maxEntities?: number;
}

interface EventRow {
  id: string;
  source: string;
  event_type: string;
  occurred_at: string;
  entity_id: string | null;
}

interface EntityRow {
  id: string;
  type: string;
  display_name: string | null;
}

const DEFAULTS = { windowMs: 30 * 24 * 3600 * 1000, maxEvents: 20, maxEntities: 10 };

export async function buildContext(
  tx: Queryable,
  snapshot: CompanyStateSnapshot,
  opts: ContextOptions = {}
): Promise<ContextPackage> {
  const questionClass = opts.questionClass ?? null;
  const windowMs = opts.windowMs ?? DEFAULTS.windowMs;
  const maxEvents = opts.maxEvents ?? DEFAULTS.maxEvents;
  const maxEntities = opts.maxEntities ?? DEFAULTS.maxEntities;
  const capturedUntil = snapshot.capturedUntil;
  const windowStartMs = new Date(capturedUntil).getTime() - windowMs;

  const relevantSources = questionClass ? CLASS_SOURCES[questionClass] : null;

  // Deterministic candidate set: everything up to the cutoff, newest first,
  // ties broken by id. Bounded fetch — beyond it we only claim "over budget".
  const candidates = await tx.query<EventRow>(
    `select id, source, event_type, occurred_at, entity_id
     from events where occurred_at <= $1
     order by occurred_at desc, id
     limit $2`,
    [capturedUntil, maxEvents * 3]
  );

  const evidence: ContextEvidence[] = [];
  const excluded: ContextExclusion[] = [];
  const selectedEntityIds: string[] = [];

  for (const ev of candidates) {
    const ref: EvidenceRef = { type: "event", id: ev.id };
    const summary = `${ev.event_type} @ ${new Date(ev.occurred_at).toISOString()} [${ev.source}]`;
    if (relevantSources && !relevantSources.includes(ev.source)) {
      excluded.push({ ref, summary, reason: `source_not_relevant:${questionClass}` });
      continue;
    }
    if (new Date(ev.occurred_at).getTime() < windowStartMs) {
      excluded.push({ ref, summary, reason: `outside_window:${windowMs}ms` });
      continue;
    }
    if (evidence.length >= maxEvents) {
      excluded.push({ ref, summary, reason: `over_event_budget:${maxEvents}` });
      continue;
    }
    const why = relevantSources
      ? `within window before capturedUntil; source ${ev.source} required by class ${questionClass}`
      : `within window before capturedUntil; recent activity (${ev.event_type})`;
    evidence.push({ ref, summary, whySelected: why });
    if (ev.entity_id && !selectedEntityIds.includes(ev.entity_id)) {
      selectedEntityIds.push(ev.entity_id);
    }
  }

  // Entities enter the package only because a selected event references them.
  if (selectedEntityIds.length > 0) {
    const rows = await tx.query<EntityRow>(
      `select id, type, display_name from entities where id = any($1::uuid[]) order by id`,
      [selectedEntityIds]
    );
    const byId = new Map(rows.map((r) => [r.id, r]));
    // preserve event-selection order (recency), not row order
    for (const [i, id] of selectedEntityIds.entries()) {
      const row = byId.get(id);
      if (!row) continue; // referenced entity not visible in this tenant — skip
      const ref: EvidenceRef = { type: "entity", id: row.id };
      const summary = `${row.type}${row.display_name ? ` "${row.display_name}"` : ""}`;
      if (i < maxEntities) {
        evidence.push({ ref, summary, whySelected: "referenced by a selected event" });
      } else {
        excluded.push({ ref, summary, reason: `over_entity_budget:${maxEntities}` });
      }
    }
  }

  return {
    contextVersion: CONTEXT_VERSION,
    capturedUntil,
    questionClass,
    state: snapshot,
    evidence,
    excluded,
    limits: { windowMs, maxEvents, maxEntities },
  };
}

/**
 * Render the package into the prompt the model sees. Pure function of the
 * package — versioned alongside CONTEXT_VERSION so Harness A/B can hold the
 * prompt constant while varying exactly one other element.
 */
export function renderContext(pkg: ContextPackage): string {
  const lines: string[] = [
    `[context ${pkg.contextVersion}] captured_until=${pkg.capturedUntil}`,
    `company_state: ${JSON.stringify(pkg.state.state)}`,
    `source_watermark: ${JSON.stringify(pkg.state.sourceWatermark)}`,
    `completeness: ${JSON.stringify(pkg.state.completeness)}`,
    `evidence (${pkg.evidence.length}):`,
    ...pkg.evidence.map((e) => `- [${e.ref.type}:${e.ref.id}] ${e.summary}`),
  ];
  if (pkg.excluded.length > 0) {
    lines.push(`excluded (${pkg.excluded.length} items withheld; do not speculate about them)`);
  }
  return lines.join("\n");
}
