/** Output of a provider normalizer — pure data, no side effects. */
export interface EntityDraftOut {
  sourceType: string;
  sourceId: string;
  entityType: string;
  displayName?: string | undefined;
  canonical?: Record<string, unknown> | undefined;
  /** provider-payload-derived observation time (ISO) */
  observedAt?: string | undefined;
}

export interface EventDraftOut {
  sourceEventId: string;
  eventType: string;
  /** `${sourceType}:${sourceId}` of the entity this event belongs to */
  entityRef: string;
  entityType: string;
  occurredAt: string;
  payload?: Record<string, unknown> | undefined;
}

export interface RelationshipDraftOut {
  /** `${sourceType}:${sourceId}` refs into this batch's entities */
  fromRef: string;
  toRef: string;
  type: string;
}

export interface NormalizedBatch {
  entities: EntityDraftOut[];
  events: EventDraftOut[];
  relationships?: RelationshipDraftOut[] | undefined;
}

/**
 * A normalizer is a pure function: provider payload in, canonical drafts out.
 * Returns null for payload types we deliberately ignore.
 * Throwing means "malformed payload" and routes the raw event to `failed`.
 */
export type Normalizer = (payload: unknown) => NormalizedBatch | null;
