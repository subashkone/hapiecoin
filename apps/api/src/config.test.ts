import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "./config.js";

const BASE = {
  NODE_ENV: "test",
  BETTER_AUTH_SECRET: "0123456789abcdef0123456789abcdef",
  CREDENTIALS_ENC_KEY: Buffer.alloc(32, 1).toString("base64"),
};

describe("[CONFIG] environment parsing", () => {
  it("applies defaults and derives flags", () => {
    const c = loadConfig(BASE, { warn: () => undefined });
    expect(c.apiPort).toBe(3001);
    expect(c.isTest).toBe(true);
    expect(c.isDev).toBe(false);
    expect(c.isProd).toBe(false);
    expect(c.webUrl).toBe("http://localhost:3000");
    // Auth URLs are built on the web origin (ADR-019) unless BETTER_AUTH_URL overrides it.
    expect(c.betterAuthUrl).toBe("http://localhost:3000");
    expect(loadConfig({ ...BASE, BETTER_AUTH_URL: "https://api.example.com" }).betterAuthUrl).toBe(
      "https://api.example.com",
    );
    expect(c.trustedProxyIps).toEqual([]);
    expect(loadConfig({ ...BASE, TRUSTED_PROXY_IPS: " 127.0.0.1, ::1 ,," }).trustedProxyIps).toEqual([
      "127.0.0.1",
      "::1",
    ]);
    expect(c.deltaRestUrl).toBe("https://api.india.delta.exchange");
    expect(c.egressIp).toBe("172.236.179.136");
    expect(c.emailFrom).toContain("HapieCoin");
    expect(c.logLevel).toBe("silent");
    expect(c.google).toBeUndefined();
    expect(c.credentialsEncKey.equals(Buffer.alloc(32, 1))).toBe(true);
  });

  it("treats empty strings as unset (Google button hidden when either value is blank)", () => {
    const c = loadConfig(
      { ...BASE, GOOGLE_CLIENT_ID: "abc", GOOGLE_CLIENT_SECRET: "  " },
      { warn: () => undefined },
    );
    expect(c.google).toBeUndefined();
    const d = loadConfig(
      { ...BASE, GOOGLE_CLIENT_ID: "abc", GOOGLE_CLIENT_SECRET: "xyz" },
      { warn: () => undefined },
    );
    expect(d.google).toEqual({ clientId: "abc", clientSecret: "xyz" });
  });

  it("generates ephemeral secrets in development with a warning", () => {
    const warnings: string[] = [];
    const c = loadConfig({ NODE_ENV: "development" }, { warn: (m) => warnings.push(m) });
    expect(c.betterAuthSecret.length).toBeGreaterThanOrEqual(32);
    expect(c.credentialsEncKey.length).toBe(32);
    expect(c.logLevel).toBe("info");
    expect(warnings.some((w) => w.includes("BETTER_AUTH_SECRET"))).toBe(true);
    expect(warnings.some((w) => w.includes("CREDENTIALS_ENC_KEY"))).toBe(true);
  });

  it("derives a stable development encryption key from BETTER_AUTH_SECRET when CREDENTIALS_ENC_KEY is unset or empty (GAPS #42)", () => {
    const warnings: string[] = [];
    const warn = (m: string) => warnings.push(m);
    const a = loadConfig({ NODE_ENV: "development", BETTER_AUTH_SECRET: "stable-dev-secret-of-32-characters!!" }, { warn });
    const b = loadConfig({ NODE_ENV: "development", BETTER_AUTH_SECRET: "stable-dev-secret-of-32-characters!!", CREDENTIALS_ENC_KEY: "  " }, { warn });
    const other = loadConfig({ NODE_ENV: "development", BETTER_AUTH_SECRET: "another-dev-secret-of-32-characters!" }, { warn });
    expect(a.credentialsEncKey.length).toBe(32);
    expect(a.credentialsEncKey.equals(b.credentialsEncKey)).toBe(true);
    expect(a.credentialsEncKey.equals(other.credentialsEncKey)).toBe(false);
    expect(warnings.length).toBe(3);
    expect(warnings.every((w) => w.includes("derived from BETTER_AUTH_SECRET"))).toBe(true);
  });

  it("uses console.warn by default for ephemeral secrets", () => {
    const original = console.warn;
    const lines: string[] = [];
    console.warn = (m: string) => {
      lines.push(m);
    };
    try {
      loadConfig({ NODE_ENV: "development" });
    } finally {
      console.warn = original;
    }
    expect(lines.length).toBe(2);
  });

  it("[GAPS-23] [GAPS-25] production requires a real database and a mail transport, and warns without Redis", () => {
    const prod = {
      NODE_ENV: "production",
      BETTER_AUTH_SECRET: BASE.BETTER_AUTH_SECRET,
      CREDENTIALS_ENC_KEY: BASE.CREDENTIALS_ENC_KEY,
      DATABASE_URL: "postgres://u:p@db:5432/hapiecoin",
      RESEND_API_KEY: "re_live",
      REDIS_URL: "redis://cache:6379",
    };
    expect(() => loadConfig({ ...prod, DATABASE_URL: undefined })).toThrow(/DATABASE_URL is required in production/);
    expect(() => loadConfig({ ...prod, RESEND_API_KEY: undefined })).toThrow(/RESEND_API_KEY is required in production/);
    const warnings: string[] = [];
    expect(loadConfig({ ...prod, REDIS_URL: undefined }, { warn: (m) => warnings.push(m) }).redisUrl).toBeUndefined();
    expect(warnings.some((w) => w.includes("REDIS_URL"))).toBe(true);
    expect(loadConfig(prod, { warn: () => undefined }).isProd).toBe(true);
  });

  it("requires secrets in production", () => {
    expect(() =>
      loadConfig({ NODE_ENV: "production", CREDENTIALS_ENC_KEY: BASE.CREDENTIALS_ENC_KEY }),
    ).toThrow(/BETTER_AUTH_SECRET/);
    expect(() => loadConfig({ NODE_ENV: "production", BETTER_AUTH_SECRET: BASE.BETTER_AUTH_SECRET })).toThrow(
      /CREDENTIALS_ENC_KEY/,
    );
  });

  it("rejects malformed values with every issue listed", () => {
    expect(() => loadConfig({ ...BASE, API_PORT: "99999", WEB_URL: "not a url" })).toThrow(ConfigError);
    try {
      loadConfig({ ...BASE, API_PORT: "99999", WEB_URL: "not a url", CREDENTIALS_ENC_KEY: "short" });
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain("API_PORT");
      expect(msg).toContain("WEB_URL");
      expect(msg).toContain("CREDENTIALS_ENC_KEY");
    }
    expect(() => loadConfig({ ...BASE, BETTER_AUTH_SECRET: "too-short" })).toThrow(/at least 32/);
  });

  it("[TRADING-SAFETY] throws at boot when live Delta keys are present in the test env", () => {
    expect(() => loadConfig({ ...BASE, DELTA_API_KEY: "live-key" })).toThrow(/trading safety/);
    expect(() => loadConfig({ ...BASE, DELTA_API_SECRET: "live-secret" })).toThrow(/trading safety/);
    // Development may carry keys (they are still never read by the API).
    expect(() =>
      loadConfig({ ...BASE, NODE_ENV: "development", DELTA_API_KEY: "k" }, { warn: () => undefined }),
    ).not.toThrow();
  });
});

describe("ADR-054 CREDENTIALS_ENC_KEYS_PREVIOUS", () => {
  it("parses the comma-separated previous keys, drops one equal to the current key, refuses a malformed entry", () => {
    const old1 = Buffer.alloc(32, 7).toString("base64");
    const old2 = Buffer.alloc(32, 9).toString("base64");
    const c = loadConfig({ ...BASE, CREDENTIALS_ENC_KEYS_PREVIOUS: ` ${old1} , ${old2},${BASE.CREDENTIALS_ENC_KEY} ` }, { warn: () => undefined });
    expect(c.credentialsPrevKeys.map((k) => k.toString("base64"))).toEqual([old1, old2]);
    expect(loadConfig(BASE, { warn: () => undefined }).credentialsPrevKeys).toEqual([]);
    expect(() => loadConfig({ ...BASE, CREDENTIALS_ENC_KEYS_PREVIOUS: "short" }, { warn: () => undefined })).toThrow(/CREDENTIALS_ENC_KEYS_PREVIOUS entry #1/);
  });
});
