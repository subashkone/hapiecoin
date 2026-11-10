/**
 * Playbook proposals (ADR-102; HC-TR-207, HC-TR-209): after the end-of-day chain write the API asks every non-control
 * playbook whether its plan would enter on the latest recorded day, through the same `entryFor` the backtest uses, and
 * stores one proposal per playbook, venue, asset and day with the structure it would place and the record status the
 * playbook had. A proposal is decision support: the trader opens it in the Builder in paper mode or dismisses it;
 * nothing here places anything, paper or live. Users who linked Telegram and opted in get a message for each new
 * proposal whose record passes, at most `telegramCap` a day. Runs on the leader only (ADR-062), inside the first
 * snapshotter's after-hook, every few minutes; idempotent, so a proposal lands once and within minutes of the write.
 */
import { PLAYBOOKS, type Playbook, calendarFor, playbookById, proposalFor } from "@hapiecoin/pricing";
import { type Proposal, type ProposalLeg, type ProposalMarkStatus, type Venue, projectProposalFigures } from "@hapiecoin/schema";
import { defaultLotSizes, getVenue } from "@hapiecoin/venues";
import { and, asc, count, eq, gte, isNotNull, max } from "drizzle-orm";
import { dayOf, eodDaysCached } from "./chain-eod.js";
import type { Db } from "./db/client.js";
import { playbookProposalMarks, playbookProposals, playbookRecords, userSettings, users } from "./db/schema.js";
import { PLAYBOOK_ASSETS } from "./playbooks.js";
import type { TelegramClient } from "./telegram.js";

export interface ProposalDeps {
  db: Db;
  logger: { info(o: object, msg: string): void; warn(o: object, msg: string): void };
  telegram: TelegramClient | null;
  webUrl: string;
  /** Telegram messages per user per UTC day; 0 turns delivery off. */
  telegramCap: number;
  now?: (() => number) | undefined;
}

type ProposalRow = typeof playbookProposals.$inferSelect;
type MarkRow = typeof playbookProposalMarks.$inferSelect;

function toProposal(row: ProposalRow, mark: MarkRow | null): Proposal {
  return {
    id: String(row.id),
    playbookId: row.playbookId,
    venue: row.venue,
    asset: row.asset,
    day: row.day,
    expiry: row.expiry,
    spot: row.spot,
    legs: row.legs,
    entryCost: row.entryCost,
    maxProfit: row.maxProfit,
    maxLoss: row.maxLoss,
    recordStatus: row.recordStatus,
    createdAt: row.createdAt.toISOString(),
    status: mark?.status ?? "new",
    telegramSentAt: mark?.telegramSentAt ? mark.telegramSentAt.toISOString() : null,
  };
}

/**
 * Detect today's proposals: for every venue and asset, the latest recorded day; for every non-control playbook with a
 * record and no proposal for that day yet, the plan's entry on that day. Returns the counts.
 */
