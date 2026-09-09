import type { Metadata } from "next";
import { EmailsAdmin } from "@/components/admin/EmailsAdmin";

export const metadata: Metadata = { title: "Admin · Promotional Emails" };

export default function Page() {
  return <EmailsAdmin />;
}
