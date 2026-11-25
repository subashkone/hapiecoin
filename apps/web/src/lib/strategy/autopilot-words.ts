// How an Autopilot strategy reads in a few words (ADR-139): the India clock, the tags of its exits, whether it has
// bought options. Shared by the trader's screen and the admin's list of built-in strategies (HC-TR-280), so that the
// admin page does not pull the whole trader's screen in to say "Stop 2x".
import { type Playbook, playbookTemplate } from "@hapiecoin/pricing";

/** A whole hour on the UTC clock as IST reads it: 20 is "1:30 AM". */
export const istClock = (hourUtc: number): string => {
  const m = (hourUtc * 60 + 330) % 1440;
  const h = Math.floor(m / 60);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m % 60).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};
/** ADR-122: the move an entry was judged on and the side it left to sell: "BTC up 1.62 % over 24 hours: the put only". */
export const moveWords = (asset: string, move: { pct: string; side: "put" | "call" | "both" }): string => {
  const pct = Number(move.pct);
  return `${asset} ${pct < 0 ? "down" : "up"} ${Math.abs(pct).toFixed(2)} % over 24 hours: ${move.side === "both" ? "both sides" : `the ${move.side} only`}`;
};
/** A timed exit whose hour is not after the entry window's first hour is the next day's (HC-TR-263; the engine takes the next occurrence of the hour): a Friday entry at 9:30 PM closed at 5:30 PM is closed on Saturday. */
export const nextDay = (c: { fromHourUtc: number; exitHourUtc?: number | undefined }): boolean => c.exitHourUtc !== undefined && c.exitHourUtc <= c.fromHourUtc;
/** A structure with bought options collects less than its sold options bring: its profit levels are on the net premium (ADR-138). */
export const hasWings = (p: Playbook): boolean => Boolean(playbookTemplate(p)?.legs.some((l) => l.side === "buy"));
export const premiumWords = (p: Playbook): string => (hasWings(p) ? "net premium" : "premium");
/** How a strategy gets out as short tags in a fixed order, so that rows can be compared at a glance (ADR-139); the sentence stays in the row's details. */
export const exitTags = (p: Playbook): string[] => {
  const c = p.clock;
  if (!c) return ["Playbook stop", "Time exit"];
  const tags = [c.legStop ? `Stop ${c.legStop}x` : "No stop"];
  if (hasWings(p)) tags.push("Wings");
  if (c.takeProfitOfCredit) tags.push(`${c.takeTrailPct ? "Trail from" : "Take"} ${Math.round(c.takeProfitOfCredit * 100)} %`);
  if (c.trailRestPct) tags.push("Trail the other side");
  if (c.ladder) tags.push(`Steps ${c.ladder.join(" / ")} %`);
  if (c.lock) tags.push(`Floor ${Math.round(c.lock.floor * 100)} % from ${Math.round(c.lock.at * 100)} %`);
  if (c.exitHourUtc !== undefined) tags.push(`Out ${istClock(c.exitHourUtc)} IST${nextDay(c) ? " next day" : ""}`);
  if (c.legBuyBackAt !== undefined) tags.push(`Buy back at ${c.legBuyBackAt} dollars`);
  if (c.legBuyBackShare !== undefined) tags.push(`Buy back at ${Math.round(c.legBuyBackShare * 100)} %`);
  if (!c.takeProfitOfCredit && !c.ladder && !c.lock && c.exitHourUtc === undefined) tags.push("Held to expiry");
  return tags;
};
