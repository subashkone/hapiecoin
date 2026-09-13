"use client";
// A failure in the root layout itself (ADR-081; HC-SH-132): Next renders this in place of the whole layout, so it
// carries its own html and body and plain styles (no stylesheet is loaded here). Reported like error.tsx.
import { useEffect, useState } from "react";
import { reportError } from "@/lib/errors/report";

export interface GlobalErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

const page = { margin: 0, minHeight: "100vh", display: "grid", placeItems: "center", background: "#0f1115", color: "#e6e6e6", fontFamily: "system-ui, sans-serif", textAlign: "center" as const, padding: "24px" };
const button = { padding: "8px 14px", borderRadius: 6, border: "1px solid #3a3d45", background: "transparent", color: "#e6e6e6", cursor: "pointer", marginRight: 8 };

export default function GlobalError({ error, reset }: GlobalErrorProps) {
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
    <html lang="en">
      <body style={page}>
        <div style={{ maxWidth: 440 }} data-testid="global-error-screen">
          <p style={{ fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase", opacity: 0.7 }}>HapieCoin · Error</p>
          <h1 style={{ fontSize: 22, margin: "8px 0 0" }}>Something broke on our side</h1>
          <p style={{ opacity: 0.8 }}>It has been reported. A page error cannot change your strategies or orders on the exchange.</p>
          <p style={{ fontSize: 12, opacity: 0.7 }} data-testid="global-error-reference">
            Reference: {reference ?? error.digest ?? "not sent"}
          </p>
          <div style={{ marginTop: 20 }}>
            <button type="button" style={button} onClick={() => reset()}>
              Try again
            </button>
            <button type="button" style={button} onClick={() => window.location.reload()}>
              Reload
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
