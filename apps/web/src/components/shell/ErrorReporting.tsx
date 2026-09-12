"use client";
// Mounts the window error listeners once for the app (ADR-081; HC-SH-132). Renders nothing.
import { useEffect } from "react";
import { installErrorReporting } from "@/lib/errors/report";

export function ErrorReporting() {
  useEffect(() => installErrorReporting(), []);
  return null;
}
