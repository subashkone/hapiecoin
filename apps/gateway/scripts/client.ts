/**
 * Live gateway client (NOT a unit test; never run under NODE_ENV=test).
 *
 *   pnpm --filter @hapiecoin/gateway client            # against ws://localhost:3002
 *   GATEWAY_URL=ws://host:port pnpm --filter @hapiecoin/gateway client
 *
 * Reads the nearest BTC expiry from /healthz, subscribes `chain:delta_india:BTC:<expiry>` and `spot:BTC`,
 * prints every frame for 20 s (snapshot row count, then deltas with their seq) and a summary.
 */
import type { ServerMessage } from "@hapiecoin/schema";

if (process.env.NODE_ENV === "test") {
  throw new Error("scripts/client.ts talks to a live gateway and must not run in the test environment");
}

const WS_URL = process.env.GATEWAY_URL ?? "ws://localhost:3002";
const HTTP_URL = WS_URL.replace(/^ws/, "http");
const RUN_MS = Number(process.env.CLIENT_MS ?? 20_000);

interface Health {
  ok: boolean;
  status: string;
  feed: {
    expiries: { BTC: string[] };
    spot: { BTC: string | null };
    market: { socket: string; subscribed: number };
  };
}

function stamp(): string {
  return new Date().toISOString().slice(11, 23);
}

async function main(): Promise<void> {
  const health = (await (await fetch(`${HTTP_URL}/healthz`)).json()) as Health;
  console.log(
    `${stamp()} healthz status=${health.status} socket=${health.feed.market.socket} spot=${health.feed.spot.BTC ?? "-"} expiries=${health.feed.expiries.BTC.join(",")}`,
  );
  const expiry = health.feed.expiries.BTC[0];
  if (!expiry) throw new Error("gateway lists no BTC expiry; is the feed loaded?");
  const chainTopic = `chain:delta_india:BTC:${expiry}`;

  const ws = new WebSocket(WS_URL);
  const counts = { snap: 0, q: 0, deltas: 0, spot: 0, pong: 0, err: 0 };
  let lastSeq = -1;
  let gaps = 0;

  ws.addEventListener("open", () => {
    console.log(`${stamp()} open ${WS_URL}; subscribing ${chainTopic} and spot:BTC`);
    ws.send(JSON.stringify({ op: "sub", topics: [chainTopic, "spot:BTC"] }));
    ws.send(JSON.stringify({ op: "ping" }));
  });
  ws.addEventListener("message", (event) => {
    const frame = JSON.parse(String(event.data)) as ServerMessage;
    switch (frame.t) {
      case "snap": {
        counts.snap += 1;
        const quoted = frame.rows.filter((r) => r.call ?? r.put).length;
        const atm = frame.rows.find((r) => r.call?.markIv !== undefined);
        console.log(
          `${stamp()} snap ${frame.topic} seq=${frame.seq} rows=${frame.rows.length} quoted=${quoted} strikes=${frame.rows[0]?.strike}..${frame.rows.at(-1)?.strike}` +
            (atm
              ? ` sample ${atm.strike}C mark=${atm.call?.mark} iv=${atm.call?.markIv} oi=${atm.call?.oi}`
              : ""),
        );
        lastSeq = frame.seq;
        return;
      }
      case "q": {
        counts.q += 1;
        counts.deltas += frame.d.length;
        if (lastSeq >= 0 && frame.seq !== lastSeq + 1) gaps += 1;
        lastSeq = frame.seq;
        const first = frame.d[0];
        const fields = first
          ? Object.keys(first)
              .filter((k) => k !== "i")
              .join(",")
          : "";
        console.log(
          `${stamp()} q seq=${frame.seq} deltas=${frame.d.length} first=${first?.i ?? "-"} [${fields}]`,
        );
        return;
      }
      case "spot":
        counts.spot += 1;
        console.log(`${stamp()} spot ${frame.s}=${frame.p}`);
        return;
      case "pong":
        counts.pong += 1;
        console.log(`${stamp()} pong`);
        return;
      case "err":
        counts.err += 1;
        console.log(`${stamp()} err ${frame.code}: ${frame.message}`);
        return;
    }
  });
  ws.addEventListener("close", (event) =>
    console.log(`${stamp()} close code=${event.code} reason=${event.reason}`),
  );
  ws.addEventListener("error", () => console.log(`${stamp()} socket error`));

  await new Promise((resolve) => setTimeout(resolve, RUN_MS));
  ws.close(1000, "done");
  console.log(
    `done: ${RUN_MS / 1000} s, snap=${counts.snap} q-frames=${counts.q} deltas=${counts.deltas} spot=${counts.spot} pong=${counts.pong} err=${counts.err} lastSeq=${lastSeq} seqGaps=${gaps}`,
  );
}

main().catch((error: unknown) => {
  console.error("client failed:", error);
  process.exitCode = 1;
});
