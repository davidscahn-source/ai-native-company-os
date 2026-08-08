import type { NormalizedBatch, Normalizer } from "../core/types.js";

interface GithubWebhook {
  action?: string;
  issue?: Record<string, unknown>;
  pull_request?: Record<string, unknown>;
  repository?: Record<string, unknown>;
}

/**
 * GitHub → canonical. The webhook delivery id (X-GitHub-Delivery) is the dedup key
 * at the transport layer; inside payloads we key on stable node ids.
 */
export const normalizeGithub: Normalizer = (payload: unknown): NormalizedBatch | null => {
  const ev = payload as GithubWebhook;
  const repo = ev.repository;
  if (!repo || typeof repo.full_name !== "string" || !isId(repo.id)) {
    throw new Error("malformed github event");
  }
  const repoEntity = {
    sourceType: "repository",
    sourceId: String(repo.id),
    entityType: "repository",
    displayName: repo.full_name,
    canonical: { full_name: repo.full_name },
  };

  if (ev.issue && (ev.action === "opened" || ev.action === "closed")) {
    const issue = ev.issue;
    const labels = Array.isArray(issue.labels)
      ? (issue.labels as { name?: string }[]).map((l) => l.name ?? "")
      : [];
    const isBug = labels.includes("bug");
    if (!isId(issue.id)) throw new Error("malformed github event");
    const sourceId = String(issue.id);
    const occurredAt = iso(issue.updated_at ?? issue.created_at);
    return {
      entities: [
        repoEntity,
        {
          sourceType: "issue",
          sourceId,
          entityType: isBug ? "bug" : "task",
          displayName: typeof issue.title === "string" ? issue.title : undefined,
          canonical: { number: issue.number ?? null, repo: repo.full_name, labels },
        },
      ],
      relationships: [
        { fromRef: `repository:${String(repo.id)}`, toRef: `issue:${sourceId}`, type: "contains" },
      ],
      events: [
        {
          // occurredAt is part of the key: close → reopen → close must not
          // collapse into one event, while exact payload replays still dedup.
          sourceEventId: `issue:${sourceId}:${ev.action}:${occurredAt}`,
          eventType:
            ev.action === "opened" ? (isBug ? "bug.detected" : "issue.created") : "issue.closed",
          entityRef: `issue:${sourceId}`,
          entityType: isBug ? "bug" : "task",
          occurredAt,
          payload: { number: issue.number ?? null, repo: repo.full_name },
        },
      ],
    };
  }

  if (ev.pull_request && (ev.action === "opened" || ev.action === "closed")) {
    const pr = ev.pull_request;
    if (!isId(pr.id)) throw new Error("malformed github event");
    const sourceId = String(pr.id);
    const merged = pr.merged === true;
    const occurredAt = iso(pr.updated_at ?? pr.created_at);
    return {
      entities: [
        repoEntity,
        {
          sourceType: "pull_request",
          sourceId,
          entityType: "pull_request",
          displayName: typeof pr.title === "string" ? pr.title : undefined,
          canonical: { number: pr.number ?? null, repo: repo.full_name, merged },
        },
      ],
      relationships: [
        {
          fromRef: `repository:${String(repo.id)}`,
          toRef: `pull_request:${sourceId}`,
          type: "contains",
        },
      ],
      events: [
        {
          // GitHub sends action "closed" for both close and merge; occurredAt in
          // the key keeps close → reopen → merge from dropping the merge event.
          sourceEventId: `pr:${sourceId}:${ev.action}:${occurredAt}`,
          eventType: ev.action === "opened" ? "pr.opened" : merged ? "pr.merged" : "pr.closed",
          entityRef: `pull_request:${sourceId}`,
          entityType: "pull_request",
          occurredAt,
          payload: { number: pr.number ?? null, repo: repo.full_name },
        },
      ],
    };
  }

  return null;
};

function iso(v: unknown): string {
  if (typeof v === "string") return new Date(v).toISOString();
  throw new Error("missing timestamp");
}

/** Provider ids key entities and dedup — never accept a missing one as "undefined". */
function isId(v: unknown): v is string | number {
  return (typeof v === "number" && Number.isFinite(v)) || (typeof v === "string" && v.length > 0);
}
