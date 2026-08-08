import { randomUUID } from "node:crypto";
import type { Queryable, SqlClient } from "./client.js";

/** Control-plane: create a tenant. Not tenant-scoped by design. */
export async function createTenant(client: SqlClient, name: string): Promise<string> {
  const id = randomUUID();
  await client.query("insert into tenants (id, name) values ($1, $2)", [id, name]);
  return id;
}

/**
 * Store an inbound provider payload exactly as received.
 * tenant_id comes from app.tenant_id — a caller cannot write into another tenant.
 * Returns false when the (provider, dedup_key) pair was already ingested.
 */
export async function ingestRawEvent(
  tx: Queryable,
  input: { provider: string; dedupKey: string; payload: unknown }
): Promise<{ rawEventId: string | null; duplicate: boolean }> {
  const rows = await tx.query<{ id: string }>(
    `insert into raw_events (tenant_id, provider, dedup_key, payload)
     values (nullif(current_setting('app.tenant_id', true), '')::uuid, $1, $2, $3)
     on conflict (tenant_id, provider, dedup_key) do nothing
     returning id`,
    [input.provider, input.dedupKey, JSON.stringify(input.payload)]
  );
  const row = rows[0];
  return row ? { rawEventId: row.id, duplicate: false } : { rawEventId: null, duplicate: true };
}

export interface EntityDraft {
  provider: string;
  sourceType: string;
  sourceId: string;
  entityType: string;
  displayName?: string | undefined;
  canonical?: Record<string, unknown> | undefined;
}

/**
 * Deterministic entity resolution v0 (M1):
 *  1. exact source link (provider FK identity)
 *  2. exact normalized-email match within the same entity type
 *  3. otherwise create a new entity
 * No heuristics, no LLM. Returns the entity id.
 */
export async function upsertEntity(tx: Queryable, draft: EntityDraft): Promise<string> {
  const linked = await tx.query<{ entity_id: string }>(
    `select entity_id from source_links
     where provider = $1 and source_type = $2 and source_id = $3`,
    [draft.provider, draft.sourceType, draft.sourceId]
  );
  const existing = linked[0];
  if (existing) {
    await tx.query(
      `update source_links set raw_latest = $4
       where provider = $1 and source_type = $2 and source_id = $3`,
      [draft.provider, draft.sourceType, draft.sourceId, JSON.stringify(draft.canonical ?? {})]
    );
    await touchEntity(tx, existing.entity_id, draft);
    return existing.entity_id;
  }

  const email = draft.canonical?.["email"];
  const byEmail =
    typeof email === "string" && email.length > 0
      ? await tx.query<{ id: string }>(
          `select id from entities where type = $1 and canonical->>'email' = $2 limit 1`,
          [draft.entityType, email]
        )
      : [];

  let entityId: string;
  const matched = byEmail[0]?.id;
  if (matched !== undefined) {
    entityId = matched;
    await touchEntity(tx, entityId, draft);
  } else {
    entityId = randomUUID();
    await tx.query(
      `insert into entities (id, tenant_id, type, display_name, canonical)
       values ($1, nullif(current_setting('app.tenant_id', true), '')::uuid, $2, $3, $4)`,
      [entityId, draft.entityType, draft.displayName ?? null, JSON.stringify(draft.canonical ?? {})]
    );
  }

  await tx.query(
    `insert into source_links (tenant_id, entity_id, provider, source_type, source_id, raw_latest)
     values (nullif(current_setting('app.tenant_id', true), '')::uuid, $1, $2, $3, $4, $5)
     on conflict (tenant_id, provider, source_type, source_id) do nothing`,
    [
      entityId,
      draft.provider,
      draft.sourceType,
      draft.sourceId,
      JSON.stringify(draft.canonical ?? {}),
    ]
  );
  return entityId;
}

/** Merge a draft's data into an already-resolved entity (newer payloads win). */
async function touchEntity(tx: Queryable, entityId: string, draft: EntityDraft): Promise<void> {
  await tx.query(
    `update entities
     set last_seen_at = now(),
         canonical = canonical || $2::jsonb,
         display_name = coalesce($3, display_name)
     where id = $1`,
    [entityId, JSON.stringify(draft.canonical ?? {}), draft.displayName ?? null]
  );
}

export interface CanonicalEventRow {
  source: string;
  sourceEventId: string;
  entityType: string;
  entityId: string | null;
  eventType: string;
  occurredAt: string;
  payload?: Record<string, unknown> | undefined;
  confidence?: number;
  sensitivity?: string;
}

/** Idempotent by (tenant, source, source_event_id). Returns false on replay. */
export async function insertEvent(tx: Queryable, ev: CanonicalEventRow): Promise<boolean> {
  const rows = await tx.query<{ id: string }>(
    `insert into events (tenant_id, source, source_event_id, entity_type, entity_id,
                         event_type, occurred_at, payload, confidence, sensitivity)
     values (nullif(current_setting('app.tenant_id', true), '')::uuid,
             $1, $2, $3, $4, $5, $6, $7, $8, $9)
     on conflict (tenant_id, source, source_event_id) do nothing
     returning id`,
    [
      ev.source,
      ev.sourceEventId,
      ev.entityType,
      ev.entityId,
      ev.eventType,
      ev.occurredAt,
      JSON.stringify(ev.payload ?? {}),
      ev.confidence ?? 1.0,
      ev.sensitivity ?? "normal",
    ]
  );
  return rows.length > 0;
}

export async function markRawEvent(
  tx: Queryable,
  rawEventId: string,
  status: "processed" | "failed",
  error?: string
): Promise<void> {
  await tx.query(`update raw_events set processing_status = $2, error = $3 where id = $1`, [
    rawEventId,
    status,
    error ?? null,
  ]);
}

export interface RelationshipInput {
  fromEntityId: string;
  toEntityId: string;
  type: string;
  confidence?: number;
  /** provenance: which rule created this edge and which source events prove it */
  evidence: { rule: string; eventIds?: string[] };
}

/**
 * Insert a graph edge with provenance. Both endpoints must be visible to the
 * current tenant — FK checks bypass RLS, so we verify visibility explicitly to
 * make cross-tenant edges impossible even with a leaked entity uuid.
 */
export async function addRelationship(tx: Queryable, rel: RelationshipInput): Promise<boolean> {
  const visible = await tx.query<{ n: string }>(
    `select count(*) as n from entities where id = $1 or id = $2`,
    [rel.fromEntityId, rel.toEntityId]
  );
  if (Number(visible[0]!.n) !== 2) {
    throw new Error("relationship endpoints must be visible to the current tenant");
  }
  const rows = await tx.query<{ id: string }>(
    `insert into relationships (tenant_id, from_entity_id, to_entity_id, type, confidence, evidence)
     values (nullif(current_setting('app.tenant_id', true), '')::uuid, $1, $2, $3, $4, $5)
     on conflict (tenant_id, from_entity_id, to_entity_id, type) do nothing
     returning id`,
    [
      rel.fromEntityId,
      rel.toEntityId,
      rel.type,
      rel.confidence ?? 1.0,
      JSON.stringify(rel.evidence),
    ]
  );
  return rows.length > 0;
}
