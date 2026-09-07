import type { Metadata } from "next";
import { WorkspaceLoader } from "@/components/workspace/WorkspaceLoader";

export const metadata: Metadata = { title: "Analyse" };

export default function AnalysePage() {
  return (
    <main>
      <WorkspaceLoader />
    </main>
  );
}
