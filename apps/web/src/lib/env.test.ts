import { afterEach, describe, expect, it } from "vitest";
import { defaultExpiries, gatewayHttpUrl, publicEnv, serverEnv } from "./env";

const saved = { ...process.env };
afterEach(() => {
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  Object.assign(process.env, saved);
});

describe("[ENV] environment parsing", () => {
  it("publicEnv falls back to development defaults", () => {
    delete process.env["NEXT_PUBLIC_GATEWAY_URL"];
    delete process.env["NEXT_PUBLIC_GOOGLE_ENABLED"];
    const env = publicEnv();
    expect(env.NEXT_PUBLIC_GATEWAY_URL).toBe("ws://localhost:3002");
    expect(env.NEXT_PUBLIC_GOOGLE_ENABLED).toBe("false");
    expect(defaultExpiries(env.NEXT_PUBLIC_DEFAULT_EXPIRIES)[0]).toBe("2026-09-11");
  });
  it("publicEnv reads overrides and rejects a bad GOOGLE flag", () => {
    process.env["NEXT_PUBLIC_GATEWAY_URL"] = "wss://gw.hapiecoin.com";
    process.env["NEXT_PUBLIC_GOOGLE_ENABLED"] = "true";
    expect(publicEnv().NEXT_PUBLIC_GATEWAY_URL).toBe("wss://gw.hapiecoin.com");
    expect(publicEnv().NEXT_PUBLIC_GOOGLE_ENABLED).toBe("true");
    process.env["NEXT_PUBLIC_GOOGLE_ENABLED"] = "yes";
    expect(() => publicEnv()).toThrow();
  });
  it("serverEnv defaults API_URL and validates it", () => {
    delete process.env["API_URL"];
    expect(serverEnv().API_URL).toBe("http://localhost:3001");
    process.env["API_URL"] = "not a url";
    expect(() => serverEnv()).toThrow();
  });
  it("gatewayHttpUrl converts ws/wss and strips a trailing slash", () => {
    expect(gatewayHttpUrl("ws://localhost:3002/")).toBe("http://localhost:3002");
    expect(gatewayHttpUrl("wss://gw.example.com")).toBe("https://gw.example.com");
  });
  it("defaultExpiries validates, de-duplicates and sorts", () => {
    expect(defaultExpiries("2026-10-30, 2026-09-25,bad,2026-09-25")).toEqual(["2026-09-25", "2026-10-30"]);
    expect(defaultExpiries("")).toEqual([]);
  });
});
