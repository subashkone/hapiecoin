// HC-SH-033: API secrets never leave the server. This test walks every exported schema and asserts that no
// shape, anywhere, carries a field named "apiSecret" (or any other secret-looking name).
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import * as schema from "./index.js";

const FORBIDDEN = ["apiSecret", "api_secret", "secret", "password", "passwordHash"];

/** Collect every object key reachable from a schema definition. */
function collectKeys(node: unknown, out: Set<string>, seen = new Set<unknown>()): void {
  if (typeof node !== "object" || node === null || seen.has(node)) return;
  seen.add(node);
  const rec = node as Record<string, unknown>;
  const def = (rec["def"] ?? rec) as Record<string, unknown>;
  if (def["shape"] && typeof def["shape"] === "object") {
    for (const [key, child] of Object.entries(def["shape"] as Record<string, unknown>)) {
      out.add(key);
      collectKeys(child, out, seen);
    }
  }
  for (const field of ["innerType", "element", "keyType", "valueType", "in", "out", "left", "right"]) {
    if (def[field]) collectKeys(def[field], out, seen);
  }
  if (Array.isArray(def["options"])) for (const o of def["options"]) collectKeys(o, out, seen);
}

const exportedSchemas = Object.entries(schema as Record<string, unknown>).filter(
  (entry): entry is [string, z.ZodType] => entry[1] instanceof z.ZodType,
);

describe("HC-SH-033 no schema exposes an API secret", () => {
  it("exports at least the schemas named in the brief", () => {
    const names = exportedSchemas.map(([name]) => name);
    for (const n of [
      "DecimalString",
      "IsoDate",
      "Timestamp",
      "Venue",
      "Underlying",
      "Currency",
      "PnlBasis",
      "Role",
      "Instrument",
      "Greeks",
      "Quote",
      "ExpiryCode",
      "ChainRow",
      "ChainSnapshot",
      "Topic",
      "ClientMessage",
      "ServerMessage",
      "QuoteDelta",
      "User",
      "UserSettings",
      "Broker",
      "BrokerCredentialPublic",
      "ApiError",
    ]) {
      expect(names).toContain(n);
    }
  });

  it("no exported schema shape contains a forbidden key", () => {
    const keys = new Set<string>();
    for (const [, s] of exportedSchemas) collectKeys(s, keys);
    collectKeys(schema.paginated(schema.BrokerCredentialPublic), keys);
    expect(keys.size).toBeGreaterThan(40);
    for (const bad of FORBIDDEN) expect([...keys]).not.toContain(bad);
    expect(keys.has("apiKeyMasked")).toBe(true);
  });

  it("the JSON-schema projection of every exported schema is free of 'apiSecret'", () => {
    let projected = 0;
    for (const [, s] of exportedSchemas) {
      const json = JSON.stringify(z.toJSONSchema(s, { unrepresentable: "any" }));
      expect(json).not.toMatch(/apiSecret/i);
      projected += 1;
    }
    expect(projected).toBe(exportedSchemas.length);
  });

  it("the source of src/ never mentions apiSecret outside this test", () => {
    const dir = new URL("./", import.meta.url);
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".ts") || file === "secrets.test.ts") continue;
      const text = readFileSync(new URL(file, dir), "utf8");
      if (file === "accounts.test.ts") continue; // asserts that a secret is rejected
      expect(text, file).not.toMatch(/apiSecret/);
    }
  });
});
