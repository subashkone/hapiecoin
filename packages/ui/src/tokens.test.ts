import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { colorTokens, cssVar, fontTokens, hsl, otherTokens, tokens } from "./tokens";

const pkgRoot = resolve(__dirname, "..");
const srcDir = resolve(pkgRoot, "src");

async function loadGenerator() {
  // Plain ESM script (typed by scripts/gen-tokens.d.mts); imported dynamically so vitest does not pre-bundle it.
  return import("../scripts/gen-tokens.mjs");
}

describe("[TOKENS] generated tokens match the v2 mock (ADR-003, no drift)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "hapiecoin-tokens-"));
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  it("[TOKENS] regenerating into a temp dir produces byte-identical tokens.css and tokens.ts", async () => {
    const gen = await loadGenerator();
    const out = gen.writeTokens(tmp);
    expect(readFileSync(out.css, "utf8")).toBe(readFileSync(join(srcDir, "tokens.css"), "utf8"));
    expect(readFileSync(out.ts, "utf8")).toBe(readFileSync(join(srcDir, "tokens.ts"), "utf8"));
  });

  it("[TOKENS] every :root token of shell-head.html is present in tokens.css light and dark blocks", async () => {
    const gen = await loadGenerator();
    const mock = readFileSync(gen.SOURCE, "utf8");
    const rootBlock = /:root\{([^}]*)\}/.exec(mock)?.[1] ?? "";
    const darkBlock = /html\.dark\{([^}]*)\}/.exec(mock)?.[1] ?? "";
    const names = (block: string) => [...block.matchAll(/--([a-z0-9-]+):/g)].map((m) => m[1]);
    expect(names(rootBlock)).toEqual([...tokens]);
    expect(names(darkBlock)).toEqual([...colorTokens]);

    const css = readFileSync(join(srcDir, "tokens.css"), "utf8");
    expect(css).toMatch(/^:root \{/m);
    expect(css).toMatch(/^\.dark \{/m);
    expect(css).toMatch(/@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\.light\) \{/);
    for (const name of colorTokens) {
      expect(css.match(new RegExp(`--${name}: `, "g"))?.length).toBe(3);
    }
  });

  it("[TOKENS] hsl() and cssVar() helpers emit var() references, never literal colours", () => {
    expect(hsl("primary")).toBe("hsl(var(--primary))");
    expect(hsl("buy-bg", 0.2)).toBe("hsl(var(--buy-bg) / 0.2)");
    expect(hsl("ring", "22%")).toBe("hsl(var(--ring) / 22%)");
    expect(cssVar("radius")).toBe("var(--radius)");
    expect(cssVar("font-mono")).toBe("var(--font-mono)");
    expect(fontTokens).toEqual(["font-display", "font-body", "font-mono"]);
    expect(otherTokens).toEqual(["radius"]);
    expect(colorTokens).toContain("spot");
    expect(colorTokens).toContain("curve");
  });
});

describe("[TOKENS] token guard: no hard-coded hex colours in src outside tokens.css", () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (/\.(tsx?|css)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
    }
    return out;
  }

  it("[TOKENS] only tokens.css may contain #rrggbb literals", () => {
    const offenders: string[] = [];
    for (const file of walk(srcDir)) {
      if (file.endsWith("tokens.css")) continue;
      const text = readFileSync(file, "utf8");
      if (/#[0-9a-fA-F]{3,8}\b/.test(text.replace(/https?:\/\/\S+/g, ""))) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
