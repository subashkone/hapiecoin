"use client";
// ETF (HC-MA-054..059, 115): the page keeps the reference layout so navigation never dead-ends, but every panel is a
// "coming soon" block until a flows provider is chosen (GAPS #55: Farside has no API, Coinglass ETF endpoints are paid).
import { useState } from "react";
import { Chips } from "./Chips";
import { ComingSoon, Panel, Tile } from "./bits";

const ASSETS = ["bitcoin", "ethereum"] as const;
type Asset = (typeof ASSETS)[number];

export function EtfPage() {
  const [asset, setAsset] = useState<Asset>("bitcoin");
  const name = asset === "bitcoin" ? "Bitcoin" : "Ethereum";
  const why = "Daily spot-ETF flows, AUM and holdings come from a paid or terms-restricted source; the panel fills in once a provider is chosen.";
  return (
    <div className="space-y-4" data-testid="etf-page" data-asset={asset} data-state="soon">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[14px] font-medium">{name} Spot ETFs</h2>
        <span className="text-2xs text-muted-foreground">US-listed spot ETFs · flows, AUM and holdings</span>
        <div className="ml-auto">
          <Chips items={ASSETS} labels={{ bitcoin: "Bitcoin", ethereum: "Ethereum" }} value={asset} onChange={setAsset} testId="etf-asset" />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-3" data-testid="etf-tiles">
        <Tile label="7-day net flow" value="—" sub="needs a flows provider" testId="tile-flow" />
        <Tile label="Total AUM" value="—" sub={`${asset === "bitcoin" ? "BTC" : "ETH"} held · needs a holdings provider`} testId="tile-aum" />
        <Tile label="Funds tracked" value="—" sub="IBIT · FBTC · GBTC · ARKB · BITB …" testId="tile-funds" />
      </div>
      <Panel title="Net Flows" sub="daily net inflow/outflow (USD) with price overlay · timeframes 7D / 30D / 90D / 1Y" testId="panel-flows">
        <ComingSoon title={`${name} ETF net flows`} why={why} />
      </Panel>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Cumulative Net Flow" sub="since launch · USD" testId="panel-cumulative">
          <ComingSoon title="Cumulative net flow" why={why} />
        </Panel>
        <Panel title="Grayscale Holdings" sub="trust holdings & premium/discount" testId="panel-grayscale">
          <ComingSoon title="Grayscale trusts" why="Holdings and premium/discount per trust need the issuer's daily NAV feed." />
        </Panel>
      </div>
      <Panel title={`${name} ETF Funds`} sub="per-fund AUM, holdings and daily change" testId="panel-funds">
        <ComingSoon title="Per-fund table" why={why} />
      </Panel>
    </div>
  );
}
