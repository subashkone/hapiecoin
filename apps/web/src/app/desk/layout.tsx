// Protected: server-side session check via the API; anonymous visitors go to /auth?next=/desk (HC-PB-036).
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AppHeader } from "@/components/header/AppHeader";
import { SettingsDialogsLoader } from "@/components/dialogs/SettingsDialogsLoader";
import { PortfolioBarLoader } from "@/components/chrome/PortfolioBarLoader";
import { getServerUser } from "@/lib/auth/server";

export default async function DeskLayout({ children }: { children: ReactNode }) {
  const user = await getServerUser();
  if (!user) redirect("/auth?next=%2Fdesk");
  return (
    <>
      <AppHeader variant="desk" initialUser={user} />
      {children}
      <PortfolioBarLoader />
      <SettingsDialogsLoader />
    </>
  );
}
