// `pnpm db:seed` — development seed (refuses to run in production).
import { loadConfig } from "../config.js";
import { createDb } from "./client.js";
import { seed } from "./seed.js";

const config = loadConfig();
if (config.isProd) {
  console.error("[db] refusing to seed a production database");
  process.exit(1);
}
const handle = await createDb({ databaseUrl: config.databaseUrl, pgliteDataDir: config.pgliteDataDir });
await handle.migrate();
const result = await seed(handle.db);
console.warn(`[db] seed (${handle.kind}): ${JSON.stringify(result)}`);
await handle.close();
