// The engine's latest readings, shared with the Alerts dialog (which lives in another tree) through a tiny
// external store, so the rows and the form can show "now …" without subscribing to the feed twice.
import { useSyncExternalStore } from "react";
import { EMPTY_READINGS, type AlertReadings } from "./engine";

let current: AlertReadings = EMPTY_READINGS;
const listeners = new Set<() => void>();

export function publishReadings(next: AlertReadings): void {
  current = next;
  for (const l of listeners) l();
}
export function readingsNow(): AlertReadings {
  return current;
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
export function useReadings(): AlertReadings {
  return useSyncExternalStore(subscribe, readingsNow, () => EMPTY_READINGS);
}
/** Tests: back to nothing known. */
export function resetReadings(): void {
  publishReadings(EMPTY_READINGS);
}
