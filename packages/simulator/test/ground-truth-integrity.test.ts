import { describe, expect, it } from "vitest";
import { generateCompany } from "../src/generator.js";
import type { GeneratedCompany, GeneratedPayload } from "../src/ground-truth.js";
import { seedsOf } from "../src/seeds.js";

/**
 * The ground truth is what every utility metric is scored against, so a
 * ground-truth statement contradicted by the generator's own background data
 * silently corrupts the entire lab. Code review found exactly that class of
 * bug by sweeping 100 seeds; these properties encode the sweep so it cannot
 * regress.
 *
 * Pure generation (no DB), so running the full dev range stays fast.
 */

const DEV_SEEDS = seedsOf("dev", 100);

interface InvoiceEvent {
  customer: string;
  paid: boolean;
  at: string;
}

function invoices(company: GeneratedCompany): InvoiceEvent[] {
  const out: InvoiceEvent[] = [];
  for (const p of company.payloads) {
    const body = p.payload as { type?: string; data?: { object?: Record<string, unknown> } };
    if (body.type !== "invoice.paid" && body.type !== "invoice.payment_failed") continue;
    out.push({
      customer: String(body.data?.object?.customer),
      paid: body.type === "invoice.paid",
      at: p.occurredAt,
    });
  }
  return out;
}

/** Open-bug age at the cutoff, per issue id. */
function openBugAges(company: GeneratedCompany): Map<number, number> {
  const opened = new Map<number, string>();
  const closed = new Set<number>();
  for (const p of company.payloads as GeneratedPayload[]) {
    const body = p.payload as { action?: string; issue?: { id?: number } };
    const id = body.issue?.id;
    if (id === undefined) continue;
    if (body.action === "opened") opened.set(id, p.occurredAt);
    if (body.action === "closed") closed.add(id);
  }
  const endMs = new Date(company.endAt).getTime();
  const ages = new Map<number, number>();
  for (const [id, at] of opened) {
    if (closed.has(id)) continue;
    ages.set(id, (endMs - new Date(at).getTime()) / (24 * 3600 * 1000));
  }
  return ages;
}

describe("ground truth integrity across every dev seed", () => {
  const companies = DEV_SEEDS.map((seed) => generateCompany({ seed, purpose: "development" }));

  it("churn victim has NO successful payment after the planted failures", () => {
    const violations: string[] = [];
    for (const c of companies) {
      const churn = c.groundTruth.signals.find((s) => s.kind === "churn_risk")!;
      const victimId = churn.evidenceKeys.find((k) => k.startsWith("customer:"))!.slice(9);
      // The claim is "no successful payment since the PLANTED failures" — an
      // earlier background failure that legitimately recovered is fine.
      const plantedFailAt = churn.observableFrom;
      const firstPlanted = invoices(c)
        .filter((i) => i.customer === victimId && !i.paid && i.at <= plantedFailAt)
        .map((i) => i.at)
        .sort()
        .reverse()[1];
      const since = firstPlanted ?? plantedFailAt;
      const paidAfter = invoices(c).filter(
        (i) => i.customer === victimId && i.paid && i.at >= since
      );
      if (paidAfter.length > 0)
        violations.push(`seed ${c.seed}: ${paidAfter.length} paid after fail`);
    }
    expect(violations).toEqual([]);
  });

  it("the churn pattern is UNIQUE — no undeclared customer reproduces it", () => {
    const violations: string[] = [];
    for (const c of companies) {
      const churn = c.groundTruth.signals.find((s) => s.kind === "churn_risk")!;
      const victimId = churn.evidenceKeys.find((k) => k.startsWith("customer:"))!.slice(9);
      const byCustomer = new Map<string, InvoiceEvent[]>();
      for (const inv of invoices(c)) {
        const list = byCustomer.get(inv.customer) ?? [];
        list.push(inv);
        byCustomer.set(inv.customer, list);
      }
      for (const [customer, list] of byCustomer) {
        if (customer === victimId) continue;
        const sorted = [...list].sort((a, b) => a.at.localeCompare(b.at));
        const fails = sorted.filter((i) => !i.paid);
        if (fails.length < 2) continue;
        const lastFail = fails[fails.length - 1]!;
        const recovered = sorted.some((i) => i.paid && i.at > lastFail.at);
        if (!recovered)
          violations.push(`seed ${c.seed}: ${customer} also failed twice then went quiet`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("the planted stale bug is genuinely the oldest open bug", () => {
    const violations: string[] = [];
    for (const c of companies) {
      const stale = c.groundTruth.signals.find((s) => s.kind === "stale_bug")!;
      const staleId = Number(stale.evidenceKeys[0]!.slice("issue:".length));
      const ages = openBugAges(c);
      const staleAge = ages.get(staleId);
      if (staleAge === undefined) {
        violations.push(`seed ${c.seed}: planted stale bug is not open at the cutoff`);
        continue;
      }
      for (const [id, age] of ages) {
        if (id !== staleId && age >= staleAge) {
          violations.push(
            `seed ${c.seed}: bug ${id} open ${age.toFixed(1)}d >= planted ${staleAge.toFixed(1)}d`
          );
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("the churn victim really is a high-value (enterprise) account", () => {
    const violations: string[] = [];
    for (const c of companies) {
      const churn = c.groundTruth.signals.find((s) => s.kind === "churn_risk")!;
      const victimId = churn.evidenceKeys.find((k) => k.startsWith("customer:"))!.slice(9);
      const amounts = invoices(c)
        .filter((i) => i.customer === victimId)
        .map(() => 0);
      // amount is on the payload; re-read it directly
      const amount =
        c.payloads
          .map(
            (p) => p.payload as { data?: { object?: { customer?: string; amount_due?: number } } }
          )
          .find((b) => b.data?.object?.customer === victimId)?.data?.object?.amount_due ?? 0;
      expect(amounts.length).toBeGreaterThan(0);
      if (amount < 100000)
        violations.push(`seed ${c.seed}: victim amount ${amount} is not enterprise`);
      if (!churn.truth.includes("High-value"))
        violations.push(`seed ${c.seed}: truth text mismatch`);
    }
    expect(violations).toEqual([]);
  });

  it("declared relationships use the direction and type the normalizer actually produces", () => {
    for (const c of companies.slice(0, 5)) {
      for (const rel of c.groundTruth.relationships) {
        // Stripe normalizer emits customer -> invoice, type paid | billed_to
        expect(rel.fromKey.startsWith("customer:")).toBe(true);
        expect(rel.toKey.startsWith("invoice:")).toBe(true);
        expect(["paid", "billed_to"]).toContain(rel.type);
      }
    }
  });

  it("every generated invoice has a declared billing edge (none look hallucinated)", () => {
    for (const c of companies.slice(0, 5)) {
      const declared = new Set(c.groundTruth.relationships.map((r) => r.toKey));
      const invoiceIds = new Set(
        c.payloads
          .map((p) => p.payload as { data?: { object?: { object?: string; id?: string } } })
          .filter((b) => b.data?.object?.object === "invoice")
          .map((b) => `invoice:${b.data!.object!.id}`)
      );
      for (const id of invoiceIds) {
        expect(declared.has(id), `${id} has no declared billing edge in seed ${c.seed}`).toBe(true);
      }
    }
  });

  it("a window too short for the planted signals is refused, not silently distorted", () => {
    expect(() => generateCompany({ seed: 1000, purpose: "development", days: 14 })).toThrow(
      /days must be/
    );
  });
});
