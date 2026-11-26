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
/** Whether bought options limit the loss at expiry, as the template says it. */
export const lossLimited = (p: Playbook): boolean => playbookTemplate(p)?.risk === "defined";
const days = (n: number): string => `${n} ${n === 1 ? "day" : "days"}`;
/** ADR-143 (HC-TR-284): the exits on the whole trade of a saved strategy, as tags; none for a built-in strategy entered by the clock. */
const wholeTradeTags = (p: Playbook): string[] => {
  const x = p.clock ? p.exits : undefined;
  if (!x) return [];
  return [
    ...(x.targetPct !== undefined ? [`${p.clock?.takeTrailPct ? "Trail from" : "Target"} ${Math.round(x.targetPct * 100)} % of max profit`] : []),
    ...(x.stopPct !== undefined ? [`Stop ${Math.round(x.stopPct * 100)} % of max loss`] : []),
    ...(x.timeStopDte !== undefined ? [`Out ${days(x.timeStopDte)} before expiry`] : []),
  ];
};
/** ADR-143 (HC-TR-284): the same exits in a few words each, for the line under a strategy's name. */
export const wholeTradeFew = (p: Playbook): string[] => {
  const x = p.clock ? p.exits : undefined;
  if (!x) return [];
  return [
    ...(x.targetPct !== undefined ? [`${p.clock?.takeTrailPct ? "trail from" : "target at"} ${Math.round(x.targetPct * 100)} % of the most it can make`] : []),
    ...(x.stopPct !== undefined ? [`stop at ${Math.round(x.stopPct * 100)} % of the most it can lose`] : []),
    ...(x.timeStopDte !== undefined ? [`out ${days(x.timeStopDte)} before expiry`] : []),
  ];
};
/** ADR-143 (HC-TR-284): the same exits as the sentences of a card; "" when the strategy has none. */
export const wholeTradeWords = (p: Playbook): string => {
  const x = p.clock ? p.exits : undefined;
  if (!x) return "";
  const target = x.targetPct === undefined ? null : Math.round(x.targetPct * 100);
  return [
    ...(target === null ? [] : [p.clock?.takeTrailPct ? `Once the trade is up by ${target} % of the most it can make, after fees, it is not closed: it is trailed, and closed when the profit gives back ${p.clock.takeTrailPct} % of its best.` : `The whole trade is closed once it is up by ${target} % of the most it can make, after fees.`]),
    ...(x.stopPct === undefined ? [] : [`It is closed at a loss of ${Math.round(x.stopPct * 100)} % of the most it can lose, before fees.`]),
    ...(x.timeStopDte === undefined ? [] : [`It is closed ${days(x.timeStopDte)} before expiry, whatever the profit.`]),
  ].map((t) => `${t} `).join("");
};
/** How a strategy gets out as short tags in a fixed order, so that rows can be compared at a glance (ADR-139); the sentence stays in the row's details. */
export const exitTags = (p: Playbook): string[] => {
  const c = p.clock;
  if (!c) return ["Playbook stop", "Time exit"];
  const whole = wholeTradeTags(p);
  const tags = [c.legStop ? `Stop ${c.legStop}x` : p.exits?.stopPct !== undefined ? "No stop on a leg" : "No stop"];
  if (p.exits ? lossLimited(p) : hasWings(p)) tags.push(p.exits ? "Loss limited" : "Wings");
  if (c.takeProfitOfCredit) tags.push(`${c.takeTrailPct ? "Trail from" : "Take"} ${Math.round(c.takeProfitOfCredit * 100)} %`);
  if (c.trailRestPct) tags.push("Trail the other side");
  if (c.ladder) tags.push(`Steps ${c.ladder.join(" / ")} %`);
  if (c.lock) tags.push(`Floor ${Math.round(c.lock.floor * 100)} % from ${Math.round(c.lock.at * 100)} %`);
  if (c.exitHourUtc !== undefined) tags.push(`Out ${istClock(c.exitHourUtc)} IST${nextDay(c) ? " next day" : ""}`);
  if (c.legBuyBackAt !== undefined) tags.push(`Buy back at ${c.legBuyBackAt} dollars`);
  if (c.legBuyBackShare !== undefined) tags.push(`Buy back at ${Math.round(c.legBuyBackShare * 100)} %`);
  tags.push(...whole);
  if (!c.takeProfitOfCredit && !c.ladder && !c.lock && c.exitHourUtc === undefined && p.exits?.targetPct === undefined && p.exits?.timeStopDte === undefined) tags.push("Held to expiry");
  return tags;
};
