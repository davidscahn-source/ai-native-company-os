import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/** Anything that can run parameterized SQL. All repo code depends only on this. */
export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}

export interface SqlClient extends Queryable {
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/**
 * The only way application code touches data-plane tables.
 * Sets app.tenant_id transaction-locally; RLS (FORCED) does the rest —
 * even a buggy query inside `fn` cannot cross tenants.
 */
export async function withTenant<T>(
  client: SqlClient,
  tenantId: string,
  fn: (tx: Queryable) => Promise<T>
): Promise<T> {
  return client.transaction(async (tx) => {
    await tx.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
    return fn(tx);
  });
}

/** In-memory Postgres (PGlite) — used by tests and local dev. Prod driver lands in M2. */
export async function createTestClient(): Promise<SqlClient> {
  const pg = new PGlite();
  const here = dirname(fileURLToPath(import.meta.url));
  const dir = join(here, "..", "migrations");
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    await pg.exec(readFileSync(join(dir, file), "utf8"));
  }
  // Superusers bypass RLS entirely; the app must never be one. Mirror production
  // (Supabase app role) by demoting this session to a plain role.
  await pg.exec(`
    create role app_role;
    grant select, insert, update, delete on all tables in schema public to app_role;
    set role app_role;
  `);
  return {
    async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
      const res = await pg.query<T>(sql, params as never[]);
      return res.rows;
    },
    async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
      return pg.transaction(async (t) => {
        const tx: Queryable = {
          async query<U>(sql: string, params?: unknown[]): Promise<U[]> {
            const res = await t.query<U>(sql, params as never[]);
            return res.rows;
          },
        };
        return fn(tx);
      }) as Promise<T>;
    },
    async close() {
      await pg.close();
    },
  };
}
