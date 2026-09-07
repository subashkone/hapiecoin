import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { VaultError, createVault, maskKey } from "./vault.js";

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
