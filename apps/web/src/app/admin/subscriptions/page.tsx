import type { Metadata } from "next";
import { UserSubscriptionsAdmin } from "@/components/admin/UserSubscriptionsAdmin";

export const metadata: Metadata = { title: "Admin · User Subscriptions" };

export default function Page() {
  return <UserSubscriptionsAdmin />;
}
