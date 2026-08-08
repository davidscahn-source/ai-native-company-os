/** Logical profiles — the ONLY model identifier business code may use. */
export type Profile = "FAST" | "BALANCED" | "REASONING";

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmRequest {
  tenantId: string;
  runId: string;
  agentKey: string;
  profile: Profile;
  messages: LlmMessage[];
  maxOutputTokens?: number | undefined;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
}

export interface LlmResult {
  text: string;
  usage: LlmUsage;
  provider: string;
  model: string;
  latencyMs: number;
  fallbackUsed: boolean;
  estimatedCostUsd: number;
}

/** Every call — success or failure — produces exactly one call record. */
export interface LlmCallRecord {
  tenantId: string;
  runId: string;
  agentKey: string;
  profile: Profile;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  estimatedCostUsd: number;
  latencyMs: number;
  status: "ok" | "error" | "budget_exceeded" | "timeout";
  fallbackUsed: boolean;
}

export interface ProviderAdapter {
  readonly name: string;
  complete(input: {
    model: string;
    messages: LlmMessage[];
    maxOutputTokens: number;
    timeoutMs: number;
  }): Promise<{ text: string; usage: LlmUsage }>;
}

export interface ModelRoute {
  provider: string;
  model: string;
  /** USD per 1M tokens */
  inputPricePerMTok: number;
  outputPricePerMTok: number;
}

/** profile → primary + optional single fallback (M3 hard cap: one fallback). */
export type RoutingTable = Record<Profile, { primary: ModelRoute; fallback?: ModelRoute }>;

export interface RunBudget {
  maxCalls: number;
  maxTotalTokens: number;
  maxUsd: number;
  timeoutMs: number;
}

export class BudgetExceededError extends Error {
  constructor(public readonly reason: string) {
    super(`llm budget exceeded: ${reason}`);
  }
}
