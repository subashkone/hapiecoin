"use client";
import { Spinner } from "@hapiecoin/ui";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function SsoReturn({ target, delayMs = 1000 }: { target: string; delayMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setTimeout(() => router.replace(target), delayMs);
    return () => clearTimeout(id);
  }, [router, target, delayMs]);
  return (
    <main className="grid min-h-screen place-items-center" data-testid="sso-return">
      <div className="flex flex-col items-center gap-4">
        <Spinner size="lg" label="Signing you in" />
        <p className="text-muted-foreground">Signing you in…</p>
      </div>
    </main>
  );
}