export async function detectProposals(deps: ProposalDeps, venues: readonly Venue[]): Promise<{ created: number; skipped: number; noRecord: number; noData: number }> {
  const totals = { created: 0, skipped: 0, noRecord: 0, noData: 0 };
  for (const venue of venues) {
    const adapter = getVenue(venue);
    for (const asset of PLAYBOOK_ASSETS) {
      const days = await eodDaysCached(deps.db, venue, asset);
      const latest = days.at(-1)?.day;
      if (latest === undefined) {
        totals.noData += 1;
        continue;
      }
      const statuses = new Map(
        (await deps.db.select({ playbookId: playbookRecords.playbookId, status: playbookRecords.status }).from(playbookRecords).where(and(eq(playbookRecords.venue, venue), eq(playbookRecords.asset, asset)))).map((r) => [r.playbookId, r.status] as const),
      );
      const existing = new Set((await deps.db.select({ playbookId: playbookProposals.playbookId }).from(playbookProposals).where(and(eq(playbookProposals.venue, venue), eq(playbookProposals.asset, asset), eq(playbookProposals.day, latest)))).map((r) => r.playbookId));
      for (const p of PLAYBOOKS) {
        if (!p.assets.includes(asset) || p.control) continue;
        if (existing.has(p.id)) {
          totals.skipped += 1;
          continue;
        }
        const status = statuses.get(p.id);
        if (!status) {
          totals.noRecord += 1; // nothing proposes without a record (ADR-098)
          continue;
        }
        const r = proposalFor(p, days, { unitsPerLot: Number(defaultLotSizes(adapter)[asset]), calendar: calendarFor(adapter.calendar.settlementHourUtc(asset)) });
        if (!r.ok) {
          totals.skipped += 1;
          continue;
        }
        const legs: ProposalLeg[] = r.proposal.legs.map((l) => ({ kind: l.kind, side: l.side, strike: l.strike, expiry: l.expiry, lots: l.lots, price: l.price, iv: l.iv ?? null }));
        const inserted = await deps.db
          .insert(playbookProposals)
          .values({ playbookId: p.id, venue, asset, day: r.proposal.day, expiry: r.proposal.expiry, legs, recordStatus: status, ...projectProposalFigures(r.proposal) })
          .onConflictDoNothing({ target: [playbookProposals.playbookId, playbookProposals.venue, playbookProposals.asset, playbookProposals.day] })
          .returning({ id: playbookProposals.id });
        if (inserted.length > 0) totals.created += 1; // a concurrent leader may have won the race
        else totals.skipped += 1;
      }
    }
  }
  return totals;
}

/** One line a Telegram reader understands; never a key, never an instruction to place. */
export function proposalMessage(p: Playbook, row: ProposalRow, webUrl: string): string {
  const legs = row.legs.map((l) => `${l.side === "buy" ? "B" : "S"} ${l.kind === "future" ? "PERP" : `${l.kind === "call" ? "C" : "P"} ${l.strike}`}`).join(" · ");
  const premium = Number(row.entryCost) >= 0 ? `pays ${row.entryCost}` : `receives ${row.entryCost.slice(1)}`;
  return `HapieCoin playbook · ${p.name} (${row.asset}, ${row.venue === "deribit" ? "Deribit" : "Delta India"})\nWould enter on the ${row.day} chain: ${legs} · expiry ${row.expiry} · ${p.lots} lots\nNet premium ${premium} · max loss ${row.maxLoss ?? "unbounded"}\nIts record passes its thresholds on our history. A backtest is not a forecast: open it in the Builder as paper, or dismiss it.\n${webUrl}/analyse`;
}

/**
 * Deliver today's pass-status proposals to users who linked Telegram and opted in, at most `telegramCap` per user per
 * UTC day; a message that fails is not marked and is retried on the next run.
 */
