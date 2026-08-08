import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeGithub } from "../src/github/normalizer.js";
import { normalizeStripe } from "../src/stripe/normalizer.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (provider: string, name: string): unknown =>
  JSON.parse(readFileSync(join(here, "..", "src", provider, "fixtures", name), "utf8"));

describe("stripe normalizer (fixtures)", () => {
  it("customer.created → customer entity with normalized email", () => {
    const batch = normalizeStripe(fixture("stripe", "customer_created.json"))!;
    expect(batch.entities[0]).toMatchObject({
      sourceType: "customer",
      sourceId: "cus_A1",
      entityType: "customer",
      canonical: { email: "alice@example.com" },
    });
    expect(batch.events[0]).toMatchObject({ eventType: "customer.created" });
  });

  it("invoice.payment_failed → payment.failed on the customer", () => {
    const batch = normalizeStripe(fixture("stripe", "invoice_payment_failed.json"))!;
    expect(batch.events[0]).toMatchObject({
      eventType: "payment.failed",
      entityRef: "customer:cus_A1",
    });
    expect(batch.entities.map((e) => e.sourceType).sort()).toEqual(["customer", "invoice"]);
  });

  it("invoice.paid → payment.completed", () => {
    const batch = normalizeStripe(fixture("stripe", "invoice_paid.json"))!;
    expect(batch.events[0]!.eventType).toBe("payment.completed");
  });

  it("subscription.deleted → subscription.cancelled", () => {
    const batch = normalizeStripe(fixture("stripe", "subscription_deleted.json"))!;
    expect(batch.events[0]).toMatchObject({
      eventType: "subscription.cancelled",
      entityRef: "subscription:sub_9",
    });
  });

  it("unhandled types are ignored, not errors", () => {
    expect(normalizeStripe(fixture("stripe", "unhandled_type.json"))).toBeNull();
  });

  it("malformed payloads throw (routed to failed)", () => {
    expect(() => normalizeStripe({ nope: true })).toThrow();
  });
});

describe("github normalizer (fixtures)", () => {
  it("issue opened with bug label → bug.detected", () => {
    const batch = normalizeGithub(fixture("github", "issue_opened_bug.json"))!;
    expect(batch.events[0]!.eventType).toBe("bug.detected");
    expect(batch.entities.find((e) => e.sourceType === "issue")!.entityType).toBe("bug");
  });

  it("plain issue opened → issue.created (task)", () => {
    const batch = normalizeGithub(fixture("github", "issue_opened_plain.json"))!;
    expect(batch.events[0]!.eventType).toBe("issue.created");
  });

  it("pr opened / merged → pr.opened / pr.merged with stable source ids", () => {
    const opened = normalizeGithub(fixture("github", "pr_opened.json"))!;
    const merged = normalizeGithub(fixture("github", "pr_merged.json"))!;
    expect(opened.events[0]!.eventType).toBe("pr.opened");
    expect(merged.events[0]!.eventType).toBe("pr.merged");
    expect(opened.entities[1]!.sourceId).toBe(merged.entities[1]!.sourceId);
  });
});
