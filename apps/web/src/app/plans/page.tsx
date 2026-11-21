import type { Metadata } from "next";
import { SubscriptionPage } from "@/components/account/SubscriptionPage";

export const metadata: Metadata = { title: "My plan" };

export default function Page() {
  return <SubscriptionPage />;
}
