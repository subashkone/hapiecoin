/** HapieCoin analytics ingest boot. Environment is validated by `loadConfig`; SIGTERM/SIGINT stop the schedule and close the store. */
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { loadRepoEnv } from "./env-file.js";

loadRepoEnv(import.meta.url);
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
  console.error("ingest failed to start:", error);
  process.exit(1);
});
