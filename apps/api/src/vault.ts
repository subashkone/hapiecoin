/**
 * Credential vault: AES-256-GCM under the CREDENTIALS_ENC_KEY (spec "Exchange API keys").
 *
 * Every `seal()` draws a fresh 12-byte IV, so the same plaintext never produces the same ciphertext
 * and GCM's nonce-reuse weakness cannot occur even when the API key and secret are encrypted separately.
 * The 16-byte auth tag is stored next to the ciphertext; any bit flip in iv, tag or ciphertext makes
 * `open()` throw `VaultError` instead of returning garbage.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { maskApiKey } from "@hapiecoin/schema";

export interface Sealed {
  /** base64, 12 bytes */
  iv: string;
  /** base64, 16 bytes */
  tag: string;
  /** base64 ciphertext */
  ct: string;
}

export class VaultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VaultError";
  }
}

export interface Vault {
  seal(plaintext: string): Sealed;
  open(sealed: Sealed): string;
}

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;

export function createVault(key: Buffer, randomIv: (bytes: number) => Buffer = randomBytes): Vault {
  if (key.length !== 32) throw new VaultError(`vault key must be 32 bytes, got ${key.length}`);
  return {
    seal(plaintext) {
      const iv = randomIv(IV_BYTES);
      const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
      const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
      return {
        iv: iv.toString("base64"),
        tag: cipher.getAuthTag().toString("base64"),
        ct: ct.toString("base64"),
      };
    },
    open(sealed) {
      const iv = Buffer.from(sealed.iv, "base64");
      const tag = Buffer.from(sealed.tag, "base64");
      if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new VaultError("malformed sealed record");
      const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
      decipher.setAuthTag(tag);
      try {
        return Buffer.concat([decipher.update(Buffer.from(sealed.ct, "base64")), decipher.final()]).toString(
          "utf8",
        );
      } catch {
        throw new VaultError("authentication failed: record was tampered with or the key changed");
      }
    },
  };
}

/** Public form of an API key: four asterisks + last four characters (schema `ApiKeyMasked`). */
export function maskKey(apiKey: string): string {
  return maskApiKey(apiKey);
}
