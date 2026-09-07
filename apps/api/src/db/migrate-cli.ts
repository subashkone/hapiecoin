// `pnpm db:migrate` — apply committed migrations to DATABASE_URL (or the PGlite data dir in development).
import { loadConfig } from "../config.js";
import { createDb } from "./client.js";

const config = loadConfig();
const handle = await createDb({ databaseUrl: config.databaseUrl, pgliteDataDir: config.pgliteDataDir });
await handle.migrate();
console.warn(`[db] migrations applied (${handle.kind})`);
await handle.close();
