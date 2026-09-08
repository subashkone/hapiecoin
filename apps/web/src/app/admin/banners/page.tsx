import type { Metadata } from "next";
import { AdminLater } from "@/components/admin/AdminLater";

export const metadata: Metadata = { title: "Admin · Banners" };

export default function Page() {
  return <AdminLater title="Banner Master" item="Phase 4 item 4" blurb="Banner flyers shown in the app chrome." />;
}
