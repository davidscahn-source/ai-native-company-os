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
  if (!repo || typeof repo.full_name !== "string") throw new Error("malformed github event");
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
    const sourceId = String(issue.id);
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
      events: [
        {
          sourceEventId: `issue:${sourceId}:${ev.action}`,
          eventType:
            ev.action === "opened" ? (isBug ? "bug.detected" : "issue.created") : "issue.closed",
          entityRef: `issue:${sourceId}`,
          entityType: isBug ? "bug" : "task",
          occurredAt: iso(issue.updated_at ?? issue.created_at),
          payload: { number: issue.number ?? null, repo: repo.full_name },
        },
      ],
    };
  }

  if (ev.pull_request && (ev.action === "opened" || ev.action === "closed")) {
    const pr = ev.pull_request;
    const sourceId = String(pr.id);
    const merged = pr.merged === true;
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
      events: [
        {
          sourceEventId: `pr:${sourceId}:${ev.action}`,
          eventType: ev.action === "opened" ? "pr.opened" : merged ? "pr.merged" : "pr.closed",
          entityRef: `pull_request:${sourceId}`,
          entityType: "pull_request",
          occurredAt: iso(pr.updated_at ?? pr.created_at),
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
