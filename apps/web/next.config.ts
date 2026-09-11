import type { NextConfig } from "next";

/**
 * Security headers are set per request in src/proxy.ts (CSP needs a fresh nonce); the static ones live here.
 * `style-src 'unsafe-inline'` is required because Tailwind v4 + Radix set inline `style` attributes
 * (transforms, popper positioning) and React streams `<style>` for CSS-in-JS-free primitives; scripts stay
 * nonce-only with 'strict-dynamic'. Documented requirement, revisit when Radix supports nonce'd styles.
 */
const staticHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const apiUrl = process.env["API_URL"] ?? "http://localhost:3001";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // `next dev` serves dev-only assets (chunks, HMR socket) to its own origin only; Playwright and curl use 127.0.0.1.
  allowedDevOrigins: ["127.0.0.1"],
  poweredByHeader: false,
  // No raster images are used; the optimizer would only add a server route.
  images: { unoptimized: true },
  reactCompiler: true,
  transpilePackages: ["@hapiecoin/ui", "@hapiecoin/schema", "@hapiecoin/pricing", "@hapiecoin/venues"],
  // `@hapiecoin/schema` and `@hapiecoin/pricing` sources use TypeScript-style `./x.js` imports for `.ts` files;
  // Turbopack in `next dev` follows the package's `development` export condition to src/ and cannot map that
  // extension, so dev resolves the built dist (the same file `next build` picks through the `import` condition).
  // Build the packages first: `pnpm --filter @hapiecoin/schema --filter @hapiecoin/pricing build` (the turbo
  // `build`/`typecheck` tasks already depend on it).
  turbopack: {
    resolveAlias: {
      "@hapiecoin/schema": "./node_modules/@hapiecoin/schema/dist/index.js",
      "@hapiecoin/pricing": "./node_modules/@hapiecoin/pricing/dist/index.js",
      // only the browser-safe core of the venue port (ADR-064); the package root pulls in node:crypto
      "@hapiecoin/venues/core": "./node_modules/@hapiecoin/venues/dist/port/core.js",
    },
  },
  headers() {
    return Promise.resolve([{ source: "/(.*)", headers: staticHeaders }]);
  },
  // Same-origin API: Better Auth cookies and /v1 calls never cross origins in the browser.
  rewrites() {
    return Promise.resolve([
      { source: "/api/auth/:path*", destination: `${apiUrl}/v1/auth/:path*` },
      { source: "/v1/:path*", destination: `${apiUrl}/v1/:path*` },
    ]);
  },
};

export default nextConfig;
