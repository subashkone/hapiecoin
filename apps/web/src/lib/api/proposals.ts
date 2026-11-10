// Playbook proposals through TanStack Query (ADR-102; HC-WS-120): today's proposals on the venue with the caller's
// marks, and the mark itself (taken once opened in the Builder as paper, dismissed to hide). An empty list is the
// common honest state: no plan enters most days.
import { Proposal, type ProposalMarkStatus, Proposals } from "@hapiecoin/schema";
import { DEFAULT_VENUE } from "@hapiecoin/venues/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useVenueId } from "@/lib/useVenue";
import { api, type ApiClient } from "./client";

export const proposalKeys = {
  all: ["proposals"] as const,
  today: (venue: string = DEFAULT_VENUE) => ["proposals", "today", venue] as const,
};

export function proposalFetchers(client: ApiClient = api) {
  return {
    today: (venue: string = DEFAULT_VENUE) => client.get(venue === DEFAULT_VENUE ? "/v1/proposals" : `/v1/proposals?venue=${encodeURIComponent(venue)}`, Proposals),
    mark: (id: string, status: ProposalMarkStatus) => client.post(`/v1/proposals/${encodeURIComponent(id)}/mark`, { status }, Proposal),
  };
}
const f = proposalFetchers();

export function useProposals(enabled = true) {
  const venue = useVenueId();
  return useQuery({ queryKey: proposalKeys.today(venue), queryFn: () => f.today(venue), enabled, staleTime: 60_000 });
}

/** Mark a proposal; the cached list is patched first so the card moves at once, then the list refreshes. */
export function useMarkProposal() {
  const qc = useQueryClient();
  const venue = useVenueId();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: ProposalMarkStatus }) => f.mark(id, status),
    onSuccess: (p: Proposal) => {
      qc.setQueryData<Proposals>(proposalKeys.today(venue), (prev) => (prev ? { ...prev, items: prev.items.map((x) => (x.id === p.id ? p : x)) } : prev));
      void qc.invalidateQueries({ queryKey: proposalKeys.all });
    },
  });
}
