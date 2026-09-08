import type { Metadata } from "next";
import { MenuItemsAdmin } from "@/components/admin/MenuItemsAdmin";

export const metadata: Metadata = { title: "Admin · Menu Pricing" };

export default function Page() {
  return <MenuItemsAdmin />;
}
