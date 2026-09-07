"use client";
// Small anchored menu (settings gear, account avatar). @hapiecoin/ui has no dropdown yet; this keeps the
// behaviour minimal and accessible: Escape / outside click close, arrow keys move, Enter activates.
import { cn } from "@hapiecoin/ui";
import Link from "next/link";
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";

export interface MenuProps {
  open: boolean;
  onClose: () => void;
  /** Anchored to the right edge of the trigger by default. */
  align?: "left" | "right";
  label: string;
  children: ReactNode;
  className?: string;
  testId?: string;
}

export function Menu({ open, onClose, align = "right", label, children, className, testId }: MenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const el = ref.current;
      if (el && !el.contains(e.target as Node) && !el.parentElement?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    const first = ref.current?.querySelector<HTMLElement>("[role=menuitem]");
    first?.focus();
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = [...(ref.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    const next = e.key === "ArrowDown" ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
    items[next]?.focus();
  };

  if (!open) return null;
  return (
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      data-testid={testId}
      onKeyDown={onKeyDown}
      className={cn(
        "absolute top-full z-50 mt-1.5 min-w-[220px] rounded-md border border-border bg-popover p-1 text-[12.5px] text-popover-foreground shadow-[0_14px_40px_-14px_rgba(0,0,0,0.7)]",
        align === "right" ? "right-0" : "left-0",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <div className="micro px-2 pt-2 pb-1">{children}</div>;
}

export function MenuSeparator() {
  return <div role="separator" className="my-1 h-px bg-border" />;
}

const itemClass =
  "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left outline-none hover:bg-muted focus-visible:bg-muted [&>svg]:size-3.5 [&>svg]:text-muted-foreground";

export interface MenuItemProps {
  onSelect?: () => void;
  href?: string;
  external?: boolean;
  danger?: boolean | undefined;
  /** Right-aligned mono value (e.g. current currency). */
  value?: string | undefined;
  children: ReactNode;
  testId?: string | undefined;
}

export function MenuItem({ onSelect, href, external, danger, value, children, testId }: MenuItemProps) {
  const cls = cn(itemClass, danger && "text-destructive hover:bg-destructive/10");
  const content = (
    <>
      {children}
      {value !== undefined ? <span className="ml-auto font-mono text-2xs text-muted-foreground">{value}</span> : null}
    </>
  );
  if (href && external) {
    return (
      <a role="menuitem" href={href} target="_blank" rel="noopener noreferrer" className={cls} data-testid={testId}>
        {content}
      </a>
    );
  }
  if (href) {
    return (
      <Link role="menuitem" href={href} className={cls} data-testid={testId} onClick={() => onSelect?.()}>
        {content}
      </Link>
    );
  }
  return (
    <button type="button" role="menuitem" onClick={onSelect} className={cls} data-testid={testId}>
      {content}
    </button>
  );
}
