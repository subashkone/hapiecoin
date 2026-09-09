import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { AnalyticsShell } from "@/components/analytics/AnalyticsShell";
import { AppHeader } from "@/components/header/AppHeader";
import { SettingsDialogsLoader } from "@/components/dialogs/SettingsDialogsLoader";
import { TerminalShell } from "@/components/terminal/TerminalShell";
import { getServerUser } from "@/lib/auth/server";

/** The terminal shares the analytics shell (HC-MA-088, HC-MT-152, 153) and adds its sidebar; logged-out users go to /auth (HC-MT-038). */
export default async function Layout({ children }: { children: ReactNode }) {
  const user = await getServerUser();
  if (!user) redirect("/auth?next=%2Fterminal");
  return (
    <>
      <AppHeader variant="default" initialUser={user} />
      <AnalyticsShell>
        <TerminalShell>{children}</TerminalShell>
      </AnalyticsShell>
      <SettingsDialogsLoader />
    </>
  );
}
