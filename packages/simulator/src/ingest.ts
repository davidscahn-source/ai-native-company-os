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
export async function ingestCompany(
  db: SqlClient,
  tenantId: string,
  company: GeneratedCompany
): Promise<{ ingested: number; failed: number }> {
  let ingested = 0;
  let failed = 0;
  for (const p of company.payloads) {
    const normalizer = p.provider === "stripe" ? normalizeStripe : normalizeGithub;
    const result = await ingestPayload(db, tenantId, p.provider, p.dedupKey, p.payload, normalizer);
    if (result.failed) failed += 1;
    else ingested += 1;
  }
  return { ingested, failed };
}
