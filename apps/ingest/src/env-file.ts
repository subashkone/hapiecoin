/**
 * Development convenience: load the repository-root `.env` (a copy of env.example) into process.env before
 * the config is validated. Variables already present in the environment win, so CI and production, which
 * inject real environment variables, are unaffected; a missing file is fine.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Path of the repo-root .env for a module three levels below the root (apps/<app>/src or apps/<app>/dist). */
export function repoRootEnvPath(moduleUrl: string): string {
  return fileURLToPath(new URL("../../../.env", moduleUrl));
}

export function loadRepoEnv(moduleUrl: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (env["NODE_ENV"] === "test") return false; // tests never read a developer's keys (trading safety rule 2)
  const path = repoRootEnvPath(moduleUrl);
  if (!existsSync(path)) return false;
  const before = { ...env };
  process.loadEnvFile(path);
  // keep the shell's values on conflict
  for (const [k, v] of Object.entries(before)) if (v !== undefined) env[k] = v;
  return true;
}
