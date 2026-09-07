import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectRoot,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "./Select";

const options = [
  { value: "250926", label: "25 Sep" },
  { value: "261226", label: "26 Dec" },
  { value: "270326", label: "27 Mar", disabled: true },
];

describe("[UI-SELECT] Select (Radix)", () => {
  it("[UI-SELECT] renders the trigger with placeholder and control chrome", () => {
    render(<Select options={options} placeholder="Pick an expiry" aria-label="Expiry" />);
    const trigger = screen.getByRole("combobox", { name: "Expiry" });
    expect(trigger.textContent).toContain("Pick an expiry");
    expect(trigger.className).toContain("border-input");
    expect(trigger.dataset["size"]).toBe("md");
  });

  it("[UI-SELECT] opens on click, lists options and calls onValueChange with the chosen value", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <Select
        options={options}
        placeholder="Expiry"
        aria-label="Expiry"
        onValueChange={onValueChange}
        size="sm"
      />,
    );
    const trigger = screen.getByRole("combobox", { name: "Expiry" });
    expect(trigger.dataset["size"]).toBe("sm");
    await user.click(trigger);
    const listbox = await screen.findByRole("listbox");
    const items = within(listbox).getAllByRole("option");
    expect(items.map((i) => i.textContent)).toEqual(["25 Sep", "26 Dec", "27 Mar"]);
    expect(items[2]?.getAttribute("aria-disabled")).toBe("true");
    await user.click(items[1]!);
    expect(onValueChange).toHaveBeenCalledWith("261226");
    expect(trigger.textContent).toContain("26 Dec");
  });

  it("[UI-SELECT] controlled value shows the matching label", () => {
    render(<Select options={options} value="250926" aria-label="Expiry" />);
    expect(screen.getByRole("combobox", { name: "Expiry" }).textContent).toContain("25 Sep");
  });

  it("[UI-SELECT] composable parts render groups, labels and separators", async () => {
    const user = userEvent.setup();
    render(
      <SelectRoot defaultOpen>
        <SelectTrigger aria-label="Asset">
          <SelectValue placeholder="Asset" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>Crypto</SelectLabel>
            <SelectItem value="BTC">BTC</SelectItem>
            <SelectItem value="ETH">ETH</SelectItem>
          </SelectGroup>
          <SelectSeparator />
          <SelectGroup>
            <SelectLabel>Metals</SelectLabel>
            <SelectItem value="XAUT">XAUT</SelectItem>
          </SelectGroup>
        </SelectContent>
      </SelectRoot>,
    );
    const listbox = await screen.findByRole("listbox");
    expect(within(listbox).getByText("Crypto").className).toContain("micro");
    expect(within(listbox).getAllByRole("option")).toHaveLength(3);
    await user.click(within(listbox).getByRole("option", { name: "XAUT" }));
    expect(screen.getByRole("combobox", { name: "Asset" }).textContent).toContain("XAUT");
  });
});
