// Route a 403 UPGRADE_REQUIRED (ADR-030) to the Upgrade Required dialog instead of a toast (HC-SH-054).
import { ApiError } from "./client";
import { useUiStore } from "@/lib/store";

/** True when the error was an entitlement refusal and the dialog now shows it; false lets the caller toast. */
export function handleUpgradeRequired(e: unknown): boolean {
  if (e instanceof ApiError && e.code === "UPGRADE_REQUIRED") {
    useUiStore.getState().openUpgrade(e.message);
    return true;
  }
  return false;
}
