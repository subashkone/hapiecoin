// Public home page route (HC-PB-070; ADR-140): the page itself is components/landing/HomePage.
import type { Metadata } from "next";
import { HomePage } from "@/components/landing/HomePage";

export const metadata: Metadata = {
  title: "HapieCoin · Know your worst case before you place the trade",
  description: "A desk for BTC, ETH and gold options on Indian exchanges: build a strategy, see what it can make and lose, practise on paper, and let stop and target rules watch it.",
};

export default function LandingPage() {
  return <HomePage />;
}
