// Landing copy, verbatim from the v2 mock (mockup-v2/public-src/20-landing.js). Server-safe: plain data.

export const HERO_BULLETS = [
  "Real-time Options Chain with Live Greeks",
  "28 Pre-built Strategy Templates",
  "Risk-free Paper Trading Mode",
  "Interactive P&L Payoff Diagrams",
  "WebSocket Streaming Prices",
  "Multi-leg Strategy Builder",
] as const;

export const STATS = [
  { icon: "layers", value: "28", label: "Built-in Strategies" },
  { icon: "activity", value: "Real-time", label: "Greeks & IV" },
  { icon: "coins", value: "3", label: "Assets Supported" },
  { icon: "shield", value: "Paper", label: "Trading" },
] as const;

export const WITHOUT = [
  "Guessing strike prices blindly",
  "No real-time Greeks or IV data",
  "Manual P&L tracking on spreadsheets",
  "No way to test strategies risk-free",
  "Scattered tools across platforms",
] as const;

export const WITH = [
  "ATM detection + full options chain",
  "Live Delta, Gamma, Theta, Vega & IV",
  "Automated P&L with payoff charts",
  "Free paper trading with live prices",
  "All-in-one analytics dashboard",
] as const;

export const FEATURE_TABS = [
  {
    id: "chain",
    title: "Real-time Options Chain",
    bullets: [
      "Live Greeks: Delta, Gamma, Theta, Vega",
      "Implied Volatility & Open Interest",
      "Bid/Ask spreads with depth",
      "WebSocket streaming updates",
    ],
  },
  {
    id: "builder",
    title: "Strategy Builder & Payoff",
    bullets: [
      "Build multi-leg strategies visually",
      "Interactive P&L payoff charts",
      "Max profit, max loss & breakevens",
      "28 pre-built strategy templates",
    ],
  },
  {
    id: "trading",
    title: "Paper & Live Trading",
    bullets: [
      "Risk-free paper trading mode",
      "Real-time P&L tracking",
      "Position management & adjustments",
      "One-click live execution via Delta",
    ],
  },
] as const;

export const CAPABILITIES = [
  {
    icon: "activity",
    title: "Live Greeks & IV",
    desc: "Delta, Gamma, Theta, Vega — all updated in real-time with sub-second WebSocket streaming for precise risk assessment.",
    large: true,
  },
  { icon: "crosshair", title: "ATM Detection", desc: "Auto-detect at-the-money strikes for quick strategy setup." },
  { icon: "gitbranch", title: "Multi-leg Strategies", desc: "Build complex spreads, strangles, iron condors & more." },
  {
    icon: "radio",
    title: "WebSocket Prices",
    desc: "Sub-second price updates via WebSocket streaming for lightning-fast decisions.",
  },
  {
    icon: "shield",
    title: "Risk Management",
    desc: "Max profit, max loss, breakeven analysis, and comprehensive risk metrics — everything you need to manage exposure with confidence.",
    large: true,
  },
  { icon: "globe", title: "Multiple Assets", desc: "Trade BTC, ETH & XAUT options on Delta Exchange." },
] as const;

export const FEATURE_LIST = [
  {
    icon: "barchart",
    title: "Options Analytics",
    features: [
      "Real-time Options Chain with live bid/ask prices",
      "Full Greeks display — Delta, Gamma, Theta, Vega, Rho",
      "Implied Volatility (IV) calculations",
      "ATM (At-The-Money) strike auto-detection",
      "Open Interest & Volume analysis",
      "Multi-expiry support with quick switching",
    ],
  },
  {
    icon: "gitbranch",
    title: "Strategy Builder",
    features: [
      "Multi-leg strategy construction (up to 4 legs)",
      "Pre-built strategy templates (Straddle, Strangle, Spreads…)",
      "Payoff diagram with breakeven visualization",
      "Max Profit / Max Loss / Risk-Reward ratio",
      "Custom strike & expiry selection per leg",
      "Save & load strategies for later analysis",
    ],
  },
  {
    icon: "wallet",
    title: "Paper Trading",
    features: [
      "Simulated order execution with live market prices",
      "Track P&L in real-time without real capital",
      "Position management — view, modify & square-off",
      "Order history with entry / exit details",
      "Exchange charges & fee simulation",
      "Practice strategies risk-free before going live",
    ],
  },
  {
    icon: "activity",
    title: "Live Market Data",
    features: [
      "WebSocket streaming for sub-second price updates",
      "BTC, ETH & XAUT futures price with 24h change",
      "Live P&L tracking on open positions",
      "Connection status indicators",
      "Automatic reconnection on network drops",
      "Binance & Delta Exchange data feeds",
    ],
  },
  {
    icon: "shield",
    title: "Risk Management",
    features: [
      "Position-level & portfolio-level risk metrics",
      "Breakeven price calculation",
      "Probability of profit estimation",
      "Max drawdown & exposure analysis",
      "Lot size & margin calculator",
      "Currency conversion (USD / INR)",
    ],
  },
  {
    icon: "settings",
    title: "Platform & Settings",
    features: [
      "Dark / Light theme toggle",
      "API key management for Delta Exchange",
      "Exchange charge configuration",
      "Custom lot size settings",
      "User profile & subscription management",
      "Mobile-responsive design",
    ],
  },
] as const;

export const WHATS_NEW = [
  {
    icon: "grid",
    title: "Scenario matrix",
    desc: "P&L by price × date in one colour-scaled table — the most-used paid feature, now first-class in the Scenarios tab.",
  },
  {
    icon: "sliders",
    title: "Vol & Structure tabs",
    desc: "IV smile, term structure, open-interest walls and max pain for the selected expiry, right beside the chain.",
  },
  {
    icon: "bell",
    title: "Alerts",
    desc: "Price, IV rank and strategy P&L alerts evaluated on every tick — delivered by push, email or Telegram.",
  },
  {
    icon: "command",
    title: "Command palette",
    desc: "Ctrl K anywhere: jump to a screen, switch asset, toggle theme or density, arm an alert. Press ? for every shortcut.",
  },
  {
    icon: "book",
    title: "Journal",
    desc: "Every paper and live trade with notes, tags and outcome — searchable, filterable and exportable.",
  },
  {
    icon: "share",
    title: "Share links",
    desc: "Share a strategy as a link with legs, payoff and scenario matrix embedded for review.",
  },
] as const;

export const EXCHANGES = [
  { name: "Delta Exchange", status: "live", mark: "Δ" },
  { name: "CoinDCX", status: "coming", mark: "DCX" },
  { name: "CoinSwitch", status: "coming", mark: "CS" },
  { name: "Mudrex", status: "coming", mark: "M" },
] as const;

export const AUTH_FEATURES = [
  { icon: "barchart", title: "Real-time Analytics", desc: "Live options chain with Greeks & IV" },
  { icon: "shield", title: "Paper Trading", desc: "Practice risk-free before going live" },
  { icon: "zap", title: "Strategy Builder", desc: "Build & backtest custom strategies" },
  { icon: "trending", title: "Payoff Charts", desc: "Visualize P&L across strike prices" },
] as const;

export const SUPPORT_EMAIL = "support@hapiecoin.com";
export const SUPPORT_WHATSAPP = { href: "https://wa.me/919684022369", label: "+91 96840 22369" };
