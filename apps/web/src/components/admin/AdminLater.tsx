// Admin pages that a later Phase 4 item fills in; the rail stays complete so navigation never dead-ends (HC-AD-003).
import { EmptyState } from "@hapiecoin/ui";

export function AdminLater({ title, item, blurb }: { title: string; item: string; blurb: string }) {
  return (
    <div data-testid="admin-later">
      <h1 className="text-lg font-medium">{title}</h1>
      <EmptyState title={`Arrives with ${item}`} description={blurb} className="py-10" />
    </div>
  );
}
