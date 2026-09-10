"use client";
// Client-only mount of the portfolio bar (it reads the gateway, the strategies and the settings queries).
import dynamic from "next/dynamic";

export const PortfolioBarLoader = dynamic(() => import("./PortfolioBar").then((m) => m.PortfolioBar), { ssr: false });
