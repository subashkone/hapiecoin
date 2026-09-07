/** Ambient typing for the shared JS config package (it ships no .d.ts). */
declare module "@hapiecoin/config/vitest" {
  import type { UserConfig } from "vitest/config";
  export default function base(opts?: { strict?: boolean; environment?: string }): UserConfig;
}
