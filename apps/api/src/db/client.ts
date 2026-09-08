/**
 * Driver factory. PGlite (embedded Postgres, in-memory or on disk) when DATABASE_URL is unset —
 * development and tests run with no external service — and postgres-js against PostgreSQL otherwise.
 * Both return the same Drizzle `Db` type so the rest of the API never knows which is underneath.
 */
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { migrate as migratePostgres } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { schema, type Schema } from "./schema.js";

export type Db = PgDatabase<PgQueryResultHKT, Schema>;

export type DbKind = "pglite" | "postgres";

/** Arbitrary but fixed key for the migration advisory lock (shared by every API replica). */
export const MIGRATION_LOCK_KEY = 727_001;

export interface DbHandle {
  db: Db;
  kind: DbKind;
  /** Apply every migration under drizzle/ that has not run yet. */
  migrate(): Promise<void>;
  /** Cheap liveness probe (`select 1`). */
  ping(): Promise<boolean>;
  close(): Promise<void>;
}

export interface CreateDbOptions {
  /** PostgreSQL connection string; PGlite is used when absent. */
  databaseUrl?: string | undefined;
  /** PGlite only: persist to this directory instead of memory. */
  pgliteDataDir?: string | undefined;
  /** Override the migrations folder (default: <package>/drizzle). */
  migrationsFolder?: string | undefined;
}

/** Absolute path of the committed migrations, valid from src/ (tsx) and dist/ (node). */
export function defaultMigrationsFolder(): string {
  return fileURLToPath(new URL("../../drizzle/", import.meta.url));
}

export async function createDb(opts: CreateDbOptions = {}): Promise<DbHandle> {
  const migrationsFolder = opts.migrationsFolder ?? defaultMigrationsFolder();

  if (opts.databaseUrl !== undefined) {
    const client = postgres(opts.databaseUrl, { max: 10, prepare: false });
    const db = drizzlePostgres(client, { schema, casing: "snake_case" });
    return {
      db,
      kind: "postgres",
      // GAPS #30: replicas booting together serialise on a transaction-level advisory lock, so only one
      // applies the migrations while the others wait and then find nothing left to do.
      migrate: () =>
        client.begin(async (tx) => {
          await tx`select pg_advisory_xact_lock(${MIGRATION_LOCK_KEY})`;
          await migratePostgres(db, { migrationsFolder });
        }),
      ping: () => ping(db),
      close: () => client.end({ timeout: 5 }),
    };
  }

  // Development and tests only: PGlite is a devDependency and is not shipped in the production image
  // (GAPS #30); production refuses to boot without DATABASE_URL (ADR-019), so this branch never runs there.
  const [{ PGlite }, { drizzle: drizzlePglite }, { migrate: migratePglite }] = await Promise.all([
    import("@electric-sql/pglite"),
    import("drizzle-orm/pglite"),
    import("drizzle-orm/pglite/migrator"),
  ]);
  const client =
    opts.pgliteDataDir === undefined ? await PGlite.create() : await PGlite.create(opts.pgliteDataDir);
  const db = drizzlePglite(client, { schema, casing: "snake_case" });
  return {
    db,
    kind: "pglite",
    migrate: () => migratePglite(db, { migrationsFolder }),
    ping: () => ping(db),
    close: () => client.close(),
  };
}

async function ping(db: Db): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}
