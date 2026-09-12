"use client";
// The app's error screen (roadmap item 27, ADR-081; HC-SH-132): a render error below the root layout lands here. It is
// reported once through /v1/client-errors and the trader gets a reference, Try again and Reload. A page error cannot
// change anything on the server, and the copy says so, because the first question is "did my order go through?".
import { useEffect, useState } from "react";
import { Button } from "@/components/ui";
import { reportError } from "@/lib/errors/report";

export interface ErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function ErrorPage({ error, reset }: ErrorPageProps) {
  const [reference, setReference] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void reportError(error, "boundary").then((id) => {
      if (alive) setReference(id);
    });
    return () => {
      alive = false;
    };
  }, [error]);
  return (
    <main className="grid min-h-screen place-items-center px-6 text-center" data-testid="error-screen">
      <div className="max-w-md">
        <p className="micro">Error</p>
        <h1 className="mt-2 text-2xl">Something broke on our side</h1>
        <p className="mt-3 text-muted-foreground">It has been reported. A page error cannot change your strategies or orders on the exchange; reload to pick up where you were.</p>
        <p className="micro mt-3" data-testid="error-reference">
          Reference: {reference ?? error.digest ?? "not sent"}
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <Button variant="outline" onClick={() => reset()} data-testid="error-retry">
            Try again
          </Button>
          <Button onClick={() => window.location.reload()} data-testid="error-reload">
            Reload
          </Button>
        </div>
      </div>
    </main>
  );
}
