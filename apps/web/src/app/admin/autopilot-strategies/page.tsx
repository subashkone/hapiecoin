import type { Metadata } from "next";
import { AutopilotStrategiesAdmin } from "@/components/admin/AutopilotStrategiesAdmin";

export const metadata: Metadata = { title: "Admin · Autopilot strategies" };

export default function Page() {
  return <AutopilotStrategiesAdmin />;
}
