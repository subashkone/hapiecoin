// Process entrypoint: `pnpm dev` (tsx watch) and `pnpm start` (node dist/main.js).
import { serve } from "@hono/node-server";
import { startReconciler } from "./live-reconcile.js";
import { type JobStarter, startJobs } from "./jobs.js";
import { MemoryLeaderLock, RedisLeaderLock } from "./leader.js";
import type { AppDeps } from "./routes/shared.js";
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
import { RazorpayHttpClient } from "./razorpay.js";
import { MemoryRateStore, type RateStore, RedisRateStore } from "./security/rate-store.js";
import { createKeyring } from "./vault.js";
import { startIvSnapshotter } from "./iv-snapshot.js";
import { snapshotSpotSource, startSettler } from "./settlement.js";
import { startRulesEngine } from "./rules-engine.js";
import { evaluateAlerts } from "./alerts-evaluate.js";
import { TelegramBotClient } from "./telegram.js";
import { startTelegramLinker } from "./routes/telegram.js";
import { DeltaRestClient, isSchemaInstrument, toSchemaInstrument, toSchemaQuote } from "@hapiecoin/venues";
import { MemoryAnalyticsReader, RedisAnalyticsReader } from "./analytics.js";

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

const mailer = createMailer({
  resendApiKey: config.resendApiKey,
  from: config.emailFrom,
  logger,
  nodeEnv: config.nodeEnv,
});
const auth = createAuth({ config, db: handle.db, mailer, rateStore, logger });

const deps: AppDeps = {
  config,
  db: handle.db,
  dbKind: handle.kind,
  ping: () => handle.ping(),
  auth,
  authBasePath: AUTH_BASE_PATH,
  sessions: sessionResolver(auth),
  mailer,
  razorpay: config.razorpay ? new RazorpayHttpClient({ ...config.razorpay, nodeEnv: config.nodeEnv }) : null,
  rateStore,
  logger,
  vault: createKeyring(config.credentialsEncKey, config.credentialsPrevKeys),
  delta: new DeltaPrivateClientImpl({ baseUrl: config.deltaTradingRestUrl, nodeEnv: config.nodeEnv }),
  trading: new DeltaTradingClientImpl({ baseUrl: config.deltaTradingRestUrl, nodeEnv: config.nodeEnv }),
  authOptions: authOptionsPublic(config),
  analytics: redis ? new RedisAnalyticsReader(redis) : new MemoryAnalyticsReader(),
  // ADR-057: the bot token never leaves the client; without it the telegram channel is not offered
  telegram: config.telegramBotToken ? new TelegramBotClient(config.telegramBotToken, { nodeEnv: config.nodeEnv, logger }) : null,
};
const app = createApp(deps);

// ADR-062: the background jobs run in exactly one API replica (Redis leader lease; the memory lock without Redis);
// tests drive reconcilePending, the snapshotter and the linker directly, so none start under test
const publicRest = new DeltaRestClient({ baseUrl: config.deltaRestUrl });
const starters: JobStarter[] = [];
// ADR-029: pending venue orders are reconciled in the background
starters.push({ name: "reconciler", start: () => startReconciler(deps, config.trading.reconcileMs) });
// ADR-056: the IV history snapshotter reads public option tickers (no key) every IV_SNAPSHOT_MS; 0 turns it off
if (config.ivSnapshotMs !== 0)
  starters.push({
    name: "iv-snapshotter",
    start: () =>
      startIvSnapshotter(
        deps,
        {
          // the venue shapes cross the schema adapter (GAPS #8); a ticker without a spot carries "0" and is skipped as a spot source
          products: async () => (await publicRest.getProducts({ contractTypes: ["call_options", "put_options"], states: ["live"] })).filter(isSchemaInstrument).map(toSchemaInstrument),
          tickers: async (u) => (await publicRest.getTickers({ contractTypes: ["call_options", "put_options"], underlying: u })).map((q) => toSchemaQuote(q, "0")),
        },
        config.ivSnapshotMs,
        // ADR-057: every snapshot evaluates the armed alerts server-side, so they fire with the app closed
        async () => {
          const report = await evaluateAlerts(deps);
          if (report.fired.length) logger.info({ fired: report.fired, checked: report.checked }, "alerts fired server-side");
        },
      ),
  });
// ADR-059 §2.4: legs past their expiry settle at intrinsic value from the spot at the settlement instant; 0 turns it
// off. Registered like the snapshotter so only the leader replica books settlements (ADR-062).
if (config.settlementMs !== 0)
  starters.push({
    name: "settler",
    start: () =>
      startSettler(
        deps,
        snapshotSpotSource(deps, async (u) => {
          const q = (await publicRest.getTickers({ contractTypes: ["call_options", "put_options"], underlying: u })).map((x) => toSchemaQuote(x, "0")).find((x) => Number(x.spot) > 0);
          return q ? Number(q.spot) : null;
        }),
        config.settlementMs,
      ),
  });
// ADR-059 §2.3: stop / target rules judged from the venue's public marks every RULES_TICK_MS (0 turns it off); one
// request per underlying per tick, options and the perpetual together, keyed by venue symbol
if (config.rulesTickMs !== 0)
  starters.push({
    name: "rules",
    start: () =>
      startRulesEngine(
        deps,
        {
          marks: async (u) => {
            const quotes = await publicRest.getTickers({ contractTypes: ["call_options", "put_options", "perpetual_futures"], underlying: u });
            return new Map(
              quotes.map((q) => {
                const sq = toSchemaQuote(q, "0");
                return [sq.instrumentId.slice(sq.instrumentId.indexOf(":") + 1), Number(sq.mark)];
              }),
            );
          },
        },
        config.rulesTickMs,
      ),
  });
// ADR-057: link Telegram chats through the bot's /start messages (long-polled; no public URL needed)
if (deps.telegram !== null) starters.push({ name: "telegram-linker", start: () => startTelegramLinker(deps) });
const jobs = startJobs({
  role: config.nodeEnv === "test" ? "off" : config.jobsRole,
  lock: redis ? new RedisLeaderLock(redis) : new MemoryLeaderLock(),
  ttlMs: config.leaderTtlMs,
  starters,
  log: logger,
});
deps.jobsStatus = () => jobs.status();

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
  await jobs.stop();
  server.close();
  await redis?.quit();
  await handle.close();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
