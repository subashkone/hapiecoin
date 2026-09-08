import type { Metadata } from "next";
import { AdminLater } from "@/components/admin/AdminLater";

export const metadata: Metadata = { title: "Admin · Promotional Emails" };

export default function Page() {
  return <AdminLater title="Promotional Emails" item="Phase 4 item 4" blurb="Campaigns to segments of users." />;
}
