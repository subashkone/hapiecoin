// Playbook proposals for the mock API (ADR-102): every non-control playbook asked, through the real `proposalFor`,
// whether its plan enters on the latest synthetic day, with the record status the mock records give it. The caller's
// marks are kept per mock account and joined here.
import { PLAYBOOKS, calendarFor, proposalFor } from "@hapiecoin/pricing";
import { type Proposal, type ProposalStatus, type Proposals, type Underlying, projectProposalFigures } from "@hapiecoin/schema";
import { mockEodDays } from "./mock-backtest";
import { mockPlaybookRecords } from "./mock-playbooks";

const UNITS: Record<Underlying, number> = { BTC: 0.001, ETH: 0.01, XAUT: 0.001 };

export interface MockProposalMark {
  status: ProposalStatus;
  telegramSentAt: string | null;
}

export function mockProposals(days: number, venue: "delta_india" | "deribit", marks: ReadonlyMap<string, MockProposalMark>, now = Date.now()): Proposals {
  const items: Proposal[] = [];
  const records = mockPlaybookRecords(days, venue, now).records;
  let day = new Date(now).toISOString().slice(0, 10);
  for (const asset of ["BTC", "ETH"] as const) {
    const eod = mockEodDays(asset, days, now);
    for (const p of PLAYBOOKS) {
      if (!p.assets.includes(asset) || p.control) continue;
      const r = proposalFor(p, eod, { unitsPerLot: UNITS[asset], calendar: calendarFor(12) });
      if (!r.ok) continue;
      const record = records.find((x) => x.playbookId === p.id && x.asset === asset);
      if (!record) continue; // nothing proposes without a record
      const id = `${p.id}:${asset}`;
      const mark = marks.get(id);
      day = r.proposal.day;
      items.push({
        id,
        playbookId: p.id,
        venue,
        asset,
        day: r.proposal.day,
        expiry: r.proposal.expiry,
        ...projectProposalFigures(r.proposal),
        legs: r.proposal.legs.map((l) => ({ kind: l.kind, side: l.side, strike: l.strike, expiry: l.expiry, lots: l.lots, price: l.price, iv: l.iv ?? null })),
        recordStatus: record.record.status,
        createdAt: new Date(now).toISOString(),
        status: mark?.status ?? "new",
        telegramSentAt: mark?.telegramSentAt ?? null,
      });
    }
  }
  return { venue, day, items };
}
