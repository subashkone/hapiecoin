import type { Metadata } from "next";
import { PlansAdmin } from "@/components/admin/PlansAdmin";

export const metadata: Metadata = { title: "Admin · Subscription Plans" };

export default function Page() {
  return <PlansAdmin />;
}
