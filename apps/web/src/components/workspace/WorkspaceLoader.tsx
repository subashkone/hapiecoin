"use client";
// Route-level split: the workspace (virtualiser, chain) loads as its own chunk after the header paints.
import { Spinner } from "@hapiecoin/ui";
import dynamic from "next/dynamic";

export const WorkspaceLoader = dynamic(() => import("./Workspace").then((m) => m.Workspace), {
  ssr: false,
  loading: () => (
    <div className="grid h-[calc(100vh-50px)] place-items-center" data-testid="workspace-loading">
      <Spinner size="lg" label="Loading workspace" />
    </div>
  ),
});
