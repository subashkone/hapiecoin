// Per-request Content-Security-Policy with a script nonce (Next 16 "proxy", formerly middleware).
// Next reads the nonce from the CSP request header and stamps its own <script> tags with it; the root
// layout reads `x-nonce` for the theme init script.
import { NextResponse, type NextRequest } from "next/server";

export function buildCsp(nonce: string, opts: { dev: boolean; gatewayUrl: string }): string {
  const scriptSrc = ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(opts.dev ? ["'unsafe-eval'"] : [])];
  // The gateway is reached over WebSocket (frames) and plain HTTP (GET /healthz for the expiry list).
  const gatewayHttp = opts.gatewayUrl.startsWith("wss://")
    ? "https://" + opts.gatewayUrl.slice(6)
    : opts.gatewayUrl.startsWith("ws://")
      ? "http://" + opts.gatewayUrl.slice(5)
      : opts.gatewayUrl;
  const connectSrc = ["'self'", opts.gatewayUrl, gatewayHttp, ...(opts.dev ? ["ws://localhost:*", "http://localhost:*"] : [])];
  return [
    "default-src 'self'",
    `script-src ${scriptSrc.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    // the service worker and the manifest are same-origin files (ADR-082); strict-dynamic does not cover workers
    "worker-src 'self'",
    "manifest-src 'self'",
    "font-src 'self'",
    `connect-src ${connectSrc.join(" ")}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    ...(opts.dev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

export function proxy(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const csp = buildCsp(nonce, {
    dev: process.env.NODE_ENV !== "production",
    gatewayUrl: process.env["NEXT_PUBLIC_GATEWAY_URL"] ?? "ws://localhost:3002",
  });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  // Everything except Next internals (static chunks, images, the dev HMR WebSocket) and the API proxies.
  matcher: ["/((?!_next/|favicon.ico|api/|v1/).*)"],
};
