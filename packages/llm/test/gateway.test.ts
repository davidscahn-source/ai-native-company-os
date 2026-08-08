import { describe, expect, it } from "vitest";
import { DEFAULT_BUDGET, LlmGateway } from "../src/gateway.js";
import { mockAdapter } from "../src/providers.js";
import type { LlmCallRecord, LlmRequest, RoutingTable } from "../src/types.js";
import { BudgetExceededError } from "../src/types.js";

const ROUTE = (provider: string, fallbackProvider?: string): RoutingTable => {
  const mk = (p: string) => ({
    provider: p,
    model: `${p}-model-x`,
    inputPricePerMTok: 1,
    outputPricePerMTok: 5,
  });
  const entry = {
    primary: mk(provider),
    ...(fallbackProvider ? { fallback: mk(fallbackProvider) } : {}),
  };
  return { FAST: entry, BALANCED: entry, REASONING: entry };
};

const REQ: LlmRequest = {
  tenantId: "t-1",
  runId: "run-1",
  agentKey: "founder",
  profile: "FAST",
  messages: [{ role: "user", content: "hello world, summarize state" }],
};

function collector(): { records: LlmCallRecord[]; record: (r: LlmCallRecord) => Promise<void> } {
  const records: LlmCallRecord[] = [];
  return { records, record: async (r) => void records.push(r) };
}

describe("LlmGateway (single chokepoint, fully tracked)", () => {
  it("emits one complete record per successful call", async () => {
    const { records, record } = collector();
    const gw = new LlmGateway(
      ROUTE("mock"),
      new Map([["mock", mockAdapter(() => "ok result")]]),
      record
    );
    const res = await gw.complete(REQ);
    expect(res.text).toBe("ok result");
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      tenantId: "t-1",
      runId: "run-1",
      agentKey: "founder",
      profile: "FAST",
      provider: "mock",
      model: "mock-model-x",
      status: "ok",
      fallbackUsed: false,
    });
    expect(records[0]!.inputTokens).toBeGreaterThan(0);
    expect(records[0]!.estimatedCostUsd).toBeGreaterThan(0);
    expect(res.estimatedCostUsd).toBeCloseTo(
      (res.usage.inputTokens * 1 + res.usage.outputTokens * 5) / 1_000_000
    );
  });

  it("falls back at most once and marks fallback_used", async () => {
    const { records, record } = collector();
    const gw = new LlmGateway(
      ROUTE("flaky", "mock"),
      new Map([
        ["flaky", mockAdapter(() => "never", { failTimes: 99 })],
        ["mock", mockAdapter(() => "rescued")],
      ]),
      record
    );
    const res = await gw.complete(REQ);
    expect(res.text).toBe("rescued");
    expect(res.fallbackUsed).toBe(true);
    expect(records.map((r) => r.status)).toEqual(["error", "ok"]);
    expect(records[1]!.fallbackUsed).toBe(true);
  });

  it("fails (and records) when primary and single fallback both fail — no third attempt", async () => {
    const { records, record } = collector();
    const gw = new LlmGateway(
      ROUTE("flaky", "flaky2"),
      new Map([
        ["flaky", mockAdapter(() => "x", { failTimes: 99 })],
        ["flaky2", mockAdapter(() => "x", { failTimes: 99 })],
      ]),
      record
    );
    await expect(gw.complete(REQ)).rejects.toThrow(/transient failure/);
    expect(records.map((r) => r.status)).toEqual(["error", "error"]);
  });

  it("enforces max calls and records budget_exceeded", async () => {
    const { records, record } = collector();
    const gw = new LlmGateway(ROUTE("mock"), new Map([["mock", mockAdapter(() => "ok")]]), record, {
      ...DEFAULT_BUDGET,
      maxCalls: 1,
    });
    await gw.complete(REQ);
    await expect(gw.complete(REQ)).rejects.toThrow(BudgetExceededError);
    expect(records.map((r) => r.status)).toEqual(["ok", "budget_exceeded"]);
  });

  it("enforces the USD ceiling", async () => {
    const { record } = collector();
    const gw = new LlmGateway(
      ROUTE("mock"),
      new Map([["mock", mockAdapter(() => "y".repeat(4000))]]),
      record,
      { ...DEFAULT_BUDGET, maxUsd: 0.000001 }
    );
    await gw.complete(REQ); // first call is allowed to cross the ceiling
    await expect(gw.complete(REQ)).rejects.toThrow(/max usd/);
  });

  it("times out slow providers and records status=timeout", async () => {
    const { records, record } = collector();
    const gw = new LlmGateway(
      ROUTE("slow"),
      new Map([["slow", mockAdapter(() => "late", { latencyMs: 200 })]]),
      record,
      { ...DEFAULT_BUDGET, timeoutMs: 20 }
    );
    await expect(gw.complete(REQ)).rejects.toThrow(/timed out/);
    expect(records[0]!.status).toBe("timeout");
  });

  it("tracks cumulative spend across calls", async () => {
    const { record } = collector();
    const gw = new LlmGateway(ROUTE("mock"), new Map([["mock", mockAdapter(() => "ok")]]), record);
    await gw.complete(REQ);
    await gw.complete(REQ);
    const spent = gw.spent();
    expect(spent.calls).toBe(2);
    expect(spent.totalTokens).toBeGreaterThan(0);
    expect(spent.totalUsd).toBeGreaterThan(0);
  });
});
