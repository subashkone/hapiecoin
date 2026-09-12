import { describe, expect, it } from "vitest";
import { DURATION_BUCKETS, createApiMetrics } from "./metrics.js";

describe("HC-SH-133 API metrics in Prometheus text (ADR-081)", () => {
  it("counts requests by method, route pattern and status, buckets latency cumulatively, and leaves the probes out", () => {
    const now = { value: 10_000 };
    const m = createApiMetrics({ now: () => now.value, memory: () => ({ rss: 123, heapUsed: 45 }) });
    m.request("GET", "/v1/me", 200, 0.004);
    m.request("GET", "/v1/me", 200, 0.03);
    m.request("POST", "/v1/strategies/:id/live", 400, 0.2);
    m.request("GET", "/metrics", 200, 0.001);
    m.request("GET", "/healthz", 200, 0.001);
    m.error("unhandled");
    m.error("unhandled");
    m.error("browser");
    now.value += 65_000;
    const text = m.render({ jobsActive: true, sink: { sent: 2, dropped: 1, failed: 0 } });
    const lines = text.split("\n");
    expect(lines).toContain('hapiecoin_api_requests_total{method="GET",route="/v1/me",status="200"} 2');
    expect(lines).toContain('hapiecoin_api_requests_total{method="POST",route="/v1/strategies/:id/live",status="400"} 1');
    expect(text).not.toContain('route="/metrics"');
    expect(text).not.toContain('route="/healthz"');
    expect(lines).toContain('hapiecoin_api_request_duration_seconds_bucket{route="/v1/me",le="0.005"} 1');
    expect(lines).toContain('hapiecoin_api_request_duration_seconds_bucket{route="/v1/me",le="0.05"} 2');
    expect(lines).toContain('hapiecoin_api_request_duration_seconds_bucket{route="/v1/me",le="+Inf"} 2');
    expect(lines).toContain('hapiecoin_api_request_duration_seconds_sum{route="/v1/me"} 0.034');
    expect(lines).toContain('hapiecoin_api_request_duration_seconds_count{route="/v1/me"} 2');
    expect(lines).toContain('hapiecoin_api_request_duration_seconds_bucket{route="/v1/strategies/:id/live",le="0.1"} 0');
    expect(lines).toContain('hapiecoin_api_request_duration_seconds_bucket{route="/v1/strategies/:id/live",le="0.25"} 1');
    expect(lines).toContain('hapiecoin_api_errors_total{kind="unhandled"} 2');
    expect(lines).toContain('hapiecoin_api_errors_total{kind="browser"} 1');
    expect(lines).toContain('hapiecoin_api_error_sink_events_total{outcome="sent"} 2');
    expect(lines).toContain('hapiecoin_api_error_sink_events_total{outcome="dropped"} 1');
    expect(lines).toContain("hapiecoin_api_jobs_active 1");
    expect(lines).toContain("hapiecoin_api_uptime_seconds 65");
    expect(lines).toContain("process_resident_memory_bytes 123");
    expect(lines).toContain("nodejs_heap_size_used_bytes 45");
    expect(text.endsWith("\n")).toBe(true);
    expect(text.match(/# TYPE /g)).toHaveLength(8);
    expect(DURATION_BUCKETS[0]).toBe(0.005);
  });

  it("escapes label values, renders the empty registry, the sink block only when given, and real process gauges by default", () => {
    const m = createApiMetrics();
    const empty = m.render();
    expect(empty).toContain("# TYPE hapiecoin_api_requests_total counter\n# TYPE hapiecoin_api_request_duration_seconds histogram\n# TYPE hapiecoin_api_errors_total counter\n# TYPE hapiecoin_api_jobs_active gauge\nhapiecoin_api_jobs_active 0");
    expect(empty).not.toContain("error_sink");
    expect(empty).toMatch(/process_resident_memory_bytes [1-9]\d*\n/);
    expect(empty).toMatch(/nodejs_heap_size_used_bytes [1-9]\d*\n/);
    m.request("GET", 'we"ird\\\n', 200, 1.5);
    expect(m.render()).toContain('hapiecoin_api_requests_total{method="GET",route="we\\"ird\\\\\\n",status="200"} 1');
    expect(m.render()).toContain('hapiecoin_api_request_duration_seconds_sum{route="we\\"ird\\\\\\n"} 1.5');
  });
});
