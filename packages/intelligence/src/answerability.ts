import type { CompanyStateSnapshot } from "@companyos/state";

/**
 * Answerability Engine (M3 §3). Deterministic: consumes connected sources and
 * snapshot completeness/watermark. The model can NEVER override the verdict —
 * the response generator receives it as a hard input.
 */

export type Answerability = "ANSWERABLE" | "PARTIALLY_ANSWERABLE" | "NOT_ANSWERABLE";

export type QuestionClass =
  "what_changed" | "what_to_worry" | "revenue_risk" | "engineering_activity" | "missing_data";

/** Which sources each supported question class depends on. */
const REQUIRED_SOURCES: Record<QuestionClass, string[]> = {
  what_changed: ["stripe", "github"],
  what_to_worry: ["stripe", "github"],
  revenue_risk: ["stripe"],
  engineering_activity: ["github"],
  missing_data: [],
};

export interface AnswerabilityVerdict {
  verdict: Answerability;
  questionClass: QuestionClass | null;
  missingSources: string[];
  staleSources: string[];
}

export function classifyQuestion(question: string): QuestionClass | null {
  const q = question.toLowerCase();
  if (/(what changed|뭐가 달라|무엇이 변했|어제와)/.test(q)) return "what_changed";
  if (/(worry|걱정|주의|봐야 할)/.test(q)) return "what_to_worry";
  if (/(revenue|매출|결제|payment|churn)/.test(q)) return "revenue_risk";
  if (/(deploy|incident|배포|장애|bug|버그|engineering)/.test(q)) return "engineering_activity";
  if (/(missing|없는 데이터|연결 안|부족한)/.test(q)) return "missing_data";
  return null;
}

export function assessAnswerability(
  question: string,
  snapshot: CompanyStateSnapshot,
  opts: { staleAfterMs?: number; askedAt?: string } = {}
): AnswerabilityVerdict {
  const questionClass = classifyQuestion(question);
  if (questionClass === null) {
    return { verdict: "NOT_ANSWERABLE", questionClass: null, missingSources: [], staleSources: [] };
  }

  const required = REQUIRED_SOURCES[questionClass];
  const missingSources = required.filter((s) => snapshot.completeness[s] !== true);

  const staleSources: string[] = [];
  if (opts.staleAfterMs !== undefined && opts.askedAt !== undefined) {
    const askedAtMs = new Date(opts.askedAt).getTime();
    for (const s of required) {
      const wm = snapshot.sourceWatermark[s];
      if (wm && askedAtMs - new Date(wm).getTime() > opts.staleAfterMs) staleSources.push(s);
    }
  }

  if (missingSources.length === required.length && required.length > 0) {
    return { verdict: "NOT_ANSWERABLE", questionClass, missingSources, staleSources };
  }
  if (missingSources.length > 0 || staleSources.length > 0) {
    return { verdict: "PARTIALLY_ANSWERABLE", questionClass, missingSources, staleSources };
  }
  return { verdict: "ANSWERABLE", questionClass, missingSources, staleSources };
}
