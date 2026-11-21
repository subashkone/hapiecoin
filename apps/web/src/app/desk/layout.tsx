// Protected: server-side session check via the API; anonymous visitors go to /auth?next=/desk (HC-PB-036).
// A signed-in visitor with no plan, when no Free plan is on offer, goes to /plans (ADR-107).
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AppHeader } from "@/components/header/AppHeader";
import { SettingsDialogsLoader } from "@/components/dialogs/SettingsDialogsLoader";
import { PortfolioBarLoader } from "@/components/chrome/PortfolioBarLoader";
import { getServerUser, hasWorkspaceAccess } from "@/lib/auth/server";

export default async function DeskLayout({ children }: { children: ReactNode }) {
  const user = await getServerUser();
  if (!user) redirect("/auth?next=%2Fdesk");
  if (!(await hasWorkspaceAccess())) redirect("/plans?need=plan");
  return (
    <>
      <AppHeader variant="desk" initialUser={user} />
      {children}
      <PortfolioBarLoader />
      <SettingsDialogsLoader />
    </>
  );
}
