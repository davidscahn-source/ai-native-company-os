import type { Queryable } from "@companyos/db";
import type { LlmGateway } from "@companyos/llm";
import type { CompanyStateSnapshot, StateDelta } from "@companyos/state";
import type { AnswerabilityVerdict } from "./answerability.js";
import { assessAnswerability } from "./answerability.js";
import type { ContextOptions, ContextPackage } from "./context.js";
import { buildContext, renderContext } from "./context.js";
import type { InsightDraft } from "./insight.js";
import { parseInsightDrafts } from "./insight.js";
import { briefSystemPrompt, renderDelta } from "./brief.js";
import { saveInsights, validateInsights } from "./validator.js";

/**
 * Ask v1 (M3b §3): "Ask my company" one question at a time.
 * The answerability verdict is computed BEFORE any model call and the model
 * cannot override it:
 * - NOT_ANSWERABLE  → deterministic refusal, zero LLM calls, zero cost
 * - PARTIALLY       → the verdict (and what's missing) is injected as a hard
 *                     constraint the response must acknowledge
 */

export const ASK_HARNESS_VERSION = "ask-v1.0";

export interface AskResult {
  harnessVersion: string;
  question: string;
  verdict: AnswerabilityVerdict;
  /** false = refused deterministically; no model was consulted */
  modelConsulted: boolean;
  insights: InsightDraft[];
  rejected: { draft: InsightDraft; reason: string }[];
  context: ContextPackage | null;
}

export interface AskOptions {
  runId: string;
  staleAfterMs?: number;
  askedAt?: string;
  persist?: boolean;
  /** window/budget knobs; questionClass is always taken from the verdict */
  context?: Omit<ContextOptions, "questionClass">;
  /** Harness B: include a precomputed StateDelta as extra context (the ONE A/B variable) */
  delta?: StateDelta;
}

export async function askCompany(
  tx: Queryable,
  gateway: LlmGateway,
  tenantId: string,
  question: string,
  snapshot: CompanyStateSnapshot,
  opts: AskOptions
): Promise<AskResult> {
  const verdictOpts: { staleAfterMs?: number; askedAt?: string } = {};
  if (opts.staleAfterMs !== undefined) verdictOpts.staleAfterMs = opts.staleAfterMs;
  if (opts.askedAt !== undefined) verdictOpts.askedAt = opts.askedAt;
  const verdict = assessAnswerability(question, snapshot, verdictOpts);

  if (verdict.verdict === "NOT_ANSWERABLE") {
    return {
      harnessVersion: ASK_HARNESS_VERSION,
      question,
      verdict,
      modelConsulted: false,
      insights: [],
      rejected: [],
      context: null,
    };
  }

  const pkg = await buildContext(tx, snapshot, {
    ...opts.context,
    questionClass: verdict.questionClass,
  });
  const constraint =
    verdict.verdict === "PARTIALLY_ANSWERABLE"
      ? `\nHARD CONSTRAINT (non-negotiable): this question is only PARTIALLY answerable.` +
        ` Missing sources: ${JSON.stringify(verdict.missingSources)};` +
        ` stale sources: ${JSON.stringify(verdict.staleSources)}.` +
        ` You MUST include at least one "unknown" insight naming what cannot be answered and why.`
      : "";

  const res = await gateway.complete({
    tenantId,
    runId: opts.runId,
    agentKey: "ask",
    profile: "BALANCED",
    messages: [
      { role: "system", content: briefSystemPrompt() },
      {
        role: "user",
        content: `${renderContext(pkg)}${renderDelta(opts.delta)}${constraint}\n\nQuestion: ${question}\nAnswer with insight JSON only.`,
      },
    ],
  });

  const drafts = parseInsightDrafts(res.text);
  const { accepted, rejected } = await validateInsights(tx, drafts);
  if (opts.persist !== false) {
    await saveInsights(tx, opts.runId, ASK_HARNESS_VERSION, snapshot.sourceWatermark, accepted);
  }

  return {
    harnessVersion: ASK_HARNESS_VERSION,
    question,
    verdict,
    modelConsulted: true,
    insights: accepted,
    rejected,
    context: pkg,
  };
}
