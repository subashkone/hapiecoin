import type { Metadata } from "next";
import { BannersAdmin } from "@/components/admin/BannersAdmin";

export const metadata: Metadata = { title: "Admin · Banners" };

export default function Page() {
  return <BannersAdmin />;
}
