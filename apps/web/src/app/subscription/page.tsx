import type { Metadata } from "next";
import { SubscriptionPage } from "@/components/account/SubscriptionPage";

export const metadata: Metadata = { title: "My Subscription" };

export default function Page() {
  return <SubscriptionPage />;
}
