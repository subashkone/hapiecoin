import type { Metadata } from "next";
import { CouponsAdmin } from "@/components/admin/CouponsAdmin";

export const metadata: Metadata = { title: "Admin · Coupons" };

export default function Page() {
  return <CouponsAdmin />;
}
