import type { SqlClient } from "@companyos/db";
import { ingestPayload, normalizeGithub, normalizeStripe } from "@companyos/connectors";
import type { GeneratedCompany } from "./ground-truth.js";

/**
 * Feeds a generated company through the REAL ingestion pipeline (normalizer →
 * entities → events → relationships), so the lab exercises the shipped path.
 *
 * Generate once per seed and reuse the tenant across scenarios: re-ingesting
 * thousands of payloads per scenario is what turns a 20-second CI run into a
 * 20-minute one.
 */
export interface IngestSummary {
  /** produced canonical rows */
  ingested: number;
  /** normalizer threw — the payload was routed to failed */
  failed: number;
  /** dedup key already seen */
  duplicate: number;
  /** normalizer returned null (unhandled type) */
  ignored: number;
}

export async function ingestCompany(
  db: SqlClient,
  tenantId: string,
  company: GeneratedCompany
): Promise<IngestSummary> {
  // Counted separately on purpose: folding duplicate/ignored into "ingested"
  // would let a normalizer that silently ignores every invoice still report
  // a fully successful load.
  const summary: IngestSummary = { ingested: 0, failed: 0, duplicate: 0, ignored: 0 };
  for (const p of company.payloads) {
    const normalizer = p.provider === "stripe" ? normalizeStripe : normalizeGithub;
    const result = await ingestPayload(db, tenantId, p.provider, p.dedupKey, p.payload, normalizer);
    if (result.failed) summary.failed += 1;
    else if (result.duplicate) summary.duplicate += 1;
    else if (result.ignored) summary.ignored += 1;
    else summary.ingested += 1;
  }
  return summary;
}
