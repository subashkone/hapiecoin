/**
 * HapieCoin market-data gateway boot. Environment is validated by `loadConfig`; SIGTERM/SIGINT close every
 * connection with 1001, drop the venue subscriptions and exit (hard exit after 5 s if a socket hangs).
 */
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";

const app = createApp(loadConfig());

let stopping = false;
function shutdown(signal: string): void {
  if (stopping) return;
  stopping = true;
  app.log.info("shutting down", { signal });
  const guard = setTimeout(() => process.exit(1), 5_000);
  guard.unref();
  app
    .stop()
    .then(() => process.exit(0))
    .catch((error: unknown) => {
      app.log.error("shutdown failed", { error: error as Error });
      process.exit(1);
    });
}
process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));

app.start().catch((error: unknown) => {
  console.error("gateway failed to start:", error);
  process.exit(1);
});
