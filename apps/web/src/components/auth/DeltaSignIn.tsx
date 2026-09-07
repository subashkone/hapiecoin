"use client";
import { Button, Spinner } from "@hapiecoin/ui";
import Link from "next/link";
import { useEffect, useState } from "react";

export function DeltaSignIn({ delayMs = 1500 }: { delayMs?: number }) {
  const [phase, setPhase] = useState<"spinner" | "info">("spinner");
  useEffect(() => {
    const id = setTimeout(() => setPhase("info"), delayMs);
    return () => clearTimeout(id);
  }, [delayMs]);
  return (
    <main className="grid min-h-screen place-items-center px-6 text-center" data-testid="delta-signin" data-phase={phase}>
      {phase === "spinner" ? (
        <div className="flex flex-col items-center gap-4">
          <Spinner size="lg" label="Signing you in with Delta" />
          <p className="text-muted-foreground">Signing you in with Delta…</p>
        </div>
      ) : (
        <div className="max-w-md">
          <p className="micro">Delta Exchange sign-in</p>
          <h1 className="mt-2">Arrives with live trading</h1>
          <p className="mt-3 text-muted-foreground">
            Signing in with your Delta Exchange account is part of the live-trading release. Until then, create a
            HapieCoin account with your email — the free plan includes the full chain, builder and paper trading.
          </p>
          <div className="mt-6 flex justify-center gap-2">
            <Button asChild>
              <Link href="/auth?tab=signup">Create account</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/auth">Back to sign in</Link>
            </Button>
          </div>
        </div>
      )}
    </main>
  );
}
