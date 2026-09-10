/**
 * Re-seal stored exchange credentials under the current vault key (ADR-054, GAPS #10). Used lazily by
 * `openCredential` for one row, and by `pnpm db:reseal` for every row after a rotation. A row whose key is not in
 * the keyring is left as it is and counted: its owner reconnects the exchange (the API says so on the next live call).
 */
import { eq } from "drizzle-orm";
import type { Db } from "./db/client.js";
import { brokerCredentials } from "./db/schema.js";
import { VaultError, type Vault } from "./vault.js";

type CredentialRow = typeof brokerCredentials.$inferSelect;

export interface ResealReport {
  scanned: number;
  current: number;
  resealed: number;
  /** Rows no key in the ring could open (their ids, never their owners' keys). */
  unreadable: string[];
}

/** Seal the plaintexts again under the current key and write the row; returns the updated columns. */
export async function resealRow(db: Db, vault: Vault, row: CredentialRow, apiKey: string, apiSecret: string): Promise<CredentialRow> {
  const key = vault.seal(apiKey);
  const secret = vault.seal(apiSecret);
  const [updated] = await db
    .update(brokerCredentials)
    .set({ apiKeyCt: key.ct, apiKeyIv: key.iv, apiKeyTag: key.tag, apiSecretCt: secret.ct, apiSecretIv: secret.iv, apiSecretTag: secret.tag, keyId: key.kid })
    .where(eq(brokerCredentials.id, row.id))
    .returning();
  return updated ?? row;
}

/** Walk every credential row; re-seal the ones under a previous (or unknown-era) key. */
export async function resealCredentials(db: Db, vault: Vault): Promise<ResealReport> {
  const rows = await db.select().from(brokerCredentials);
  const report: ResealReport = { scanned: rows.length, current: 0, resealed: 0, unreadable: [] };
  for (const row of rows) {
    if (vault.isCurrent({ kid: row.keyId })) {
      report.current += 1;
      continue;
    }
    try {
      const apiKey = vault.open({ ct: row.apiKeyCt, iv: row.apiKeyIv, tag: row.apiKeyTag, kid: row.keyId });
      const apiSecret = vault.open({ ct: row.apiSecretCt, iv: row.apiSecretIv, tag: row.apiSecretTag, kid: row.keyId });
      await resealRow(db, vault, row, apiKey, apiSecret);
      report.resealed += 1;
    } catch (e) {
      if (!(e instanceof VaultError)) throw e;
      report.unreadable.push(row.id);
    }
  }
  return report;
}
