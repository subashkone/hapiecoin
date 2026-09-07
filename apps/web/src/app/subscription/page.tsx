import type { Metadata } from "next";
import { PhasePlaceholder } from "@/components/shell/PhasePlaceholder";

export const metadata: Metadata = { title: "Subscription" };

export default function Page() {
  return <PhasePlaceholder title="Subscription" phase={4} blurb="Plans, invoices, coupons and Razorpay checkout." />;
}
