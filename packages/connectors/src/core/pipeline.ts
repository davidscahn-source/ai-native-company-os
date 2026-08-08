import type { SqlClient } from "@companyos/db";
import {
  addRelationship,
  ingestRawEvent,
  insertEvent,
  markRawEvent,
  upsertEntity,
  withTenant,
} from "@companyos/db";
import type { Normalizer } from "./types.js";

export interface IngestResult {
  duplicate: boolean;
  ignored: boolean;
  /** true when the normalizer rejected the payload (raw event kept, status `failed`) */
  failed: boolean;
  entities: number;
  events: number;
}

/**
 * Shared Sync Harness ingestion path (signature verification happens at the
 * transport edge before this is called):
 *   raw_events (verbatim, deduped) → normalizer (pure) → entities + canonical events.
 * Idempotent end to end: replaying the same payload changes nothing.
 */
export async function ingestPayload(
  client: SqlClient,
  tenantId: string,
  provider: string,
  dedupKey: string,
  payload: unknown,
  normalizer: Normalizer
): Promise<IngestResult> {
  return withTenant(client, tenantId, async (tx) => {
    const raw = await ingestRawEvent(tx, { provider, dedupKey, payload });
    if (raw.duplicate)
      return { duplicate: true, ignored: false, failed: false, entities: 0, events: 0 };

    let batch;
    try {
      batch = normalizer(payload);
    } catch (err) {
      await markRawEvent(tx, raw.rawEventId!, "failed", String(err));
      return { duplicate: false, ignored: false, failed: true, entities: 0, events: 0 };
    }

    if (batch === null) {
      await markRawEvent(tx, raw.rawEventId!, "processed", "ignored: unhandled payload type");
      return { duplicate: false, ignored: true, failed: false, entities: 0, events: 0 };
    }

    // A relationship ref outside the batch is a normalizer bug. Reject it here,
    // before any inserts, so it is recorded like any other normalizer failure
    // instead of aborting the transaction mid-write.
    const entityRefs = new Set(batch.entities.map((d) => `${d.sourceType}:${d.sourceId}`));
    const badRel = (batch.relationships ?? []).find(
      (r) => !entityRefs.has(r.fromRef) || !entityRefs.has(r.toRef)
    );
    if (badRel) {
      const msg = `relationship ref not in batch: ${badRel.fromRef} -> ${badRel.toRef}`;
      await markRawEvent(tx, raw.rawEventId!, "failed", msg);
      return { duplicate: false, ignored: false, failed: true, entities: 0, events: 0 };
    }

    const refToEntityId = new Map<string, string>();
    for (const draft of batch.entities) {
      const id = await upsertEntity(tx, { provider, ...draft });
      refToEntityId.set(`${draft.sourceType}:${draft.sourceId}`, id);
    }

    let inserted = 0;
    for (const ev of batch.events) {
      const ok = await insertEvent(tx, {
        source: provider,
        sourceEventId: ev.sourceEventId,
        entityType: ev.entityType,
        entityId: refToEntityId.get(ev.entityRef) ?? null,
        eventType: ev.eventType,
        occurredAt: ev.occurredAt,
        payload: ev.payload ?? {},
      });
      if (ok) inserted += 1;
    }

    for (const rel of batch.relationships ?? []) {
      await addRelationship(tx, {
        fromEntityId: refToEntityId.get(rel.fromRef)!,
        toEntityId: refToEntityId.get(rel.toRef)!,
        type: rel.type,
        evidence: {
          rule: "provider_fk",
          // only the events about this edge's endpoints prove this edge
          eventIds: batch.events
            .filter((e) => e.entityRef === rel.fromRef || e.entityRef === rel.toRef)
            .map((e) => e.sourceEventId),
        },
      });
    }

    await markRawEvent(tx, raw.rawEventId!, "processed");
    return {
      duplicate: false,
      ignored: false,
      failed: false,
      entities: batch.entities.length,
      events: inserted,
    };
  });
}
