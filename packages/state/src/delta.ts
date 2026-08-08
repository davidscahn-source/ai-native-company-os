import type { CompanyState, CompanyStateSnapshot } from "./projector.js";

export interface StateChange {
  metric: keyof CompanyState;
  before: number;
  after: number;
  change: number;
}

export interface StateDelta {
  from: string;
  to: string;
  changes: StateChange[];
}

/**
 * Pure, deterministic diff between two snapshots.
 * This is what "what changed since yesterday?" is computed from —
 * the DB answers "what", the LLM (M3+) only explains "why".
 */
export function computeDelta(prev: CompanyStateSnapshot, next: CompanyStateSnapshot): StateDelta {
  const changes: StateChange[] = [];
  for (const key of Object.keys(next.state) as (keyof CompanyState)[]) {
    const before = prev.state[key] ?? 0;
    const after = next.state[key];
    if (before !== after) {
      changes.push({ metric: key, before, after, change: after - before });
    }
  }
  return { from: prev.capturedUntil, to: next.capturedUntil, changes };
}
