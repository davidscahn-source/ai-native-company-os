import type { Queryable } from "@companyos/db";
import {
  BudgetExceededError,
  type LlmCallRecord,
  type LlmRequest,
  type LlmResult,
  type ProviderAdapter,
  type RoutingTable,
  type RunBudget,
} from "./types.js";

export const DEFAULT_BUDGET: RunBudget = {
  maxCalls: 10,
  maxTotalTokens: 200_000,
  maxUsd: 1.0,
  timeoutMs: 60_000,
};

/**
 * The single chokepoint for model access (M3 rule: no untracked LLM call).
 * - business code speaks profiles, never provider model names
 * - every call (ok / error / timeout / budget_exceeded) emits one record
 * - hard per-run budget; at most one fallback per call
 */
export class LlmGateway {
  private calls = 0;
  private totalTokens = 0;
  private totalUsd = 0;

  constructor(
    private readonly routing: RoutingTable,
    private readonly adapters: Map<string, ProviderAdapter>,
    private readonly recordCall: (record: LlmCallRecord) => Promise<void>,
    private readonly budget: RunBudget = DEFAULT_BUDGET
  ) {}

  spent(): { calls: number; totalTokens: number; totalUsd: number } {
    return { calls: this.calls, totalTokens: this.totalTokens, totalUsd: this.totalUsd };
  }

  async complete(req: LlmRequest): Promise<LlmResult> {
    if (this.calls >= this.budget.maxCalls) {
      await this.emit(req, null, 0, "budget_exceeded", false);
      throw new BudgetExceededError(`max calls (${this.budget.maxCalls})`);
    }
    if (this.totalTokens >= this.budget.maxTotalTokens) {
      await this.emit(req, null, 0, "budget_exceeded", false);
      throw new BudgetExceededError(`max tokens (${this.budget.maxTotalTokens})`);
    }
    if (this.totalUsd >= this.budget.maxUsd) {
      await this.emit(req, null, 0, "budget_exceeded", false);
      throw new BudgetExceededError(`max usd (${this.budget.maxUsd})`);
    }

    const route = this.routing[req.profile];
    const attempts = route.fallback ? [route.primary, route.fallback] : [route.primary];

    let lastError: unknown = null;
    for (let i = 0; i < attempts.length; i++) {
      const attempt = attempts[i]!;
      const fallbackUsed = i > 0;
      const start = performance.now();
      try {
        // Inside the try so a misconfigured provider name is still one
        // recorded attempt — the ledger must see every attempt, no exceptions.
        const adapter = this.adapters.get(attempt.provider);
        if (!adapter) throw new Error(`no adapter for provider ${attempt.provider}`);
        const out = await withTimeout(
          adapter.complete({
            model: attempt.model,
            messages: req.messages,
            maxOutputTokens: req.maxOutputTokens ?? 4096,
            timeoutMs: this.budget.timeoutMs,
          }),
          this.budget.timeoutMs
        );
        const latencyMs = Math.round(performance.now() - start);
        const cost =
          (out.usage.inputTokens * attempt.inputPricePerMTok +
            out.usage.outputTokens * attempt.outputPricePerMTok) /
          1_000_000;
        const result: LlmResult = {
          text: out.text,
          usage: out.usage,
          provider: attempt.provider,
          model: attempt.model,
          latencyMs,
          fallbackUsed,
          estimatedCostUsd: cost,
        };
        this.calls += 1;
        this.totalTokens += out.usage.inputTokens + out.usage.outputTokens;
        this.totalUsd += cost;
        await this.emit(req, result, latencyMs, "ok", fallbackUsed);
        return result;
      } catch (err) {
        const latencyMs = Math.round(performance.now() - start);
        this.calls += 1;
        lastError = err;
        const status = err instanceof TimeoutError ? "timeout" : "error";
        await this.emit(req, null, latencyMs, status, fallbackUsed, attempt);
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private async emit(
    req: LlmRequest,
    result: LlmResult | null,
    latencyMs: number,
    status: LlmCallRecord["status"],
    fallbackUsed: boolean,
    attempted?: { provider: string; model: string }
  ): Promise<void> {
    const route = this.routing[req.profile];
    await this.recordCall({
      tenantId: req.tenantId,
      runId: req.runId,
      agentKey: req.agentKey,
      profile: req.profile,
      provider: result?.provider ?? attempted?.provider ?? route.primary.provider,
      model: result?.model ?? attempted?.model ?? route.primary.model,
      inputTokens: result?.usage.inputTokens ?? 0,
      outputTokens: result?.usage.outputTokens ?? 0,
      cacheTokens: result?.usage.cacheTokens ?? 0,
      estimatedCostUsd: result?.estimatedCostUsd ?? 0,
      latencyMs,
      status,
      fallbackUsed,
    });
  }
}

/** Persist a call record into the tenant-scoped ledger. */
export async function saveCallRecord(tx: Queryable, r: LlmCallRecord): Promise<void> {
  await tx.query(
    `insert into llm_calls (tenant_id, run_id, agent_key, profile, provider, model,
       input_tokens, output_tokens, cache_tokens, estimated_cost_usd, latency_ms, status, fallback_used)
     values (nullif(current_setting('app.tenant_id', true), '')::uuid,
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      r.runId,
      r.agentKey,
      r.profile,
      r.provider,
      r.model,
      r.inputTokens,
      r.outputTokens,
      r.cacheTokens,
      r.estimatedCostUsd,
      r.latencyMs,
      r.status,
      r.fallbackUsed,
    ]
  );
}

class TimeoutError extends Error {}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new TimeoutError(`timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    // If the timer won, the abandoned adapter promise may still reject later
    // (e.g. connection reset). Without a handler that late rejection is an
    // unhandled rejection and kills the process mid-run.
    p.catch(() => {});
  }
}
