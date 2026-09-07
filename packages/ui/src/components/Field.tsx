import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { Label } from "./Label";

/** Attributes Field wires onto its control so label, hint and error are announced together. */
export interface FieldControlProps {
  id: string;
  "aria-describedby": string | undefined;
  "aria-invalid": true | undefined;
  "aria-required": true | undefined;
}

export interface FieldProps {
  label: ReactNode;
  /** Explicit control id; generated when omitted. */
  id?: string;
  hint?: ReactNode;
  /** Error message; when set the control gets `aria-invalid` and the message replaces the hint. */
  error?: ReactNode;
  required?: boolean;
  className?: string;
  /** Either a control element (props are cloned onto it) or a render function receiving them. */
  children: ReactElement<Partial<FieldControlProps>> | ((control: FieldControlProps) => ReactNode);
}

/** Label + control + hint/error with the aria links wired (labels, hints and errors read out together). */
export function Field({ label, id, hint, error, required = false, className, children }: FieldProps) {
  const generated = useId();
  const controlId = id ?? generated;
  const hintId = `${controlId}-hint`;
  const errorId = `${controlId}-error`;
  const describedBy = error ? errorId : hint ? hintId : undefined;
  const control: FieldControlProps = {
    id: controlId,
    "aria-describedby": describedBy,
    "aria-invalid": error ? true : undefined,
    "aria-required": required ? true : undefined,
  };

  return (
    <div data-slot="field" className={cn("mb-3", className)}>
      <Label htmlFor={controlId} className="mb-[5px]">
        {label}
        {required ? (
          <span aria-hidden="true" className="ml-0.5 text-destructive">
            *
          </span>
        ) : null}
      </Label>
      {typeof children === "function"
        ? children(control)
        : isValidElement(children)
          ? cloneElement(children, control)
          : children}
      {error ? (
        <p id={errorId} role="alert" className="mt-1 text-2xs text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="mt-1 text-2xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
