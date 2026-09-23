// Starts the mock API (:3101) and the fake gateway (:3102) for Playwright or a manual `pnpm mock:servers`.
// Ports come from MOCK_API_PORT / MOCK_GATEWAY_PORT so the e2e config and next dev agree.
import { serve } from "@hono/node-server";
import { createMockApi } from "./mock-api";
import { RECORDED_TODAY, yesterdayIso } from "./expiry-shift";
import { startFakeGateway } from "./fake-gateway";

const apiPort = Number(process.env["MOCK_API_PORT"] ?? 3101);
const gatewayPort = Number(process.env["MOCK_GATEWAY_PORT"] ?? 3102);

const { app } = createMockApi();
serve({ fetch: app.fetch, port: apiPort, hostname: "127.0.0.1" }, (info) => {
  console.warn(`[mock-api] http://127.0.0.1:${info.port}`);
});

startFakeGateway({ port: gatewayPort, today: RECORDED_TODAY, shiftTo: yesterdayIso() }) // the recording, served as of today (GAPS #114)
  .then((gw) => console.warn(`[fake-gateway] ${gw.url} (GET /healthz for expiries)`))
  .catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
