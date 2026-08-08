export type EventSource =
  "stripe" | "github" | "slack" | "sentry" | "linear" | "gmail" | "system" | "agent";

export type Sensitivity = "normal" | "sensitive" | "restricted";

/**
 * Canonical event — the only shape connector data may take before it reaches
 * the graph or any agent. See docs/02-SPEC-v0.6.md §12.
 */
export interface CanonicalEvent {
  eventId: string;
  tenantId: string;
  source: EventSource;
  sourceEventId: string;
  entityType: string;
  /** null until entity resolution assigns one */
  entityId: string | null;
  eventType: string;
  /** ISO 8601, provider-side occurrence time */
  occurredAt: string;
  payload: Record<string, unknown>;
  /** 1.0 for provider-originated events, < 1.0 for derived events */
  confidence: number;
  sensitivity: Sensitivity;
  correlationId: string | null;
  traceId: string | null;
}
