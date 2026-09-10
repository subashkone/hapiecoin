/**
 * Credential vault: AES-256-GCM under the CREDENTIALS_ENC_KEY (spec "Exchange API keys"), with key rotation
 * (ADR-054, GAPS #10): the keyring holds the current key plus any previous keys from CREDENTIALS_ENC_KEYS_PREVIOUS.
 * Every record carries the id of the key that sealed it (`kid`, the first 8 hex chars of SHA-256(key)); `open`
 * picks that key, `seal` always uses the current one, and `isCurrent` tells callers when a record should be
 * re-sealed (`openCredential` does that lazily; `pnpm db:reseal` does it for every row).
 *
 * Every `seal()` draws a fresh 12-byte IV, so the same plaintext never produces the same ciphertext
 * and GCM's nonce-reuse weakness cannot occur even when the API key and secret are encrypted separately.
 * The 16-byte auth tag is stored next to the ciphertext; any bit flip in iv, tag or ciphertext makes
 * `open()` throw `VaultError` instead of returning garbage.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { maskApiKey } from "@hapiecoin/schema";

export interface Sealed {
  /** base64, 12 bytes */
  iv: string;
  /** base64, 16 bytes */
  tag: string;
  /** base64 ciphertext */
  ct: string;
  /** Id of the key that sealed the record; absent on rows written before rotation existed (opened with the current key first, then the previous ones). */
  kid?: string | null | undefined;
}

export class VaultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VaultError";
  }
}

export interface Vault {
  /** The id of the key new records are sealed under. */
  readonly kid: string;
  seal(plaintext: string): Sealed & { kid: string };
  open(sealed: Sealed): string;
  /** False when the record was sealed under a previous key (or none): re-seal it when convenient. */
  isCurrent(sealed: Pick<Sealed, "kid">): boolean;
}

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Stable, non-secret id of a key: the first 8 hex characters of its SHA-256. */
export function keyIdOf(key: Buffer): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 8);
}

function assertKey(key: Buffer, what: string): void {
  if (key.length !== 32) throw new VaultError(`${what} must be 32 bytes, got ${key.length}`);
}

function openWith(key: Buffer, sealed: Sealed): string {
  const iv = Buffer.from(sealed.iv, "base64");
  const tag = Buffer.from(sealed.tag, "base64");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new VaultError("malformed sealed record");
  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(Buffer.from(sealed.ct, "base64")), decipher.final()]).toString("utf8");
  } catch {
    throw new VaultError("authentication failed: record was tampered with or the key changed");
  }
}

/** A vault over the current key and the previous keys still allowed to open old records (newest first). */
export function createKeyring(current: Buffer, previous: readonly Buffer[] = [], randomIv: (bytes: number) => Buffer = randomBytes): Vault {
  assertKey(current, "vault key");
  previous.forEach((k, i) => assertKey(k, `previous vault key #${i + 1}`));
  const kid = keyIdOf(current);
  const byId = new Map<string, Buffer>([[kid, current]]);
  for (const k of previous) if (!byId.has(keyIdOf(k))) byId.set(keyIdOf(k), k);
  return {
    kid,
    seal(plaintext) {
      const iv = randomIv(IV_BYTES);
      const cipher = createCipheriv(ALGORITHM, current, iv, { authTagLength: TAG_BYTES });
      const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
      return { iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ct: ct.toString("base64"), kid };
    },
    open(sealed) {
      if (sealed.kid) {
        const key = byId.get(sealed.kid);
        if (!key) throw new VaultError(`no key for kid ${sealed.kid}: add it to CREDENTIALS_ENC_KEYS_PREVIOUS or reconnect`);
        return openWith(key, sealed);
      }
      // a record from before key ids: the current key first, then each previous key
      let last = new VaultError("no key could open the record");
      for (const key of byId.values()) {
        try {
          return openWith(key, sealed);
        } catch (e) {
          const err = e as VaultError; // openWith throws nothing else
          if (err.message.startsWith("malformed")) throw err;
          last = err;
        }
      }
      throw last;
    },
    isCurrent(sealed) {
      return sealed.kid === kid;
    },
  };
}

/** A single-key vault (no previous keys); kept for callers and tests that never rotate. */
export function createVault(key: Buffer, randomIv: (bytes: number) => Buffer = randomBytes): Vault {
  return createKeyring(key, [], randomIv);
}

/** Public form of an API key: four asterisks + last four characters (schema `ApiKeyMasked`). */
export function maskKey(apiKey: string): string {
  return maskApiKey(apiKey);
}
