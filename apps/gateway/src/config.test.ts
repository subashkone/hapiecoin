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
      WEB_URL: "http://localhost:3000",
      COALESCE_MS: 250,
      MAX_TOPICS_PER_CONN: 50,
      UNSUBSCRIBE_GRACE_MS: 30_000,
      INSTRUMENT_REFRESH_MS: 300_000,
      MAX_BUFFERED_BYTES: 1_048_576,
      MAX_CONNECTIONS_PER_IP: 20,
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
