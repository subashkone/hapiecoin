import type { ReactNode } from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import { SettingsDialogsLoader } from "@/components/dialogs/SettingsDialogsLoader";
import { AppHeader } from "@/components/header/AppHeader";
import { getServerUser } from "@/lib/auth/server";

export default async function Layout({ children }: { children: ReactNode }) {
  const user = await getServerUser();
  return (
    <>
      <AppHeader variant="default" initialUser={user} />
      <AdminShell>{children}</AdminShell>
      <SettingsDialogsLoader />
    </>
  );
}
