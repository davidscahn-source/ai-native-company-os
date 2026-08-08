import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { SqlClient } from "@companyos/db";
import { ingestPayload } from "./core/pipeline.js";
import { normalizeGithub } from "./github/normalizer.js";
import { normalizeStripe } from "./stripe/normalizer.js";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Test support: run every checked-in provider fixture through the real
 * ingestion pipeline. Used by graph/state test suites so they exercise the
 * same path production data takes — never hand-inserted rows.
 */
export async function ingestAllFixtures(client: SqlClient, tenantId: string): Promise<void> {
  for (const provider of ["stripe", "github"] as const) {
    const normalizer = provider === "stripe" ? normalizeStripe : normalizeGithub;
    const dir = join(here, provider, "fixtures");
    for (const file of readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .sort()) {
      const payload: unknown = JSON.parse(readFileSync(join(dir, file), "utf8"));
      await ingestPayload(client, tenantId, provider, `${provider}:${file}`, payload, normalizer);
    }
  }
}
