import type { SqlClient } from "@companyos/db";
import { ingestRawEvent, insertEvent, markRawEvent, upsertEntity, withTenant } from "@companyos/db";
import type { Normalizer } from "./types.js";

export interface IngestResult {
  duplicate: boolean;
  ignored: boolean;
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
    if (raw.duplicate) return { duplicate: true, ignored: false, entities: 0, events: 0 };

    let batch;
    try {
      batch = normalizer(payload);
    } catch (err) {
      await markRawEvent(tx, raw.rawEventId!, "failed", String(err));
      return { duplicate: false, ignored: false, entities: 0, events: 0 };
    }

    if (batch === null) {
      await markRawEvent(tx, raw.rawEventId!, "processed", "ignored: unhandled payload type");
      return { duplicate: false, ignored: true, entities: 0, events: 0 };
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

    await markRawEvent(tx, raw.rawEventId!, "processed");
    return { duplicate: false, ignored: false, entities: batch.entities.length, events: inserted };
  });
}
