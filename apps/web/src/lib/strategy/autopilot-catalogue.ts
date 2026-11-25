// The strategies a trader's Autopilot screen works with (HC-TR-279; ADR-141, ADR-142): the built-in list, and beside
// it the saved strategies the server says this trader may use. A saved strategy the trader can no longer switch on
// (retired, or no longer theirs) is not offered, but a trade, a log line or a result of it keeps its name.
import { AUTOPILOT_PLAYBOOKS, type Playbook, type PlaybookBacktest, type PlaybookCadence, playbookBacktest, playbookCadence } from "@hapiecoin/pricing";
import { type SavedCard, savedPlaybookOf } from "@hapiecoin/schema";

export interface AutopilotCatalogue {
  /** Every strategy the trader may switch on: the built-in ones, then the saved ones. */
  tradable: readonly Playbook[];
  /** A strategy by its id, a saved one that is no longer offered included. */
  find: (playbookId: string | null | undefined) => Playbook | undefined;
  nameOf: (playbookId: string) => string;
  cadenceOf: (playbookId: string | null | undefined) => PlaybookCadence | null;
  /** The backtest figures of a strategy: the built-in table, or the figures an admin entered for a saved one. */
  backtestOf: (playbookId: string) => PlaybookBacktest | undefined;
  /** Whether a strategy was built in the app (its figures are entered by hand, and say so). */
  isSaved: (playbookId: string) => boolean;
}

function build(saved: readonly SavedCard[]): AutopilotCatalogue {
  // the saved shape is the pricing package's `Playbook`: the compiler holds the two together here
  const mine = saved.map((card): { card: SavedCard; playbook: Playbook } => ({ card, playbook: savedPlaybookOf(card) }));
  const byId = new Map<string, Playbook>([...AUTOPILOT_PLAYBOOKS.map((p): [string, Playbook] => [p.id, p]), ...mine.map((m): [string, Playbook] => [m.card.id, m.playbook])]);
  const figures = new Map(mine.filter((m) => m.card.backtest !== null).map((m): [string, PlaybookBacktest] => [m.card.id, m.card.backtest!]));
  const savedIds = new Set(mine.map((m) => m.card.id));
  const find = (playbookId: string | null | undefined) => (playbookId ? byId.get(playbookId) : undefined);
  return {
    tradable: mine.some((m) => m.card.usable) ? [...AUTOPILOT_PLAYBOOKS, ...mine.filter((m) => m.card.usable).map((m) => m.playbook)] : AUTOPILOT_PLAYBOOKS,
    find,
    nameOf: (playbookId) => byId.get(playbookId)?.name ?? playbookId,
    cadenceOf: (playbookId) => {
      const p = find(playbookId);
      return p ? playbookCadence(p) : null;
    },
    backtestOf: (playbookId) => figures.get(playbookId) ?? playbookBacktest(playbookId),
    isSaved: (playbookId) => savedIds.has(playbookId),
  };
}

/** The built-in list alone: what every trader has until an admin publishes a strategy for them. */
export const BUILT_IN_CATALOGUE: AutopilotCatalogue = build([]);

export function catalogueOf(saved: readonly SavedCard[] | undefined): AutopilotCatalogue {
  return saved && saved.length > 0 ? build(saved) : BUILT_IN_CATALOGUE;
}
