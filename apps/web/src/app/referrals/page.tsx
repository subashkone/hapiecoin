import type { Metadata } from "next";
import { PhasePlaceholder } from "@/components/shell/PhasePlaceholder";

export const metadata: Metadata = { title: "Referrals" };

export default function Page() {
  return <PhasePlaceholder title="Referrals" phase={4} blurb="Your referral code, invited traders and earned commission." />;
}
