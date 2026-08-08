import { normalizeEmail } from "@companyos/shared";
import type { NormalizedBatch, Normalizer } from "../core/types.js";

interface StripeEvent {
  id: string;
  type: string;
  created: number;
  data: { object: Record<string, unknown> };
}

/**
 * Stripe → canonical. Pure function; every branch is fixture-tested.
 * Mapping source: docs/02-SPEC-v0.6.md §12.
 */
export const normalizeStripe: Normalizer = (payload: unknown): NormalizedBatch | null => {
  const ev = payload as StripeEvent;
  if (!ev || typeof ev.id !== "string" || typeof ev.type !== "string" || !ev.data?.object) {
    throw new Error("malformed stripe event");
  }
  const occurredAt = new Date(ev.created * 1000).toISOString();
  const obj = ev.data.object;

  switch (ev.type) {
    case "customer.created":
    case "customer.updated": {
      const email = typeof obj.email === "string" ? normalizeEmail(obj.email) : null;
      return {
        entities: [
          {
            sourceType: "customer",
            sourceId: str(obj.id),
            entityType: "customer",
            displayName: typeof obj.name === "string" ? obj.name : undefined,
            canonical: email ? { email } : {},
          },
        ],
        events: [
          {
            sourceEventId: ev.id,
            eventType: ev.type === "customer.created" ? "customer.created" : "customer.updated",
            entityRef: `customer:${str(obj.id)}`,
            entityType: "customer",
            occurredAt,
          },
        ],
      };
    }
    case "invoice.payment_failed":
    case "invoice.paid": {
      const customerId = str(obj.customer);
      return {
        entities: [
          { sourceType: "customer", sourceId: customerId, entityType: "customer" },
          {
            sourceType: "invoice",
            sourceId: str(obj.id),
            entityType: "invoice",
            canonical: {
              amount_due: obj.amount_due ?? null,
              currency: obj.currency ?? null,
              customer_source_id: customerId,
            },
          },
        ],
        events: [
          {
            sourceEventId: ev.id,
            eventType: ev.type === "invoice.paid" ? "payment.completed" : "payment.failed",
            entityRef: `customer:${customerId}`,
            entityType: "customer",
            occurredAt,
            payload: { invoice: str(obj.id), amount_due: obj.amount_due ?? null },
          },
        ],
      };
    }
    case "customer.subscription.deleted":
    case "customer.subscription.updated": {
      const customerId = str(obj.customer);
      return {
        entities: [
          { sourceType: "customer", sourceId: customerId, entityType: "customer" },
          {
            sourceType: "subscription",
            sourceId: str(obj.id),
            entityType: "subscription",
            canonical: { status: obj.status ?? null, customer_source_id: customerId },
          },
        ],
        events: [
          {
            sourceEventId: ev.id,
            eventType:
              ev.type === "customer.subscription.deleted"
                ? "subscription.cancelled"
                : "subscription.updated",
            entityRef: `subscription:${str(obj.id)}`,
            entityType: "subscription",
            occurredAt,
            payload: { customer: customerId, status: obj.status ?? null },
          },
        ],
      };
    }
    default:
      return null;
  }
};

function str(v: unknown): string {
  if (typeof v !== "string" || v.length === 0) throw new Error("expected string id");
  return v;
}
