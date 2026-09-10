// Key rotation end to end (ADR-054, GAPS #10): rows carry the key id, a keyring with the previous key opens them
// and re-seals on first live use, `resealCredentials` walks every row, and a row under a key nobody holds asks the
// owner to reconnect.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { resealCredentials } from "./credentials-reseal.js";
import { brokerCredentials } from "./db/schema.js";
import { SEED } from "./db/seed.js";
import { createTestApp, type TestApp } from "./test-support/harness.js";
import { createKeyring, keyIdOf } from "./vault.js";

let t: TestApp;
let cookie: string;
const API_KEY = "rotate-key-ABCD1a2b";
const API_SECRET = "rotate-secret-xyz";
const row = async () => (await t.db.select().from(brokerCredentials).where(eq(brokerCredentials.brokerId, SEED.brokerId)))[0]!;
const positions = () => t.request(`/v1/strategies/live/positions?brokerId=${SEED.brokerId}`, { cookie });

beforeAll(async () => {
  t = await createTestApp();
  cookie = (await t.signUp("rotate@hapiecoin.test")).cookie;
  t.delta.accept(API_KEY);
  t.trading.setBalances([{ asset: "USD", balance: "5000", availableBalance: "4000" }]);
  expect((await t.request("/v1/credentials", { cookie, json: { brokerId: SEED.brokerId, apiKey: API_KEY, apiSecret: API_SECRET } })).status).toBe(201);
});
afterAll(() => t.close());

describe("ADR-054 credential key rotation", () => {
  it("stores the current key id with the record", async () => {
    const r = await row();
    expect(r.keyId).toBe(t.vault.kid);
    expect(r.keyId).toBe(keyIdOf(t.deps.config.credentialsEncKey));
  });

  it("after a rotation the previous key opens the row and the first live use re-seals it under the new key", async () => {
    const oldKey = t.deps.config.credentialsEncKey;
    const newKey = randomBytes(32);
    t.deps.vault = createKeyring(newKey, [oldKey]);
    const before = await row();
    expect((await positions()).status).toBe(200);
    const after = await row();
    expect(after.keyId).toBe(keyIdOf(newKey));
    expect(after.apiKeyCt).not.toBe(before.apiKeyCt);
    expect(after.apiSecretCt).not.toBe(before.apiSecretCt);
    // a re-seal that fails (a vault that cannot seal) only logs: the live call still succeeds and the row is untouched
    const stale = createKeyring(randomBytes(32), [newKey]);
    t.deps.vault = { ...stale, seal: () => { throw new Error("seal unavailable"); } };
    expect((await positions()).status).toBe(200);
    expect((await row()).keyId).toBe(keyIdOf(newKey));
    // the re-sealed row opens with the new key alone; the secret is intact
    t.deps.vault = createKeyring(newKey);
    expect((await positions()).status).toBe(200);
    expect(t.deps.vault.open({ ct: after.apiSecretCt, iv: after.apiSecretIv, tag: after.apiSecretTag, kid: after.keyId })).toBe(API_SECRET);
    expect(JSON.stringify(after)).not.toContain(API_SECRET);
  });

  it("resealCredentials re-seals legacy rows (no key id) and counts rows no key can open", async () => {
    const current = t.deps.vault;
    // a legacy row: sealed under the current key but without a key id, as rows written before ADR-054 are
    await t.db.update(brokerCredentials).set({ keyId: null }).where(eq(brokerCredentials.brokerId, SEED.brokerId));
    const legacy = await resealCredentials(t.db, current);
    expect(legacy).toEqual({ scanned: 1, current: 0, resealed: 1, unreadable: [] });
    expect((await row()).keyId).toBe(current.kid);
    expect(await resealCredentials(t.db, current)).toEqual({ scanned: 1, current: 1, resealed: 0, unreadable: [] });
    // a ring without the sealing key cannot re-seal: the row is reported, never touched
    const stranger = createKeyring(randomBytes(32));
    const r = await row();
    expect(await resealCredentials(t.db, stranger)).toEqual({ scanned: 1, current: 0, resealed: 0, unreadable: [r.id] });
    expect((await row()).apiKeyCt).toBe(r.apiKeyCt);
    // and a live call under that ring tells the owner to reconnect
    t.deps.vault = stranger;
    const res = await positions();
    expect(res.status).toBe(409);
    expect(((await res.json()) as { message: string }).message).toContain("Reconnect it in Settings");
    t.deps.vault = current;
    expect((await positions()).status).toBe(200);
  });
});
