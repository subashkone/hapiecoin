// "Coming in Phase N" page body used by routes the default header links to, so navigation never dead-ends.
import Link from "next/link";
import { Button } from "@/components/ui";

export function PhasePlaceholder({ title, phase, blurb }: { title: string; phase: number; blurb: string }) {
  return (
    <main className="mx-auto max-w-[720px] px-6 py-16" data-testid="phase-placeholder" data-phase={phase}>
      <p className="micro">Coming in Phase {phase}</p>
      <h1 className="mt-2">{title}</h1>
      <p className="mt-3 text-muted-foreground">{blurb}</p>
      <div className="mt-6 flex gap-2">
        <Button asChild>
          <Link href="/analyse">Go to Analyse</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/">Home</Link>
        </Button>
      </div>
    </main>
  );
}
