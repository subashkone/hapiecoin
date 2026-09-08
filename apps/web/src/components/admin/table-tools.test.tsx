// Shared admin table tools (HC-AD-093..096): sort toggling, CSV escaping, the Columns menu keeping one column.
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { renderWithProviders } from "../../../test/helpers";
import { useUiStore } from "@/lib/store";
import { type ColumnDef, ColumnsMenu, FloatingBar, nextSort, rowsCsv, useAdminColumns } from "./table-tools";

type Row = { a: string; b: number };
const DEFS: ColumnDef<Row>[] = [
  { key: "a", label: "A", sort: "a", csv: (r) => r.a },
  { key: "b", label: "B", sort: "b", align: "right", csv: (r) => String(r.b) },
  { key: "c", label: "C", hidden: true, csv: () => "" },
];

function Probe() {
  const columns = useAdminColumns("probe", DEFS);
  return (
    <div>
      <span data-testid="visible">{columns.visible.map((c) => c.key).join(",")}</span>
      <ColumnsMenu defs={DEFS} columns={columns} testId="cols" />
    </div>
  );
}

beforeEach(() => useUiStore.setState({ adminCols: {} }));

describe("HC-AD-094 nextSort and HC-AD-096 rowsCsv", () => {
  it("toggles direction on the same key, starts numeric columns descending, escapes CSV quotes", () => {
    expect(nextSort({ sort: "a", dir: "asc" }, "a", false)).toEqual({ sort: "a", dir: "desc" });
    expect(nextSort({ sort: "a", dir: "desc" }, "a", false)).toEqual({ sort: "a", dir: "asc" });
    expect(nextSort({ sort: "a", dir: "asc" }, "b", true)).toEqual({ sort: "b", dir: "desc" });
    expect(nextSort({ sort: "a", dir: "asc" }, "c", false)).toEqual({ sort: "c", dir: "asc" });
    expect(rowsCsv([{ a: 'x "q"', b: 1 }], DEFS.slice(0, 2))).toBe('"A","B"\n"x ""q""","1"');
  });
});

describe("HC-AD-093 Columns menu", () => {
  it("hides and shows columns, keeps at least one, persists per page and resets", async () => {
    const u = userEvent.setup();
    renderWithProviders(<Probe />);
    expect(screen.getByTestId("visible").textContent).toBe("a,b");
    await u.click(screen.getByTestId("cols-button"));
    await u.click(within(screen.getByTestId("cols-c")).getByRole("checkbox"));
    expect(screen.getByTestId("visible").textContent).toBe("a,b,c");
    expect(useUiStore.getState().adminCols["probe"]).toEqual(["a", "b", "c"]);
    await u.click(within(screen.getByTestId("cols-a")).getByRole("checkbox"));
    await u.click(within(screen.getByTestId("cols-b")).getByRole("checkbox"));
    expect(screen.getByTestId("visible").textContent).toBe("c");
    await u.click(within(screen.getByTestId("cols-c")).getByRole("checkbox")); // refused: last column
    expect(screen.getByTestId("visible").textContent).toBe("c");
    await u.click(screen.getByTestId("cols-reset"));
    expect(screen.getByTestId("visible").textContent).toBe("a,b");
    expect(useUiStore.getState().adminCols["probe"]).toBeNull();
  });

  it("FloatingBar renders only with a selection", () => {
    const { rerender } = renderWithProviders(<FloatingBar count={0} onClear={() => undefined}>x</FloatingBar>);
    expect(screen.queryByTestId("floating-bar")).toBeNull();
    rerender(<FloatingBar count={2} onClear={() => undefined}>x</FloatingBar>);
    expect(screen.getByTestId("floating-bar-count").textContent).toBe("2 selected");
  });
});
