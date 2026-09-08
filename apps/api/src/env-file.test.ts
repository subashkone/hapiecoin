import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { loadRepoEnv, repoRootEnvPath } from "./env-file.js";

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((f) => f()));

describe("[API] repo-root .env loading", () => {
  it("resolves three levels up from the module", () => {
    const src = pathToFileURL(join(tmpdir(), "repo", "apps", "api", "src", "main.ts")).href;
    const dist = pathToFileURL(join(tmpdir(), "repo", "apps", "api", "dist", "main.js")).href;
    expect(repoRootEnvPath(src)).toBe(join(tmpdir(), "repo", ".env"));
    expect(repoRootEnvPath(dist)).toBe(join(tmpdir(), "repo", ".env"));
  });
  it("loads the file once, keeps shell values on conflict, skips under NODE_ENV=test and when the file is missing", () => {
    const root = mkdtempSync(join(tmpdir(), "hapie-env-"));
    cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    writeFileSync(join(root, ".env"), "HAPIE_TEST_A=from-file\nHAPIE_TEST_B=file-b\n");
    const moduleUrl = pathToFileURL(join(root, "apps", "api", "src", "main.ts")).href;
    delete process.env["HAPIE_TEST_A"];
    process.env["HAPIE_TEST_B"] = "from-shell";
    cleanups.push(() => {
      delete process.env["HAPIE_TEST_A"];
      delete process.env["HAPIE_TEST_B"];
    });
    expect(loadRepoEnv(moduleUrl, { ...process.env, NODE_ENV: "test" })).toBe(false);
    expect(loadRepoEnv(moduleUrl, { ...process.env, NODE_ENV: "development" })).toBe(true);
    expect(process.env["HAPIE_TEST_A"]).toBe("from-file");
    expect(process.env["HAPIE_TEST_B"]).toBe("from-shell");
    expect(loadRepoEnv(pathToFileURL(join(root, "nowhere", "x", "y", "z", "c.js")).href, { NODE_ENV: "development" })).toBe(false);
  });
});
