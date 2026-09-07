import type { ReactNode } from "react";
import { AppHeader } from "@/components/header/AppHeader";
import { SettingsDialogsLoader } from "@/components/dialogs/SettingsDialogsLoader";
import { getServerUser } from "@/lib/auth/server";

export default async function Layout({ children }: { children: ReactNode }) {
  const user = await getServerUser();
  return (
    <>
      <AppHeader variant="default" initialUser={user} />
      {children}
      <SettingsDialogsLoader />
    </>
  );
}
