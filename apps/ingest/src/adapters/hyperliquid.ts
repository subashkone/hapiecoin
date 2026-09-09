/**
 * Hyperliquid public info API (hyperliquid.gitbook.io, verified 09 Sep 2026; base https://api.hyperliquid.xyz).
 *   POST /info { type: "clearinghouseState", user }  → { marginSummary, assetPositions: [{ position: { coin, szi, entryPx,
 *        positionValue, unrealizedPnl, liquidationPx, marginUsed, leverage: { type, value } } }] }; szi < 0 = short.
 *   POST /info { type: "metaAndAssetCtxs" }          → [ { universe: [{ name }] }, [{ markPx, ... }] ] aligned by index.
 *   REST info requests share 1200 weight/min per IP; clearinghouseState weighs 2, the others 20.
 * Wallet discovery uses the undocumented leaderboard the Hyperliquid UI reads (stats-data.hyperliquid.xyz/Mainnet/
 * leaderboard, ~37 MB JSON with ethAddress + accountValue); its accountValue is not the perp balance, so the job
 * scans the top rows and keeps the wallets that actually hold positions (ADR-043).
 */
import type { WhalePosition } from "@hapiecoin/schema";
import { z } from "zod";
import type { JsonClient } from "../http.js";

const num = z.coerce.number();
const Position = z.looseObject({ coin: z.string(), szi: num, entryPx: num.nullable().optional(), positionValue: num, unrealizedPnl: num.nullable().optional(), liquidationPx: num.nullable().optional(), marginUsed: num.nullable().optional(), leverage: z.looseObject({ type: z.string().optional(), value: num.optional() }).optional() });
const State = z.looseObject({ assetPositions: z.array(z.looseObject({ position: Position })) });
const MetaCtxs = z.tuple([z.looseObject({ universe: z.array(z.looseObject({ name: z.string() })) }), z.array(z.looseObject({ markPx: num.nullable().optional() }))]);
const Leaderboard = z.looseObject({ leaderboardRows: z.array(z.looseObject({ ethAddress: z.string(), accountValue: num })) });

export interface HyperliquidAdapterOptions {
  http: JsonClient;
  /** A client with a long timeout for the leaderboard download; defaults to `http`. */
  leaderboardHttp?: JsonClient;
  baseUrl: string;
  leaderboardUrl: string;
}

export class HyperliquidAdapter {
  private readonly http: JsonClient;
  private readonly lbHttp: JsonClient;
  private readonly baseUrl: string;
  private readonly leaderboardUrl: string;
  constructor(opts: HyperliquidAdapterOptions) {
    this.http = opts.http;
    this.lbHttp = opts.leaderboardHttp ?? opts.http;
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.leaderboardUrl = opts.leaderboardUrl;
  }

  /** Top `limit` wallets by the leaderboard's account value, lower-cased. */
  async leaderboard(limit: number): Promise<string[]> {
    const body = await this.lbHttp.get(this.leaderboardUrl, Leaderboard);
    return body.leaderboardRows
      .sort((a, b) => b.accountValue - a.accountValue)
      .slice(0, limit)
      .map((r) => r.ethAddress.toLowerCase());
  }

  /** Open perpetual positions of one wallet; `markPx` is filled by the caller from `markPrices()`. */
  async positions(wallet: string): Promise<WhalePosition[]> {
    const state = await this.http.post(`${this.baseUrl}/info`, State, { type: "clearinghouseState", user: wallet });
    const out: WhalePosition[] = [];
    for (const { position: p } of state.assetPositions) {
      if (p.szi === 0 || !(p.entryPx && p.entryPx > 0)) continue;
      out.push({
        wallet,
        coin: p.coin,
        side: p.szi > 0 ? "long" : "short",
        size: Math.abs(p.szi),
        notionalUsd: Math.abs(p.positionValue),
        entryPx: p.entryPx,
        markPx: null,
        liquidationPx: p.liquidationPx && p.liquidationPx > 0 ? p.liquidationPx : null,
        unrealizedPnl: p.unrealizedPnl ?? 0,
        leverage: p.leverage?.value && p.leverage.value > 0 ? p.leverage.value : 1,
        leverageType: p.leverage?.type ?? "cross",
        marginUsed: Math.max(0, p.marginUsed ?? 0),
      });
    }
    return out;
  }

  async markPrices(): Promise<Map<string, number>> {
    const [meta, ctxs] = await this.http.post(`${this.baseUrl}/info`, MetaCtxs, { type: "metaAndAssetCtxs" });
    const out = new Map<string, number>();
    meta.universe.forEach((u, i) => {
      const px = ctxs[i]?.markPx;
      if (px !== null && px !== undefined && px > 0) out.set(u.name, px);
    });
    return out;
  }
}
