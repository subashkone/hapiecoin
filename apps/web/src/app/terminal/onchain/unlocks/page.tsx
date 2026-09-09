import type { Metadata } from "next";
import { UnlocksPage } from "@/components/terminal/IndicatorPages";

export const metadata: Metadata = { title: "Token Unlocks · Terminal · Market Analytics" };

/** HC-MT-142, 143 */
export default function Page() {
  return <UnlocksPage />;
}
