import type { Metadata } from "next";
import { SubscriptionPage } from "@/components/account/SubscriptionPage";
import { PLANS_ON_SALE } from "@/content/landing";
import { getServerUser } from "@/lib/auth/server";

export const metadata: Metadata = { title: "My plan" };

/** ADR-140: while plans are not on sale the page shows no prices and no way to pay; an admin still sees them. */
export default async function Page() {
  const user = PLANS_ON_SALE ? null : await getServerUser();
  return <SubscriptionPage onSale={PLANS_ON_SALE || user?.role === "admin"} />;
}
