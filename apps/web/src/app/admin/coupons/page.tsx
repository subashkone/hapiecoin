import type { Metadata } from "next";
import { AdminLater } from "@/components/admin/AdminLater";

export const metadata: Metadata = { title: "Admin · Coupon Codes" };

export default function Page() {
  return <AdminLater title="Coupon Codes" item="Phase 4 item 2" blurb="Coupon master, validation rules and usage arrive with Razorpay checkout." />;
}
