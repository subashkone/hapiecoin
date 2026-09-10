// Starts the REAL API (apps/api) and the REAL gateway (apps/gateway) for the smoke run (ADR-055, GAPS #20),
// plus a tiny sidecar that hands the smoke test the OTP the capture mailer logged (the API never exposes it).
// Ports: API SMOKE_API_PORT (3201), gateway SMOKE_GATEWAY_PORT (3202), sidecar SMOKE_SIDECAR_PORT (3203).
// The database is PGlite in memory unless SMOKE_DATABASE_URL points at Postgres (`pnpm db:up`); Redis likewise
// through SMOKE_REDIS_URL. Trading is disabled and no exchange key is present: nothing here can place an order.
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..", "..", "..");
const apiPort = Number(process.env["SMOKE_API_PORT"] ?? 3201);
const gatewayPort = Number(process.env["SMOKE_GATEWAY_PORT"] ?? 3202);
const sidecarPort = Number(process.env["SMOKE_SIDECAR_PORT"] ?? 3203);
const webUrl = `http://localhost:${process.env["SMOKE_WEB_PORT"] ?? 3200}`;

const otps = new Map<string, string>();
const children: ChildProcess[] = [];

function start(name: string, cwd: string, env: Record<string, string>): ChildProcess {
  // one command string: with `shell: true` separate args are only concatenated (Node DEP0190)
  const child = spawn(`pnpm exec tsx ${name === "api" ? "src/main.ts" : "src/index.ts"}`, {
    cwd,
    env: { ...process.env, ...env },
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const onLine = (line: string) => {
    if (!line.trim()) return;
    // `[mail] to=<email> otp=<code> type=<purpose>` from the capture mailer (development only; never Resend)
    const m = /\[mail\] to=(\S+) otp=(\d{6})/.exec(line);
    if (m) otps.set(m[1]!.toLowerCase(), m[2]!);
    // the capture mailer prints the code (development only); the sidecar keeps it out of this console
    const shown = line.replace(/otp=\d{6}/, "otp=******");
    console.warn(`[${name}] ${shown.length > 300 ? shown.slice(0, 300) + "…" : shown}`);
  };
  for (const stream of [child.stdout, child.stderr]) {
    let buf = "";
    stream?.on("data", (chunk: Buffer) => {
      buf += chunk.toString("utf8");
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() ?? "";
      lines.forEach(onLine);
    });
  }
  child.on("exit", (code) => console.warn(`[${name}] exited with ${code}`));
  children.push(child);
  return child;
}

start("api", path.join(repo, "apps", "api"), {
  NODE_ENV: "development",
  API_PORT: String(apiPort),
  WEB_URL: webUrl,
  BETTER_AUTH_URL: webUrl,
  BETTER_AUTH_SECRET: process.env["SMOKE_AUTH_SECRET"] ?? randomBytes(32).toString("base64url"),
  CREDENTIALS_ENC_KEY: randomBytes(32).toString("base64"),
  TRADING_DISABLED: "1",
  LOG_LEVEL: "info",
  ...(process.env["SMOKE_DATABASE_URL"] ? { DATABASE_URL: process.env["SMOKE_DATABASE_URL"] } : { DATABASE_URL: "", PGLITE_DATA_DIR: "" }),
  ...(process.env["SMOKE_REDIS_URL"] ? { REDIS_URL: process.env["SMOKE_REDIS_URL"] } : { REDIS_URL: "" }),
  RESEND_API_KEY: "",
  DELTA_API_KEY: "",
  DELTA_API_SECRET: "",
});
start("gateway", path.join(repo, "apps", "gateway"), {
  NODE_ENV: "development",
  GATEWAY_PORT: String(gatewayPort),
  GATEWAY_HOST: "127.0.0.1",
  WEB_URL: webUrl,
  LOG_LEVEL: "info",
  REDIS_URL: "",
});

async function ok(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2_000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${sidecarPort}`);
  if (url.pathname === "/healthz") {
    const [api, gateway] = await Promise.all([ok(`http://127.0.0.1:${apiPort}/healthz`), ok(`http://127.0.0.1:${gatewayPort}/healthz`)]);
    res.writeHead(api && gateway ? 200 : 503, { "content-type": "application/json" });
    res.end(JSON.stringify({ api, gateway }));
    return;
  }
  if (url.pathname === "/otp") {
    const otp = otps.get((url.searchParams.get("email") ?? "").toLowerCase());
    res.writeHead(otp ? 200 : 404, { "content-type": "application/json" });
    res.end(JSON.stringify(otp ? { otp } : { error: "no otp yet" }));
    return;
  }
  res.writeHead(404);
  res.end();
}
const sidecar = createServer((req, res) => {
  void handle(req, res);
});
sidecar.listen(sidecarPort, "127.0.0.1", () => console.warn(`[smoke] sidecar http://127.0.0.1:${sidecarPort} (healthz once api + gateway answer)`));

function stopAll() {
  for (const c of children) {
    if (c.pid === undefined || c.exitCode !== null) continue;
    if (process.platform === "win32") spawn("taskkill", ["/pid", String(c.pid), "/T", "/F"], { stdio: "ignore", shell: true });
    else c.kill("SIGTERM");
  }
}
for (const sig of ["SIGINT", "SIGTERM", "exit"] as const) process.on(sig, () => stopAll());
