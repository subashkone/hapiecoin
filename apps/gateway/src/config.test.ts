import { describe, expect, it } from "vitest";
import { ConfigError, GatewayEnv, loadConfig } from "./config.js";

describe("[GATEWAY] config", () => {
  it("[GATEWAY] applies defaults when the environment is empty", () => {
    const config = loadConfig({});
    expect(config).toEqual({
      NODE_ENV: "development",
      GATEWAY_PORT: 3002,
      GATEWAY_HOST: "0.0.0.0",
      DELTA_REST_URL: "https://api.india.delta.exchange",
      DELTA_WS_URL: "wss://socket.india.delta.exchange",
      DELTA_WS_CHANNEL: "v2/ticker",
      DERIBIT_REST_URL: "https://www.deribit.com/api/v2",
      DERIBIT_WS_URL: "wss://www.deribit.com/ws/api/v2",
      DERIBIT_WS_INTERVAL: "100ms",
      GATEWAY_VENUES: ["delta_india"],
      WEB_URL: "http://localhost:3000",
      COALESCE_MS: 250,
      MAX_TOPICS_PER_CONN: 50,
      UNSUBSCRIBE_GRACE_MS: 30_000,
      INSTRUMENT_REFRESH_MS: 300_000,
      MAX_BUFFERED_BYTES: 1_048_576,
      MAX_CONNECTIONS_PER_IP: 20,
      GATEWAY_ROLE: "auto",
      LEADER_TTL_MS: 15_000,
      HOLD_SYNC_MS: 2_000,
      LOG_LEVEL: "info",
    });
    expect(config.REDIS_URL).toBeUndefined();
  });

  it("[GATEWAY] coerces numbers, accepts REDIS_URL and treats empty strings as unset", () => {
    const config = loadConfig({
      NODE_ENV: "production",
      GATEWAY_PORT: "0",
      REDIS_URL: "redis://localhost:6379",
      WEB_URL: "https://hapiecoin.com",
      COALESCE_MS: "100",
      MAX_TOPICS_PER_CONN: "200",
      LOG_LEVEL: "debug",
      DELTA_WS_CHANNEL: "",
      UNSUBSCRIBE_GRACE_MS: "0",
      UNRELATED: "ignored",
    });
    expect(config).toMatchObject({
      NODE_ENV: "production",
      GATEWAY_PORT: 0,
      REDIS_URL: "redis://localhost:6379",
      WEB_URL: "https://hapiecoin.com",
      COALESCE_MS: 100,
      MAX_TOPICS_PER_CONN: 200,
      LOG_LEVEL: "debug",
      DELTA_WS_CHANNEL: "v2/ticker",
      UNSUBSCRIBE_GRACE_MS: 0,
    });
    expect(config).not.toHaveProperty("UNRELATED");
  });

  it("[GATEWAY] reads process.env by default", () => {
    process.env.GATEWAY_PORT = "4444";
    try {
      expect(loadConfig().GATEWAY_PORT).toBe(4444);
    } finally {
      delete process.env.GATEWAY_PORT;
    }
  });

  it("[GATEWAY] lists every problem in a ConfigError", () => {
    const attempt = () =>
      loadConfig({
        GATEWAY_PORT: "70000",
        DELTA_REST_URL: "ftp://nope",
        DELTA_WS_URL: "http://not-a-socket",
        REDIS_URL: "http://not-redis",
        COALESCE_MS: "1",
        MAX_TOPICS_PER_CONN: "201",
        LOG_LEVEL: "loud",
        MAX_BUFFERED_BYTES: "10",
      });
    expect(attempt).toThrow(ConfigError);
    try {
      attempt();
    } catch (error) {
      const config = error as ConfigError;
      expect(config.name).toBe("ConfigError");
      expect(config.issues).toHaveLength(8);
      expect(config.issues.join("\n")).toMatch(/GATEWAY_PORT/);
      expect(config.issues.join("\n")).toMatch(/LOG_LEVEL/);
      expect(config.message).toMatch(/Invalid gateway environment/);
    }
  });

  it("[GATEWAY] the schema itself rejects unknown log levels and channels", () => {
    expect(GatewayEnv.safeParse({ LOG_LEVEL: "trace" }).success).toBe(false);
    expect(GatewayEnv.safeParse({ DELTA_WS_CHANNEL: "v3/ticker" }).success).toBe(false);
    expect(GatewayEnv.safeParse({ NODE_ENV: "staging" }).success).toBe(false);
  });
});

describe("[GATEWAY] config: ADR-062 replica settings", () => {
  it("refuses a hold sync slower than a third of the lease, accepts the roles", async () => {
    const { ConfigError, loadConfig } = await import("./config.js");
    expect(() => loadConfig({ HOLD_SYNC_MS: "6000", LEADER_TTL_MS: "15000" })).toThrow(ConfigError);
    expect(loadConfig({ HOLD_SYNC_MS: "5000", LEADER_TTL_MS: "15000" })).toMatchObject({ HOLD_SYNC_MS: 5_000 });
    expect(loadConfig({ GATEWAY_ROLE: "follower" }).GATEWAY_ROLE).toBe("follower");
    expect(() => loadConfig({ GATEWAY_ROLE: "leader" })).toThrow(ConfigError);
    expect(() => loadConfig({ LEADER_TTL_MS: "1000" })).toThrow(ConfigError);
  });
});

describe("HC-SH-122 [GATEWAY] GATEWAY_VENUES (ADR-067)", () => {
  it("parses a comma-separated list of schema venue ids, dedupes, always keeps the default venue first, and refuses an unknown one", () => {
    expect(loadConfig({ GATEWAY_VENUES: "deribit" }).GATEWAY_VENUES).toEqual(["delta_india", "deribit"]);
    expect(loadConfig({ GATEWAY_VENUES: " delta_india , deribit,deribit, " }).GATEWAY_VENUES).toEqual(["delta_india", "deribit"]);
    expect(loadConfig({ GATEWAY_VENUES: "" }).GATEWAY_VENUES).toEqual(["delta_india"]);
    expect(() => loadConfig({ GATEWAY_VENUES: "delta_india,nse" })).toThrow(/unknown venue nse/);
    expect(loadConfig({ DERIBIT_WS_INTERVAL: "agg2" }).DERIBIT_WS_INTERVAL).toBe("agg2");
    expect(() => loadConfig({ DERIBIT_REST_URL: "ftp://nope" })).toThrow();
  });
});

describe("HC-SH-133 error sink and release settings (ADR-081)", () => {
  it("reads ERROR_SINK_DSN and RELEASE, leaves them unset by default, and lists a malformed DSN", () => {
    expect(loadConfig({}).ERROR_SINK_DSN).toBeUndefined();
    expect(loadConfig({}).RELEASE).toBeUndefined();
    const config = loadConfig({ ERROR_SINK_DSN: "https://key@track.hapiecoin.com/2", RELEASE: "abc123" });
    expect(config.ERROR_SINK_DSN).toBe("https://key@track.hapiecoin.com/2");
    expect(config.RELEASE).toBe("abc123");
    expect(() => loadConfig({ ERROR_SINK_DSN: "not a url" })).toThrow(/ERROR_SINK_DSN/);
  });
});
