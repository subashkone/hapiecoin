// Process entrypoint: `pnpm dev` (tsx watch) and `pnpm start` (node dist/main.js).
import { serve } from "@hono/node-server";
import { Redis } from "ioredis";
import { createApp } from "./app.js";
import { AUTH_BASE_PATH, authOptionsPublic, createAuth, sessionResolver } from "./auth.js";
import { loadConfig } from "./config.js";
import { createDb } from "./db/client.js";
import { seed } from "./db/seed.js";
import { DeltaTradingClientImpl } from "@hapiecoin/venues";
import { DeltaPrivateClientImpl } from "./delta/private-client.js";
import { loadRepoEnv } from "./env-file.js";
import { createLogger } from "./logger.js";
import { createMailer } from "./mailer.js";
import { MemoryRateStore, type RateStore, RedisRateStore } from "./security/rate-store.js";
import { createVault } from "./vault.js";

loadRepoEnv(import.meta.url);
const config = loadConfig();
const logger = createLogger({ level: config.logLevel, base: { env: config.nodeEnv } });

const handle = await createDb({ databaseUrl: config.databaseUrl, pgliteDataDir: config.pgliteDataDir });
await handle.migrate();
if (config.isDev) {
  const result = await seed(handle.db);
  logger.info({ result }, "development seed applied");
}

let rateStore: RateStore = new MemoryRateStore();
let redis: Redis | undefined;
if (config.redisUrl !== undefined) {
  redis = new Redis(config.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 2 });
  await redis.connect();
  rateStore = new RedisRateStore(redis);
}

const auth = createAuth({
  config,
  db: handle.db,
  mailer: createMailer({
    resendApiKey: config.resendApiKey,
    from: config.emailFrom,
    logger,
    nodeEnv: config.nodeEnv,
  }),
  rateStore,
  logger,
});

const app = createApp({
  config,
  db: handle.db,
  dbKind: handle.kind,
  ping: () => handle.ping(),
  auth,
  authBasePath: AUTH_BASE_PATH,
  sessions: sessionResolver(auth),
  rateStore,
  logger,
  vault: createVault(config.credentialsEncKey),
  delta: new DeltaPrivateClientImpl({ baseUrl: config.deltaTradingRestUrl, nodeEnv: config.nodeEnv }),
  trading: new DeltaTradingClientImpl({ baseUrl: config.deltaTradingRestUrl, nodeEnv: config.nodeEnv }),
  authOptions: authOptionsPublic(config),
});

const server = serve({ fetch: app.fetch, port: config.apiPort }, (info) => {
  logger.info(
    {
      port: info.port,
      db: handle.kind,
      redis: redis !== undefined,
      docs: config.isProd ? null : `${config.betterAuthUrl}/v1/docs`,
    },
    "HapieCoin API listening",
  );
});

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, "shutting down");
  server.close();
  await redis?.quit();
  await handle.close();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
