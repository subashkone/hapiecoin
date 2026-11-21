import type { Metadata } from "next";
import { AutopilotPage } from "@/components/autopilot/AutopilotPage";

export const metadata: Metadata = { title: "Autopilot" };

export default function Page() {
  return <AutopilotPage />;
}
