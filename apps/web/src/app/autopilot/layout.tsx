// Protected like the Desk: anonymous visitors go to /auth?next=/autopilot, a signed-in visitor without a plan to
// /plans when no Free plan is on offer (ADR-107). HC-TR-219.
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AppHeader } from "@/components/header/AppHeader";
import { SettingsDialogsLoader } from "@/components/dialogs/SettingsDialogsLoader";
import { getServerUser, hasWorkspaceAccess } from "@/lib/auth/server";

export default async function Layout({ children }: { children: ReactNode }) {
  const user = await getServerUser();
  if (!user) redirect("/auth?next=%2Fautopilot");
  if (!(await hasWorkspaceAccess())) redirect("/plans?need=plan");
  return (
    <>
      <AppHeader variant="default" initialUser={user} />
      {children}
      <SettingsDialogsLoader />
    </>
  );
}
