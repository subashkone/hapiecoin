// Fake market-data gateway for e2e and manual runs: speaks the @hapiecoin/schema ClientMessage /
// ServerMessage frames over `ws`, serves chain snapshots whose strikes are exactly the recorded Delta
// instrument list (test/fixtures/instruments.json), then streams coalesced deltas and spot ticks.
// Also answers GET /healthz with the expiries it serves, so the web app's expiry discovery is exercised.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { type ChainRow, ClientMessage, type ServerMessage, type Underlying, canonicalTopic, parseTopic, spotTopic } from "@hapiecoin/schema";

import { SPOT0, buildChain, dec, expiriesOf, loadFixtureFile, mulberry32, type Fixture } from "./fixtures/chain";

export interface FakeGatewayOptions {
  port: number;
  /** Delta / spot tick period in ms (0 disables ticking, snapshots only). */
  tickMs?: number;
  fixture?: Fixture;
  /** Only serve expiries on/after this ISO date (defaults to all recorded). */
  today?: string;
}

export interface FakeGateway {
  server: Server;
  wss: WebSocketServer;
  url: string;
  close: () => Promise<void>;
  /** Push one frame to every client subscribed to the topic (tests can force a specific update). */
  broadcast: (msg: ServerMessage) => void;
}

export async function startFakeGateway(opts: FakeGatewayOptions): Promise<FakeGateway> {
  const fx = opts.fixture ?? loadFixtureFile();
  const expiries = expiriesOf(fx);
  if (opts.today) {
    for (const k of Object.keys(expiries) as Underlying[]) expiries[k] = expiries[k].filter((d) => d >= opts.today!);
  }
  const tickMs = opts.tickMs ?? 500;
  const spot: Record<Underlying, number> = { ...SPOT0 };
  const rnd = mulberry32(42);
  const chains = new Map<string, { seq: number; rows: ChainRow[] }>();
  const subs = new Map<WebSocket, Set<string>>();

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.url?.startsWith("/healthz")) {
      res.setHeader("content-type", "application/json");
      res.setHeader("access-control-allow-origin", "*");
      // Same shape as apps/gateway/src/server.ts: expiries live under feed.
      res.end(JSON.stringify({ ok: true, status: "ok", feed: { ready: true, expiries } }));
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  const wss = new WebSocketServer({ server });

  const send = (ws: WebSocket, msg: ServerMessage) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };
  const chainFor = (topic: string) => {
    let c = chains.get(topic);
    if (!c) {
      const p = parseTopic(topic);
      if (!p || p.kind !== "chain") return null;
      c = { seq: 0, rows: buildChain(p.underlying, p.expiry, Date.now(), fx) };
      chains.set(topic, c);
    }
    return c;
  };

  wss.on("connection", (ws) => {
    subs.set(ws, new Set());
    ws.on("message", (raw) => {
      let json: unknown;
      try {
        const text = Buffer.isBuffer(raw)
          ? raw.toString("utf8")
          : Array.isArray(raw)
            ? Buffer.concat(raw).toString("utf8")
            : Buffer.from(raw).toString("utf8");
        json = JSON.parse(text);
      } catch {
        send(ws, { t: "err", code: "BAD_JSON", message: "not json" });
        return;
      }
      const parsed = ClientMessage.safeParse(json);
      if (!parsed.success) {
        send(ws, { t: "err", code: "BAD_FRAME", message: "frame does not match ClientMessage" });
        return;
      }
      const msg = parsed.data;
      const mine = subs.get(ws)!;
      if (msg.op === "ping") {
        send(ws, { t: "pong" });
      } else if (msg.op === "sub") {
        for (const raw of msg.topics) {
          const topic = canonicalTopic(raw); // a bare spot topic is the default venue's (ADR-071)
          mine.add(topic);
          const p = parseTopic(topic);
          if (p?.kind === "chain") {
            const c = chainFor(topic);
            if (c) send(ws, { t: "snap", topic, seq: c.seq, rows: c.rows });
          } else if (p?.kind === "spot") {
            send(ws, { t: "spot", s: p.underlying, v: p.venue, p: dec(spot[p.underlying], 1), c24: -1.89 });
          }
        }
      } else {
        for (const raw of msg.topics) mine.delete(canonicalTopic(raw));
      }
    });
    ws.on("close", () => subs.delete(ws));
  });

  const broadcast = (msg: ServerMessage) => {
    const topic = msg.t === "snap" || msg.t === "q" ? msg.topic : msg.t === "spot" ? spotTopic(msg.s, msg.v ?? "delta_india") : null;
    for (const [ws, topics] of subs) if (!topic || topics.has(topic)) send(ws, msg);
  };

  let timer: NodeJS.Timeout | null = null;
  if (tickMs > 0) {
    timer = setInterval(() => {
      // spot ticks
      for (const u of Object.keys(spot) as Underlying[]) {
        spot[u] = spot[u] * (1 + (rnd() - 0.5) * 0.0006);
        // the tick loop quotes the default venue only: a Deribit-venue e2e gets the initial frame from the sub answer, never a tick (extend here when one is written)
        broadcast({ t: "spot", s: u, v: "delta_india", p: dec(spot[u], 1), c24: Number((-1.89 + (rnd() - 0.5) * 0.1).toFixed(2)) });
      }
      // chain deltas: 3 random instruments per subscribed chain
      for (const [topic, c] of chains) {
        const d: { i: string; mark: string; bid: string; ask: string; ts: number }[] = [];
        for (let n = 0; n < 3; n++) {
          const row = c.rows[Math.floor(rnd() * c.rows.length)];
          const side = rnd() > 0.5 ? row?.call : row?.put;
          if (!side) continue;
          const f = 1 + (rnd() - 0.5) * 0.01;
          const mark = Number(side.mark) * f;
          side.mark = dec(mark, 1);
          side.bid = dec(mark * 0.985, 1);
          side.ask = dec(mark * 1.015, 1);
          side.ts = Date.now();
          d.push({ i: side.instrumentId, mark: side.mark, bid: side.bid, ask: side.ask, ts: side.ts });
        }
        if (!d.length) continue;
        c.seq += 1;
        broadcast({ t: "q", topic, seq: c.seq, d });
      }
    }, tickMs);
  }

  await new Promise<void>((resolve) => server.listen(opts.port, "127.0.0.1", resolve));
  const url = `ws://127.0.0.1:${opts.port}`;
  return {
    server,
    wss,
    url,
    broadcast,
    close: () =>
      new Promise<void>((resolve) => {
        if (timer) clearInterval(timer);
        for (const ws of wss.clients) ws.terminate();
        wss.close(() => server.close(() => resolve()));
      }),
  };
}
