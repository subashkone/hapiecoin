import type { Metadata } from "next";
import { PhasePlaceholder } from "@/components/shell/PhasePlaceholder";

export const metadata: Metadata = { title: "Admin" };

export default function Page() {
  return <PhasePlaceholder title="Admin" phase={5} blurb="User management, plans, coupons, banners and promotional emails." />;
}
