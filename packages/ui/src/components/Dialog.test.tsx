import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Button } from "./Button";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./Dialog";

function renderDialog(size?: "sm" | "md" | "lg" | "xl", hideClose = false) {
  return render(
    <div>
      <button type="button">Before</button>
      <Dialog>
        <DialogTrigger asChild>
          <Button variant="secondary">Open</Button>
        </DialogTrigger>
        <DialogContent {...(size ? { size } : {})} hideClose={hideClose}>
          <DialogHeader>
            <DialogTitle>Close 2 positions?</DialogTitle>
            <DialogDescription>Market orders at the current mark.</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <input aria-label="Reason" />
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button variant="sell">Confirm</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>,
  );
}

describe("[UI-DIALOG] Dialog (Radix)", () => {
  it("[UI-DIALOG] opens from the trigger, labels itself with title and description, closes with Escape", async () => {
    const user = userEvent.setup();
    renderDialog();
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Open" }));
    const dialog = await screen.findByRole("dialog", { name: "Close 2 positions?" });
    expect(dialog.getAttribute("aria-describedby")).toBeTruthy();
    expect(dialog.dataset["size"]).toBe("md");
    expect(dialog.className).toContain("bg-card");
    expect(dialog.className).toContain("max-w-[520px]");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("[UI-DIALOG] traps focus: Tab cycles inside the dialog and never reaches the page behind", async () => {
    const user = userEvent.setup();
    renderDialog("lg");
    const before = screen.getByRole("button", { name: "Before" });
    await user.click(screen.getByRole("button", { name: "Open" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.className).toContain("max-w-[860px]");
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    for (let i = 0; i < 8; i++) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    for (let i = 0; i < 8; i++) {
      await user.tab({ shift: true });
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    expect(document.activeElement).not.toBe(before);
    // Radix hides the rest of the page from assistive tech while the dialog is open
    expect(before.closest("[aria-hidden='true']")).toBeTruthy();
  });

  it("[UI-DIALOG] the X button and DialogClose both close it and restore focus to the trigger", async () => {
    const user = userEvent.setup();
    renderDialog("sm");
    const trigger = screen.getByRole("button", { name: "Open" });
    await user.click(trigger);
    await user.click(await screen.findByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(trigger);

    await user.click(trigger);
    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("[UI-DIALOG] sizes map to max widths and hideClose removes the X button", async () => {
    const user = userEvent.setup();
    renderDialog("xl", true);
    await user.click(screen.getByRole("button", { name: "Open" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.className).toContain("max-w-[1100px]");
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });
});
