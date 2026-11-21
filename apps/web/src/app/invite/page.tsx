import type { Metadata } from "next";
import { ReferralsPage } from "@/components/account/ReferralsPage";

export const metadata: Metadata = { title: "Referrals" };

export default function Page() {
  return <ReferralsPage />;
}
