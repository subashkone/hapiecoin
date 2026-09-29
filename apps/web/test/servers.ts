// Starts the mock API (:3101) and the fake gateway (:3102) for Playwright or a manual `pnpm mock:servers`.
// Ports come from MOCK_API_PORT / MOCK_GATEWAY_PORT so the e2e config and next dev agree.
// The visual suite (playwright.visual.config.ts, ADR-096) pins this process: MOCK_CLOCK_AT (the ISO instant the clock
// starts at, then flowing at real speed: the mock API's stamps, the replay instants and the analytics series then never
// depend on the real day or hour; a clock that stands still would stall the mock's per-minute windows),
// MOCK_CALENDAR=recorded (the gateway serves the recording as recorded instead of moved to the real day) and
// MOCK_TICK_MS=0 (no ticks: every price is the fixture's).
import { serve } from "@hono/node-server";
import { RECORDED_TODAY, yesterdayIso } from "./expiry-shift";
import { startFakeGateway } from "./fake-gateway";

const apiPort = Number(process.env["MOCK_API_PORT"] ?? 3101);
const gatewayPort = Number(process.env["MOCK_GATEWAY_PORT"] ?? 3102);
const realNow = Date.now();
const clockAt = process.env["MOCK_CLOCK_AT"];
const clockOffset = clockAt ? Date.parse(clockAt) - realNow : 0;
if (clockAt && Number.isNaN(clockOffset)) throw new Error(`MOCK_CLOCK_AT is not an ISO instant: ${clockAt}`);
if (clockAt) {
  // the same Proxy as test/setup.ts: a plain `Date()` call still answers a string, instanceof holds, statics pass through
  const RealDate = Date;
  const shiftedNow = () => RealDate.now() + clockOffset;
  globalThis.Date = new Proxy(RealDate, {
    construct(target, args: unknown[], newTarget) {
      return Reflect.construct(target, args.length === 0 ? [shiftedNow()] : args, newTarget) as object;
    },
    apply() {
      return new RealDate(shiftedNow()).toString();
    },
    get(target, prop, receiver) {
      return prop === "now" ? shiftedNow : (Reflect.get(target, prop, receiver) as unknown);
    },
  });
  console.warn(`[mock-api] clock pinned: now ${new Date().toISOString()}`);
}
// imported after the clock swap so the mock API's module-level clocks (mock-analytics NOW) and `new Date(...)` defaults
// see the pinned one (the fake gateway, imported above, reads the clock only when it serves)
const { createMockApi } = await import("./mock-api");
const calendarEnv = process.env["MOCK_CALENDAR"];
if (calendarEnv !== undefined && calendarEnv !== "recorded" && calendarEnv !== "shifted") throw new Error(`MOCK_CALENDAR must be recorded or shifted: ${calendarEnv}`);
if (clockAt && calendarEnv !== "recorded") throw new Error("MOCK_CLOCK_AT needs MOCK_CALENDAR=recorded: a pinned clock with expiries moved to the real day is weeks apart");
const calendar = calendarEnv === "recorded" ? undefined : yesterdayIso(realNow);
const tickEnv = process.env["MOCK_TICK_MS"];
const tickMs = tickEnv === undefined ? undefined : Number(tickEnv);
if (tickMs !== undefined && (tickEnv === "" || !Number.isFinite(tickMs) || tickMs < 0)) throw new Error(`MOCK_TICK_MS must be a number of milliseconds, 0 or more: ${tickEnv}`);

const { app } = createMockApi();
serve({ fetch: app.fetch, port: apiPort, hostname: "127.0.0.1" }, (info) => {
  console.warn(`[mock-api] http://127.0.0.1:${info.port}`);
});

// the recording served as of the REAL today (GAPS #114), or as recorded for the pinned visual run
startFakeGateway({ port: gatewayPort, today: RECORDED_TODAY, ...(calendar === undefined ? {} : { shiftTo: calendar }), ...(tickMs === undefined ? {} : { tickMs }) })
  .then((gw) => console.warn(`[fake-gateway] ${gw.url} (GET /healthz for expiries; calendar ${calendar ?? "as recorded"}, ticks ${tickMs ?? 500} ms)`))
  .catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
