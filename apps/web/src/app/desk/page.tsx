import type { Metadata } from "next";
import { WorkspaceLoader } from "@/components/workspace/WorkspaceLoader";

export const metadata: Metadata = { title: "Desk" };

export default function DeskPage() {
  return (
    <main>
      <WorkspaceLoader />
    </main>
  );
}
