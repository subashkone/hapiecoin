import { redirect } from "next/navigation";

/** HC-MT-113: /terminal/exchanges opens Binance. */
export default function Page() {
  redirect("/terminal/exchanges/binance");
}
