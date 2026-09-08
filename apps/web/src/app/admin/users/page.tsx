import type { Metadata } from "next";
import { AdminLater } from "@/components/admin/AdminLater";

export const metadata: Metadata = { title: "Admin · Users" };

export default function Page() {
  return <AdminLater title="User Management" item="Phase 4 item 4" blurb="Roles, search, bulk actions and account details. Plan-level edits are already on User Subscriptions." />;
}
