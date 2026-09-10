// `pnpm db:reseal` — after rotating CREDENTIALS_ENC_KEY (old key in CREDENTIALS_ENC_KEYS_PREVIOUS), re-seal every
// stored exchange credential under the current key (ADR-054). Prints counts only; never a key or a secret.
import { loadConfig } from "../config.js";
import { resealCredentials } from "../credentials-reseal.js";
import { createKeyring } from "../vault.js";
import { createDb } from "./client.js";

const config = loadConfig();
const handle = await createDb({ databaseUrl: config.databaseUrl, pgliteDataDir: config.pgliteDataDir });
const vault = createKeyring(config.credentialsEncKey, config.credentialsPrevKeys);
const report = await resealCredentials(handle.db, vault);
console.warn(`[reseal] kid=${vault.kid} scanned=${report.scanned} current=${report.current} resealed=${report.resealed} unreadable=${report.unreadable.length}`);
if (report.unreadable.length) console.warn(`[reseal] rows no key could open (owners must reconnect): ${report.unreadable.join(", ")}`);
await handle.close();
