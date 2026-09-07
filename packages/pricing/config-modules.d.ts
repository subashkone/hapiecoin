// Ambient types for the untyped JavaScript modules in @hapiecoin/config.
declare module "@hapiecoin/config/vitest" {
  import type { UserConfig } from "vitest/config";

  interface BaseOptions {
    strict?: boolean;
    environment?: string;
  }

  export default function base(opts?: BaseOptions): UserConfig;
}
