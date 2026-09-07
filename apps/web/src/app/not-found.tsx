// 404 (mock: "Oops! Page not found" with Return to Home).
import Link from "next/link";
import { Button } from "@/components/ui";

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center px-6 text-center">
      <div>
        <p className="micro">Error</p>
        <h1 className="num mt-2 text-[64px] leading-none">404</h1>
        <p className="mt-3 text-muted-foreground">Oops! Page not found</p>
        <Button asChild variant="outline" className="mt-6">
          <Link href="/">Return to Home</Link>
        </Button>
      </div>
    </main>
  );
}