export async function deliverProposals(deps: ProposalDeps): Promise<{ sent: number; capped: number; failed: number }> {
  const totals = { sent: 0, capped: 0, failed: 0 };
  if (!deps.telegram || deps.telegramCap <= 0) return totals;
  const now = new Date(deps.now?.() ?? Date.now());
  const dayStart = new Date(`${dayOf(now)}T00:00:00.000Z`);
  // proposals detected in the last day (their `day` is the recorded chain's, usually yesterday's until the 12:00 UTC
  // write); the marks keep each one from going out twice
  const fresh = await deps.db
    .select()
    .from(playbookProposals)
    .where(and(gte(playbookProposals.createdAt, new Date(now.getTime() - 24 * 3_600_000)), eq(playbookProposals.recordStatus, "pass")))
    .orderBy(asc(playbookProposals.id));
  if (fresh.length === 0) return totals;
  const recipients = await deps.db
    .select({ userId: users.id, chatId: users.telegramChatId })
    .from(users)
    .innerJoin(userSettings, eq(userSettings.userId, users.id))
    .where(and(isNotNull(users.telegramChatId), eq(userSettings.proposalsTelegram, true)));
  for (const u of recipients) {
    if (!u.chatId) continue;
    const marks = new Map((await deps.db.select().from(playbookProposalMarks).where(eq(playbookProposalMarks.userId, u.userId))).map((m) => [m.proposalId, m] as const));
    let sentToday = (await deps.db.select({ n: count() }).from(playbookProposalMarks).where(and(eq(playbookProposalMarks.userId, u.userId), gte(playbookProposalMarks.telegramSentAt, dayStart))))[0]?.n ?? 0;
    for (const row of fresh) {
      const mark = marks.get(row.id);
      if (mark?.telegramSentAt) continue;
      if (sentToday >= deps.telegramCap) {
        totals.capped += 1;
        continue;
      }
      const p = playbookById(row.playbookId);
      if (!p) continue;
      try {
        await deps.telegram.sendMessage(u.chatId, proposalMessage(p, row, deps.webUrl));
      } catch (e) {
        totals.failed += 1;
        deps.logger.warn({ proposal: row.id, reason: e instanceof Error ? e.message : String(e) }, "proposal telegram failed");
        continue;
      }
      await deps.db
        .insert(playbookProposalMarks)
        .values({ userId: u.userId, proposalId: row.id, status: mark?.status ?? "new", telegramSentAt: now, updatedAt: now })
        .onConflictDoUpdate({ target: [playbookProposalMarks.userId, playbookProposalMarks.proposalId], set: { telegramSentAt: now, updatedAt: now } });
      sentToday += 1;
      totals.sent += 1;
    }
  }
  return totals;
}

/** Detect, then deliver; one failure never stalls the snapshotter that calls it. */
export async function runProposals(deps: ProposalDeps, venues: readonly Venue[]): Promise<void> {
  try {
    const detected = await detectProposals(deps, venues);
    if (detected.created > 0) deps.logger.info(detected, "playbook proposals detected");
    const delivered = await deliverProposals(deps);
    if (delivered.sent > 0 || delivered.failed > 0 || delivered.capped > 0) deps.logger.info(delivered, "playbook proposals delivered");
  } catch (e) {
    deps.logger.warn({ err: e instanceof Error ? e.message : String(e) }, "playbook proposals failed");
  }
}

/** The most recent day with a proposal on the venue (the latest recorded chain that made any plan enter), or null. */
export async function latestProposalDay(db: Db, venue: Venue): Promise<string | null> {
  const [row] = await db.select({ day: max(playbookProposals.day) }).from(playbookProposals).where(eq(playbookProposals.venue, venue));
  return row?.day ?? null;
}

/** A day's proposals on a venue with the caller's marks, every asset, in a stable order. */
export async function listProposals(db: Db, userId: string, venue: Venue, day: string): Promise<Proposal[]> {
  const rows = await db
    .select({ p: playbookProposals, m: playbookProposalMarks })
    .from(playbookProposals)
    .leftJoin(playbookProposalMarks, and(eq(playbookProposalMarks.proposalId, playbookProposals.id), eq(playbookProposalMarks.userId, userId)))
    .where(and(eq(playbookProposals.venue, venue), eq(playbookProposals.day, day)))
    .orderBy(asc(playbookProposals.asset), asc(playbookProposals.playbookId));
  return rows.map((r) => toProposal(r.p, r.m));
}

/** The caller's mark on a proposal (taken in the Builder, dismissed); null when no such proposal exists. */
export async function markProposal(db: Db, userId: string, proposalId: number, status: ProposalMarkStatus, now = new Date()): Promise<Proposal | null> {
  const [row] = await db.select().from(playbookProposals).where(eq(playbookProposals.id, proposalId)).limit(1);
  if (!row) return null;
  const [mark] = await db
    .insert(playbookProposalMarks)
    .values({ userId, proposalId, status, updatedAt: now })
    .onConflictDoUpdate({ target: [playbookProposalMarks.userId, playbookProposalMarks.proposalId], set: { status, updatedAt: now } })
    .returning();
  return toProposal(row, mark ?? null);
}
