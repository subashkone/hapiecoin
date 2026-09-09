# Analyse tabs · Scenarios, Vol, Structure (Phase 5 item 1, ADR-045)

Built 09 Sep 2026 on `feat/analyse-tabs`. The three placeholder tabs of the analysis pane became live views of the
followed position (ADR-026) and the live gateway chain.

## Scenarios (HC-WS-088..093)
`components/analysis/ScenariosPanel.tsx` over `useScenario` (pricing worker `scenario` op) and `lib/chain/structure.ts`
`scenarioAxes`: eleven price rows from +range to −range (±10 % in 2 % steps, ±20 % in 4 %), six date columns (today,
¼, ½, ¾, expiry − 1 d, expiry at its settlement instant), modes P&L / Δ / Θ with a unit line, an IV slider (−20…+20 %
of ATM IV, sent as the engine's additive vol-point shift), cells shaded by magnitude (`heatAlpha`), the target cell
outlined and a click on any cell moving the payoff sliders, hover / focus readout, and a Smooth toggle that draws a
bilinear heat field with the break-even ridge, the spot row and the target outline (`heatDraw.ts`, pure canvas).

## Vol (HC-WS-094..097)
`VolPanel.tsx`: the smile of the shown expiry (`smile()` on the OTM side per spot) with the strategy's strikes as
amber labels, ATM IV, the 25Δ skew from the quotes' own deltas (`skew25`), the expected move to expiry; the ATM IV
term structure across every listed expiry (`useChains`) with chips that switch the workspace expiry and a contango /
backwardation note (`termShape`). The shown expiry (`lib/chain/useShownExpiry.ts`) is the workspace's when chosen,
else the strategy's nearest listed one, with a hint back to the strategy's expiry. IV rank and realised vs implied
are `ComingSoon` panels (GAPS #62).

## Structure (HC-WS-098..100)
`StructurePanel.tsx`: call / put OI bars ±12 strikes around the money with the max-pain and spot labels (`maxPain`
over every listed strike), Σ OI, the strategy's strikes; put / call ratios on OI and 24 h volume with share bars and
the put-heavy / call-heavy / balanced read; dealer GEX per strike (`gammaExposure(rows, spot, lot size)`), net GEX and
the gamma-flip strike. A basis line says the figures come from one expiry of the live chain, unlike the Options page.

## Tests
`lib/chain/structure.test.ts`, `components/analysis/heatDraw.test.ts` (recording canvas), `analysis-tabs.test.tsx`
(inline engine + fake gateway), e2e `analyse.spec.ts` (tabs block), visuals `analyse-scenarios`, `-scenarios-smooth`,
`-vol`, `-structure` per theme.
