import { redirect } from "next/navigation";

/** HC-MT-067: /terminal/sectors opens the first sector. */
export default function Page() {
  redirect("/terminal/sectors/layer-1");
}
