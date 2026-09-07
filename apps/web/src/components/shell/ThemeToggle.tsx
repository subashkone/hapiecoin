"use client";
// Theme toggle (HC-PB-003 public, HC-SH-011 app): moon/sun with the mock's titles.
import { Button, Moon, Sun, useTheme } from "@hapiecoin/ui";
import { useMounted } from "@/lib/use-mounted";

export function ThemeToggle({ className }: { className?: string }) {
  const theme = useTheme();
  // The stored theme is only known in the browser; render the server's dark variant until mounted.
  const resolvedTheme = useMounted() ? theme.resolvedTheme : "dark";
  const { toggleTheme } = theme;
  const title = resolvedTheme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode";
  return (
    <Button
      variant="ghost"
      size="sm"
      iconOnly
      onClick={toggleTheme}
      title={title}
      aria-label={title}
      data-testid="theme-toggle"
      {...(className ? { className } : {})}
    >
      {resolvedTheme === "dark" ? <Sun className="size-4" aria-hidden="true" /> : <Moon className="size-4" aria-hidden="true" />}
    </Button>
  );
}
