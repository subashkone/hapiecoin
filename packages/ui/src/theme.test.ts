import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { compile } from "@tailwindcss/node";
import { describe, expect, it } from "vitest";
import { colorTokens } from "./tokens";

const srcDir = resolve(__dirname);
const themeCss = readFileSync(resolve(srcDir, "theme.css"), "utf8");

describe("[THEME] theme.css maps every token to Tailwind v4 utilities", () => {
  it("[THEME] declares a --color-* entry for every colour token, plus fonts, radii and the dark variant", () => {
    for (const name of colorTokens) {
      expect(themeCss).toContain(`--color-${name}: hsl(var(--${name}));`);
    }
    expect(themeCss).toContain("--font-sans: var(--font-body);");
    expect(themeCss).toContain("--font-display: var(--font-display);");
    expect(themeCss).toContain("--font-mono: var(--font-mono);");
    expect(themeCss).toContain("--radius-DEFAULT: var(--radius);");
    expect(themeCss).toContain("@custom-variant dark (&:where(.dark, .dark *));");
    expect(themeCss).toMatch(/:root \{\s*--row-h: 36px;\s*\}/);
    expect(themeCss).toMatch(/\.compact \{\s*--row-h: 28px;\s*\}/);
  });

  it("[THEME] compiles with Tailwind and resolves utilities to token variables", async () => {
    const compiler = await compile(themeCss, { base: srcDir, onDependency: () => undefined });
    const out = compiler.build([
      "bg-card",
      "text-muted-foreground",
      "font-mono",
      "font-display",
      "rounded-md",
      "border-input",
      "bg-buy/20",
      "dark:bg-surface-1",
      "h-row",
      "num",
      "micro",
      "text-2xs",
    ]);
    expect(out).toContain("background-color: hsl(var(--card))");
    expect(out).toContain("color: hsl(var(--muted-foreground))");
    expect(out).toMatch(/\.font-mono \{[^}]*font-family: var\(--font-mono\)/);
    expect(out).toMatch(/\.font-display \{[^}]*font-family: var\(--font-display\)/);
    expect(out).toMatch(/\.rounded-md \{[^}]*calc\(var\(--radius\) - 1px\)/);
    expect(out).toContain("border-color: hsl(var(--input))");
    expect(out).toMatch(/\.bg-buy\\\/20 \{[^}]*hsl\(var\(--buy\)\)/);
    expect(out).toMatch(/\.dark\\:bg-surface-1:where\(\.dark, \.dark \*\) \{[^}]*hsl\(var\(--surface-1\)\)/);
    // font keys are `reference`: no self-referential `--font-x: var(--font-x)` may be emitted into :root
    expect(out).not.toMatch(/--font-mono:\s*var\(--font-mono\)/);
    expect(out).not.toMatch(/--font-display:\s*var\(--font-display\)/);
    expect(out).toMatch(/\.h-row \{[^}]*height: var\(--row-h\)/);
    expect(out).toMatch(/\.num \{[^}]*tabular-nums/);
    expect(out).toMatch(/\.micro \{[^}]*text-transform: uppercase/);
    expect(out).toMatch(/\.text-2xs \{[^}]*font-size: 11px/);
    // tokens.css is inlined via @import
    expect(out).toContain("--background: 220 15% 92%");
    expect(out).toContain("--background: 220 23% 5%");
    // no raw hex anywhere in the compiled theme except Tailwind's own preflight/black (used by Dialog overlay)
    const hexes = [...new Set(out.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [])];
    expect(hexes.filter((h) => !["#000", "#0000", "#fff"].includes(h))).toEqual([]);
  });
});

describe("[FONTS] self-hosted font files and declarations", () => {
  const fontsCss = readFileSync(resolve(srcDir, "fonts.css"), "utf8");

  it("[FONTS] declares Schibsted Grotesk 400-700 (variable) and DM Mono 400/500 with font-display: swap", () => {
    expect(fontsCss).toMatch(
      /font-family: "Schibsted Grotesk";\s*font-style: normal;\s*font-weight: 400 700;\s*font-display: swap;/,
    );
    expect(fontsCss).toMatch(
      /font-family: "DM Mono";\s*font-style: normal;\s*font-weight: 400;\s*font-display: swap;/,
    );
    expect(fontsCss).toMatch(
      /font-family: "DM Mono";\s*font-style: normal;\s*font-weight: 500;\s*font-display: swap;/,
    );
    expect(fontsCss).toMatch(/"Schibsted Grotesk Fallback";[\s\S]*size-adjust:/);
    expect(fontsCss).toMatch(/"DM Mono Fallback";[\s\S]*size-adjust:/);
  });

  it("[FONTS] every url() in fonts.css points at an existing WOFF2 file", () => {
    const urls = [...fontsCss.matchAll(/url\("\.\/(fonts\/[^"]+)"\)/g)].map((m) => m[1] ?? "");
    expect(urls.length).toBe(3);
    for (const rel of urls) {
      const file = resolve(srcDir, rel);
      expect(statSync(file).size).toBeGreaterThan(1000);
      const magic = readFileSync(file).subarray(0, 4).toString("ascii");
      expect(magic).toBe("wOF2");
    }
  });
});
