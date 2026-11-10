// Playbook proposals (ADR-102; HC-TR-208): the money figures round to cents at the edge, an unbounded extreme reads as
// null, and the strict shapes refuse what the API never sends.
import { describe, expect, it } from "vitest";
import { Proposal, ProposalMarkBody, Proposals, projectProposalFigures } from "./proposals.js";

const figures = projectProposalFigures({ spot: 79521.456, entryCost: -216.517, maxProfit: 216.517, maxLoss: -Infinity });

const proposal: Proposal = {
  id: "12",
  playbookId: "trend-puts",
  venue: "delta_india",
  asset: "BTC",
  day: "2026-11-10",
  expiry: "2026-11-28",
  ...figures,
  legs: [
    { kind: "put", side: "sell", strike: "78000", expiry: "2026-11-28", lots: 10, price: "1200.5", iv: 0.42 },
    { kind: "put", side: "buy", strike: "76000", expiry: "2026-11-28", lots: 10, price: "700", iv: null },
  ],
  recordStatus: "pass",
  createdAt: "2026-11-10T12:04:00.000Z",
  status: "new",
  telegramSentAt: null,
};

describe("HC-TR-208 proposals", () => {
  it("rounds the figures to cents and reads an unbounded extreme as null", () => {
    expect(figures).toEqual({ spot: "79521.46", entryCost: "-216.52", maxProfit: "216.52", maxLoss: null });
    expect(projectProposalFigures({ spot: 80000, entryCost: 0, maxProfit: Infinity, maxLoss: -500 })).toEqual({ spot: "80000", entryCost: "0", maxProfit: null, maxLoss: "-500" });
  });

  it("the shapes accept a proposal and its list and refuse an unknown field, a bad status and an empty leg list", () => {
    expect(Proposal.parse(proposal)).toEqual(proposal);
    expect(Proposals.parse({ venue: "delta_india", day: "2026-11-10", items: [proposal] }).items).toHaveLength(1);
    expect(Proposal.safeParse({ ...proposal, extra: 1 }).success).toBe(false);
    expect(Proposal.safeParse({ ...proposal, status: "placed" }).success).toBe(false);
    expect(Proposal.safeParse({ ...proposal, legs: [] }).success).toBe(false);
    expect(ProposalMarkBody.parse({ status: "dismissed" })).toEqual({ status: "dismissed" });
    expect(ProposalMarkBody.safeParse({ status: "new" }).success).toBe(false);
  });
});
