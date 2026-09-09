import type { ReactNode } from "react";
import { AnalyticsShell } from "@/components/analytics/AnalyticsShell";
import { AppHeader } from "@/components/header/AppHeader";
import { SettingsDialogsLoader } from "@/components/dialogs/SettingsDialogsLoader";
import { getServerUser } from "@/lib/auth/server";

/** The terminal shares the analytics shell (HC-MA-088, HC-MT-152, 153). */
export default async function Layout({ children }: { children: ReactNode }) {
  const user = await getServerUser();
  return (
    <>
      <AppHeader variant="default" initialUser={user} />
      <AnalyticsShell>{children}</AnalyticsShell>
      <SettingsDialogsLoader />
    </>
  );
}
