import { describe, expect, it } from "vitest";
import { buildCsp } from "./proxy";

describe("[SECURITY] Content-Security-Policy", () => {
  it("nonces scripts, forbids framing and allows the gateway over ws and http (healthz)", () => {
    const csp = buildCsp("abc", { dev: false, gatewayUrl: "wss://gw.hapiecoin.com" });
    expect(csp).toContain("script-src 'self' 'nonce-abc' 'strict-dynamic'");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).toContain("connect-src 'self' wss://gw.hapiecoin.com https://gw.hapiecoin.com");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("upgrade-insecure-requests");
  });
  it("HC-SH-135 allows the same-origin service worker and manifest (ADR-082)", () => {
    const csp = buildCsp("abc", { dev: false, gatewayUrl: "wss://gw.hapiecoin.com" });
    expect(csp).toContain("worker-src 'self'");
    expect(csp).toContain("manifest-src 'self'");
  });
  it("adds eval and localhost origins in development only", () => {
    const csp = buildCsp("n", { dev: true, gatewayUrl: "ws://127.0.0.1:3102" });
    expect(csp).toContain("'unsafe-eval'");
    expect(csp).toContain("ws://127.0.0.1:3102 http://127.0.0.1:3102 ws://localhost:* http://localhost:*");
    expect(csp).not.toContain("upgrade-insecure-requests");
  });
});
