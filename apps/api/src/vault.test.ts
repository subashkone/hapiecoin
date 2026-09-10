import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { VaultError, createKeyring, createVault, keyIdOf, maskKey } from "./vault.js";

const KEY = randomBytes(32);

describe("HC-SH-033 credential vault (AES-256-GCM)", () => {
  it("round-trips and uses a fresh IV per record", () => {
    const vault = createVault(KEY);
    const a = vault.seal("delta-secret-1");
    const b = vault.seal("delta-secret-1");
    expect(vault.open(a)).toBe("delta-secret-1");
    expect(vault.open(b)).toBe("delta-secret-1");
    expect(a.iv).not.toBe(b.iv);
    expect(a.ct).not.toBe(b.ct);
    expect(Buffer.from(a.iv, "base64").length).toBe(12);
    expect(Buffer.from(a.tag, "base64").length).toBe(16);
    expect(a.ct).not.toContain("delta-secret");
  });

  it("detects tampering with the ciphertext, the tag and the IV", () => {
    const vault = createVault(KEY);
    const sealed = vault.seal("hunter2-hunter2");
    const flip = (b64: string) => {
      const buf = Buffer.from(b64, "base64");
      buf[0] = (buf[0] ?? 0) ^ 0xff;
      return buf.toString("base64");
    };
    expect(() => vault.open({ ...sealed, ct: flip(sealed.ct) })).toThrow(VaultError);
    expect(() => vault.open({ ...sealed, tag: flip(sealed.tag) })).toThrow(/tampered/);
    expect(() => vault.open({ ...sealed, iv: flip(sealed.iv) })).toThrow(VaultError);
  });

  it("refuses records sealed under a different key and malformed records", () => {
    const sealed = createVault(KEY).seal("secret");
    expect(() => createVault(randomBytes(32)).open(sealed)).toThrow(VaultError);
    expect(() => createVault(KEY).open({ iv: "AAAA", tag: sealed.tag, ct: sealed.ct })).toThrow(/malformed/);
    expect(() => createVault(KEY).open({ iv: sealed.iv, tag: "AAAA", ct: sealed.ct })).toThrow(/malformed/);
  });

  it("rejects keys that are not 32 bytes", () => {
    expect(() => createVault(Buffer.alloc(16))).toThrow(/32 bytes/);
  });

  it("accepts an injectable IV source (deterministic in tests)", () => {
    const vault = createVault(KEY, (n) => Buffer.alloc(n, 3));
    const a = vault.seal("x");
    const b = vault.seal("x");
    expect(a).toEqual(b);
  });

  it("maskKey shows only the last four characters", () => {
    expect(maskKey("abcdefgh1234")).toBe("****1234");
    expect(maskKey("ab")).toMatch(/^\*{4}[A-Za-z0-9]{4}$/);
  });
});

describe("ADR-054 key rotation (GAPS #10)", () => {
  const OLD = randomBytes(32);
  const NEW = randomBytes(32);
  it("stamps every record with the current key id; a keyring opens records under the current and previous keys", () => {
    const before = createVault(OLD);
    const sealed = before.seal("delta-secret");
    expect(sealed.kid).toBe(keyIdOf(OLD));
    expect(before.kid).toBe(keyIdOf(OLD));
    expect(keyIdOf(OLD)).toMatch(/^[0-9a-f]{8}$/);
    const ring = createKeyring(NEW, [OLD]);
    expect(ring.kid).toBe(keyIdOf(NEW));
    expect(ring.open(sealed)).toBe("delta-secret");
    expect(ring.isCurrent(sealed)).toBe(false);
    const resealed = ring.seal(ring.open(sealed));
    expect(resealed.kid).toBe(keyIdOf(NEW));
    expect(ring.isCurrent(resealed)).toBe(true);
    // the old single-key vault cannot open the new record; a ring without the old key cannot open the old one
    expect(() => before.open(resealed)).toThrow(/no key for kid/);
    expect(() => createKeyring(NEW).open(sealed)).toThrow(/no key for kid/);
  });
  it("opens legacy records without a key id by trying the current key, then the previous ones", () => {
    const legacy = { ...createVault(OLD).seal("legacy-secret"), kid: null };
    expect(createKeyring(NEW, [OLD]).open(legacy)).toBe("legacy-secret");
    expect(createKeyring(OLD, [NEW]).open(legacy)).toBe("legacy-secret");
    expect(() => createKeyring(NEW).open(legacy)).toThrow(/key changed/);
    expect(createKeyring(NEW, [OLD]).isCurrent(legacy)).toBe(false);
    expect(() => createKeyring(NEW, [OLD]).open({ ...legacy, iv: "AAAA" })).toThrow(/malformed/);
  });
  it("refuses previous keys that are not 32 bytes and ignores a previous key equal to the current one", () => {
    expect(() => createKeyring(NEW, [Buffer.alloc(8)])).toThrow(/previous vault key #1 must be 32 bytes/);
    const ring = createKeyring(NEW, [NEW, OLD]);
    expect(ring.open(createVault(OLD).seal("x"))).toBe("x");
  });
});
