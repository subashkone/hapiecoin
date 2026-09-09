import { redirect } from "next/navigation";

/** /analytics opens the Markets Hub (HC-MA-001). */
export default function Page() {
  redirect("/analytics/hub");
}
