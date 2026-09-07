import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { Field, type FieldControlProps } from "./Field";
import { Input } from "./Input";
import { Label } from "./Label";
import { Textarea } from "./Textarea";

describe("[UI-FORM] Input / Textarea / Label / Field", () => {
  it("[UI-FORM] Input uses the control chrome tokens and md height by default", () => {
    render(<Input aria-label="Qty" />);
    const input = screen.getByLabelText("Qty");
    expect(input.getAttribute("type")).toBe("text");
    expect(input.className).toContain("border-input");
    expect(input.className).toContain("bg-background");
    expect(input.className).toContain("h-8");
  });

  it("[UI-FORM] Input numeric sets decimal inputMode, mono tabular figures and right alignment", () => {
    render(<Input numeric aria-label="Price" size="sm" />);
    const input = screen.getByLabelText("Price");
    expect(input.getAttribute("inputmode")).toBe("decimal");
    expect(input.className).toContain("num");
    expect(input.className).toContain("text-right");
    expect(input.className).toContain("h-7");
  });

  it("[UI-FORM] Input numeric with a non-text type leaves inputMode alone", () => {
    render(<Input numeric type="number" aria-label="N" />);
    expect(screen.getByLabelText("N").hasAttribute("inputmode")).toBe(false);
  });

  it("[UI-FORM] Textarea is resizable with a minimum height and default rows", () => {
    render(<Textarea aria-label="Notes" />);
    const ta = screen.getByLabelText("Notes");
    expect(ta.getAttribute("rows")).toBe("3");
    expect(ta.className).toContain("resize-y");
    expect(ta.className).toContain("min-h-[84px]");
  });

  it("[UI-FORM] Label renders a <label> with the muted token", () => {
    render(<Label htmlFor="x">Strike</Label>);
    const label = screen.getByText("Strike");
    expect(label.tagName).toBe("LABEL");
    expect(label.getAttribute("for")).toBe("x");
    expect(label.className).toContain("text-muted-foreground");
  });

  it("[UI-FORM] Field links label, hint and control ids (element child)", () => {
    render(
      <Field label="Quantity" hint="1 lot = 0.001 BTC" required>
        <Input />
      </Field>,
    );
    const input = screen.getByLabelText(/Quantity/);
    const hint = screen.getByText("1 lot = 0.001 BTC");
    expect(input.getAttribute("aria-describedby")).toBe(hint.id);
    expect(input.getAttribute("aria-required")).toBe("true");
    expect(input.hasAttribute("aria-invalid")).toBe(false);
    expect(screen.getByText("*").getAttribute("aria-hidden")).toBe("true");
  });

  it("[UI-FORM] Field error replaces the hint, marks the control invalid and uses role=alert", () => {
    render(
      <Field label="Price" hint="hidden when erroring" error="Must be above the best bid" id="px">
        {(control) => <Input numeric {...control} />}
      </Field>,
    );
    const input = screen.getByLabelText("Price");
    const alert = screen.getByRole("alert");
    expect(input.id).toBe("px");
    expect(alert.textContent).toBe("Must be above the best bid");
    expect(input.getAttribute("aria-describedby")).toBe(alert.id);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(screen.queryByText("hidden when erroring")).toBeNull();
  });

  it("[UI-FORM] Field without hint or error sets no aria-describedby and passes through non-element children", () => {
    render(
      <Field label="Plain" id="plain">
        {"just text" as unknown as ReactElement<Partial<FieldControlProps>>}
      </Field>,
    );
    expect(screen.getByText("just text")).toBeTruthy();
    expect(screen.getByText("Plain").getAttribute("for")).toBe("plain");
  });
});
