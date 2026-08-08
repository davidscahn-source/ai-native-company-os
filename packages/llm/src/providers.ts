import type { LlmMessage, LlmUsage, ProviderAdapter, RoutingTable } from "./types.js";

/**
 * The ONLY module allowed to know provider-specific model names.
 * Real routes come from environment configuration; nothing here is imported
 * by agent/business code (they speak profiles via the gateway).
 *
 * Real network adapters are thin fetch wrappers, exercised only when the
 * corresponding API key env var is present (blocked on Owner issue #4).
 */

export function routingFromEnv(env: Record<string, string | undefined>): RoutingTable {
  const route = (prefix: string) => {
    // A fallback route exists iff the operator configures one:
    // LLM_<PROFILE>_FALLBACK_MODEL (+ optional PROVIDER / IN_PRICE / OUT_PRICE).
    const fallbackModel = env[`LLM_${prefix}_FALLBACK_MODEL`];
    return {
      primary: {
        provider: env[`LLM_${prefix}_PROVIDER`] ?? "anthropic",
        model: env[`LLM_${prefix}_MODEL`] ?? defaultModel(prefix),
        inputPricePerMTok: num(env[`LLM_${prefix}_IN_PRICE`], defaultInPrice(prefix)),
        outputPricePerMTok: num(env[`LLM_${prefix}_OUT_PRICE`], defaultOutPrice(prefix)),
      },
      ...(fallbackModel
        ? {
            fallback: {
              provider: env[`LLM_${prefix}_FALLBACK_PROVIDER`] ?? "anthropic",
              model: fallbackModel,
              inputPricePerMTok: num(
                env[`LLM_${prefix}_FALLBACK_IN_PRICE`],
                defaultInPrice(prefix)
              ),
              outputPricePerMTok: num(
                env[`LLM_${prefix}_FALLBACK_OUT_PRICE`],
                defaultOutPrice(prefix)
              ),
            },
          }
        : {}),
    };
  };
  return {
    FAST: route("FAST"),
    BALANCED: route("BALANCED"),
    REASONING: route("REASONING"),
  };
}

function defaultModel(prefix: string): string {
  if (prefix === "FAST") return "claude-haiku-4-5";
  if (prefix === "BALANCED") return "claude-sonnet-5";
  return "claude-opus-5";
}
function defaultInPrice(prefix: string): number {
  return prefix === "FAST" ? 1 : prefix === "BALANCED" ? 3 : 5;
}
function defaultOutPrice(prefix: string): number {
  return prefix === "FAST" ? 5 : prefix === "BALANCED" ? 15 : 25;
}
function num(v: string | undefined, d: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
}

/** Anthropic Messages API — minimal fetch adapter (no SDK dependency). */
export function anthropicAdapter(apiKey: string): ProviderAdapter {
  return {
    name: "anthropic",
    async complete({ model, messages, maxOutputTokens, timeoutMs }) {
      const system = messages
        .filter((m) => m.role === "system")
        .map((m) => m.content)
        .join("\n");
      const rest = messages.filter((m) => m.role !== "system");
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        // Abort the request when the gateway's timeout passes — otherwise a
        // hung connection outlives the TimeoutError the caller already saw.
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model,
          max_tokens: maxOutputTokens,
          ...(system ? { system } : {}),
          messages: rest.map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      if (!res.ok) throw new Error(`anthropic ${res.status}: ${await res.text()}`);
      const body = (await res.json()) as {
        content: { type: string; text?: string }[];
        usage: {
          input_tokens: number;
          output_tokens: number;
          cache_read_input_tokens?: number;
        };
      };
      return {
        text: body.content
          .filter((b) => b.type === "text")
          .map((b) => b.text ?? "")
          .join(""),
        usage: {
          inputTokens: body.usage.input_tokens,
          outputTokens: body.usage.output_tokens,
          cacheTokens: body.usage.cache_read_input_tokens ?? 0,
        },
      };
    },
  };
}

/** OpenAI chat completions — minimal fetch adapter. */
export function openaiAdapter(apiKey: string): ProviderAdapter {
  return {
    name: "openai",
    async complete({ model, messages, maxOutputTokens, timeoutMs }) {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        signal: AbortSignal.timeout(timeoutMs),
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ model, max_completion_tokens: maxOutputTokens, messages }),
      });
      if (!res.ok) throw new Error(`openai ${res.status}: ${await res.text()}`);
      const body = (await res.json()) as {
        choices: { message: { content: string } }[];
        usage: { prompt_tokens: number; completion_tokens: number };
      };
      return {
        text: body.choices[0]?.message.content ?? "",
        usage: {
          inputTokens: body.usage.prompt_tokens,
          outputTokens: body.usage.completion_tokens,
          cacheTokens: 0,
        },
      };
    },
  };
}

/** Deterministic scripted provider — used by tests and benchmarks. */
export function mockAdapter(
  script: (messages: LlmMessage[]) => string | Promise<string>,
  opts: { failTimes?: number; latencyMs?: number } = {}
): ProviderAdapter {
  let failures = opts.failTimes ?? 0;
  return {
    name: "mock",
    async complete({ messages }) {
      if (opts.latencyMs) await new Promise((r) => setTimeout(r, opts.latencyMs));
      if (failures > 0) {
        failures -= 1;
        throw new Error("mock provider transient failure");
      }
      const text = await script(messages);
      const usage: LlmUsage = {
        inputTokens: Math.ceil(messages.reduce((n, m) => n + m.content.length, 0) / 4),
        outputTokens: Math.ceil(text.length / 4),
        cacheTokens: 0,
      };
      return { text, usage };
    },
  };
}
