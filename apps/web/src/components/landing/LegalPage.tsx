// Legal page shell shared by /privacy, /terms and /disclaimer (server component).
import Link from "next/link";
import { Button } from "@/components/ui";
import { LEGAL, LEGAL_UPDATED } from "@/content/legal";

export function LegalPage({ kind }: { kind: keyof typeof LEGAL }) {
  const doc = LEGAL[kind];
  return (
    <main className="mx-auto max-w-[760px] px-6 py-12">
      <Button asChild variant="ghost" size="sm">
        <Link href="/">← Back</Link>
      </Button>
      <p className="micro mt-6">Legal</p>
      <h1 className="mt-1">{doc.title}</h1>
      <p className="mt-1 font-mono text-2xs text-muted-foreground">{LEGAL_UPDATED}</p>
      <div className="mt-8 space-y-6">
        {doc.sections.map((s) => (
          <section key={s.heading}>
            <h2 className="text-lg">{s.heading}</h2>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted-foreground">{s.body}</p>
          </section>
        ))}
      </div>
    </main>
  );
}
