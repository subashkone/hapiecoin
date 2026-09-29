// The visual suite's `next dev` runs with its own build folder (NEXT_DIST_DIR=.next-visual, ADR-096) and Next rewrites
// the tracked next-env.d.ts to import that folder's route types. Put the file back on the default folder when the run
// ends, so a visual run leaves the working tree as it found it; the same function runs before the suite, which
// repairs the file after a run that was killed.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export default function restoreNextEnv(): void {
  const file = resolve(dirname(fileURLToPath(import.meta.url)), "..", "next-env.d.ts");
  const text = readFileSync(file, "utf8");
  const restored = text.replaceAll("./.next-visual/", "./.next/");
  if (restored !== text) writeFileSync(file, restored);
}
