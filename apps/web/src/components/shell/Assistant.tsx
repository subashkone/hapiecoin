"use client";
// HapieCoin Assistant (HC-SH-057..063, 110, 111; ADR-036): a draggable chat bubble on every screen and a small panel
// with keyword answers about the product, suggestion chips, a strategy explainer on /analyse and a human fallback.
// Answers are typed out so the panel reads as a conversation; the conversation is kept for the session.
import { Button, cn } from "@hapiecoin/ui";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useMe } from "@/lib/api/queries";
import { EXPLAIN_QUESTION, answerFor, explainStrategy, suggestionsFor } from "@/lib/assistant";
import { useUiStore } from "@/lib/store";
import { useStrategyAnalysis } from "@/lib/strategy/useStrategyAnalysis";

export const SUPPORT_EMAIL = "support@hapiecoin.com";
export const ASSISTANT_POS_KEY = "hapiecoin.assistant-pos";
interface Msg {
  who: "me" | "bot";
  text: string;
  chips?: boolean;
}

function readPos(): { x: number; y: number } | null {
  try {
    const raw = localStorage.getItem(ASSISTANT_POS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as { x?: unknown; y?: unknown };
    return typeof p.x === "number" && typeof p.y === "number" ? { x: p.x, y: p.y } : null;
  } catch {
    return null;
  }
}

/** The explainer needs the analysis hook, which only makes sense on /analyse; keep it in its own component. */
function Explainer({ register }: { register: (fn: () => string) => void }) {
  const a = useStrategyAnalysis("builder");
  const name = useUiStore((s) => s.strategy[s.asset].name);
  useEffect(() => {
    register(() => explainStrategy({ asset: a.asset, name, legs: a.legs, result: a.result, spot: a.spot, money: a.money }));
  }, [a, name, register]);
  return null;
}

export function Assistant() {
  const pathname = usePathname();
  const onAnalyse = pathname === "/analyse";
  const { data: me } = useMe();
  const loggedIn = !!me;
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [typing, setTyping] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [input, setInput] = useState("");
  const btnRef = useRef<HTMLButtonElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const explainRef = useRef<() => string>(() => "");
  const drag = useRef<{ x: number; y: number; l: number; t: number; moved: boolean } | null>(null);
  const requested = useUiStore((s) => s.assistantRequested);
  const requestedQuestion = useUiStore((s) => s.assistantQuestion);
  const lastRequest = useRef(requested);
  const register = useCallback((fn: () => string) => { explainRef.current = fn; }, []);
  useEffect(() => setPos(readPos()), []);
  useEffect(() => {
    // route change closes the panel and starts a fresh conversation; sign-out too
    setOpen(false);
    setMsgs([]);
  }, [pathname, loggedIn]);
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [msgs, open]);

  const ask = useCallback((q: string) => {
    if (typing || !q.trim()) return;
    const full = answerFor(q, { loggedIn, explain: onAnalyse ? () => explainRef.current() : undefined });
    setMsgs((m) => [...m, { who: "me", text: q }, { who: "bot", text: "" }]);
    setTyping(true);
    let n = 0;
    const step = Math.max(1, Math.ceil(full.length / 45));
    const timer = setInterval(() => {
      n = Math.min(full.length, n + step);
      const slice = full.slice(0, n);
      setMsgs((m) => { const next = [...m]; next[next.length - 1] = { who: "bot", text: slice }; return next; });
      if (n >= full.length) { clearInterval(timer); setTyping(false); }
    }, 33);
  }, [typing, loggedIn, onAnalyse]);

  useEffect(() => {
    if (requested === lastRequest.current) return;
    lastRequest.current = requested;
    setOpen(true);
    if (requestedQuestion) setTimeout(() => ask(requestedQuestion), 0);
  }, [requested, requestedQuestion, ask]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const toggle = () => {
    setOpen((o) => !o);
    if (!open && msgs.length === 0) setMsgs([{ who: "bot", text: "Hi! Ask me anything about using HapieCoin, or try one of these:", chips: true }]);
  };
  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    drag.current = { x: e.clientX, y: e.clientY, l: r.left, t: r.top, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 5) return;
    d.moved = true;
    setPos({ x: Math.max(4, Math.min(d.l + dx, window.innerWidth - 44)), y: Math.max(4, Math.min(d.t + dy, window.innerHeight - 44)) });
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.moved) {
      const r = btnRef.current?.getBoundingClientRect();
      if (r) { try { localStorage.setItem(ASSISTANT_POS_KEY, JSON.stringify({ x: r.left, y: r.top })); } catch { /* storage blocked */ } }
    } else toggle();
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const q = input.trim();
    if (!q) return;
    setInput("");
    ask(q);
  };
  const style = pos ? { left: pos.x, top: pos.y, right: "auto", bottom: "auto" } : { right: 16, bottom: onAnalyse ? 56 : 16 };
  const panelStyle = pos ? { left: Math.max(8, Math.min(pos.x + 40 - 340, window.innerWidth - 348)), top: Math.max(8, pos.y - 430), right: "auto", bottom: "auto" } : { right: 16, bottom: onAnalyse ? 104 : 64 };
  return (
    <>
      {onAnalyse && loggedIn ? <Explainer register={register} /> : null}
      <button
        ref={btnRef}
        type="button"
        className={cn("fixed z-[60] grid h-10 w-10 place-items-center rounded-full border border-border bg-popover text-foreground shadow-[0_10px_30px_-10px_rgba(0,0,0,0.7)] hover:border-foreground/40", drag.current?.moved && "cursor-grabbing")}
        style={style}
        title="Ask HapieCoin Assistant (drag to move)"
        aria-label="Ask HapieCoin Assistant (drag to move)"
        aria-expanded={open}
        data-tour="chat-launcher"
        data-testid="assistant-launcher"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } }}
      >
        <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M21 12a8 8 0 0 1-8 8H8l-5 3 1.5-4.5A8 8 0 1 1 21 12Z" /></svg>
      </button>
      {open ? (
        <div role="dialog" aria-label="HapieCoin Assistant" className="fixed z-[60] flex w-[340px] max-w-[calc(100vw-16px)] flex-col overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-[0_14px_40px_-14px_rgba(0,0,0,0.7)]" style={panelStyle} data-testid="assistant-panel" data-typing={typing}>
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium">HapieCoin Assistant</div>
              <div className="micro leading-tight" data-testid="assistant-mode">{loggedIn ? "Platform help · not financial advice" : "Limited visitor mode · sign in for full support"}</div>
            </div>
            {onAnalyse && loggedIn ? <Button size="sm" variant="ghost" onClick={() => ask(EXPLAIN_QUESTION)} title="Explain this strategy" data-testid="assistant-explain">✦</Button> : null}
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)} aria-label="Close" data-testid="assistant-close">✕</Button>
          </div>
          <div ref={bodyRef} className="max-h-[320px] min-h-[160px] space-y-2 overflow-y-auto p-3 text-xs" data-testid="assistant-body">
            {msgs.map((m, i) => (
              <div key={i} className={cn("whitespace-pre-wrap rounded px-2 py-1.5", m.who === "me" ? "ml-8 bg-accent/15" : "mr-6 bg-muted")} data-testid={`assistant-msg-${m.who}`}>
                {m.text || (typing && i === msgs.length - 1 ? "…" : "")}
                {m.chips ? (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {suggestionsFor(onAnalyse && loggedIn).map((s) => (
                      <button key={s} type="button" className={cn("rounded border px-1.5 py-0.5 text-2xs hover:border-foreground/40", s === EXPLAIN_QUESTION ? "border-accent/60 text-accent" : "border-border")} onClick={() => ask(s)} data-testid="assistant-chip">{s}</button>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          <form onSubmit={submit} className="flex gap-2 border-t border-border p-2">
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask a question…" className="h-8 min-w-0 flex-1 rounded border border-input bg-background px-2 text-xs" aria-label="Ask a question" data-testid="assistant-input" autoFocus />
            <Button size="sm" type="submit" disabled={typing || !input.trim()} data-testid="assistant-send">Send</Button>
          </form>
          <div className="micro border-t border-border px-3 py-1.5">
            Need a human? <a href={`mailto:${SUPPORT_EMAIL}`} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline" data-testid="assistant-email">Email {SUPPORT_EMAIL}</a>
          </div>
        </div>
      ) : null}
    </>
  );
}
