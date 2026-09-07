import { defineConfig, mergeConfig } from "vitest/config";
import base from "@hapiecoin/config/vitest";

// Schema carries money-shaped contracts: strict coverage (100 % lines/functions/statements, 95 % branches).
export default mergeConfig(base({ strict: true }), defineConfig({}));
