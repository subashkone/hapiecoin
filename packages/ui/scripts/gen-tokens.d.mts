// Type surface of gen-tokens.mjs for the drift test (tokens.test.ts).
export const SOURCE: string;
export function generate(source?: string): {
  tokensCss: string;
  tokensTs: string;
  colorNames: string[];
  fontNames: string[];
  otherNames: string[];
};
export function writeTokens(outDir: string): { css: string; ts: string };
