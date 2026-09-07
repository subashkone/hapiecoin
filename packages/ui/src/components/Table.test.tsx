import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TBody, TFoot, THead, Table, Td, Th, Tr } from "./Table";

describe("[UI-TABLE] Table primitives (HC-SH-113 row height via --row-h)", () => {
  it("[UI-TABLE] renders semantic table parts; rows use h-row, numeric cells are mono right-aligned", () => {
    render(
      <Table>
        <THead>
          <Tr>
            <Th>Symbol</Th>
            <Th numeric>Mark</Th>
          </Tr>
        </THead>
        <TBody>
          <Tr data-state="selected">
            <Td>C-BTC-80000-250926</Td>
            <Td numeric>2,811.8</Td>
          </Tr>
        </TBody>
        <TFoot>
          <Tr>
            <Td>Total</Td>
            <Td numeric>2,811.8</Td>
          </Tr>
        </TFoot>
      </Table>,
    );
    const table = screen.getByRole("table");
    expect(table.parentElement?.className).toContain("overflow-x-auto");
    const headers = screen.getAllByRole("columnheader");
    expect(headers[0]?.className).toContain("micro");
    expect(headers[1]?.className).toContain("text-right");
    const rows = screen.getAllByRole("row");
    expect(rows[1]?.className).toContain("h-row");
    const cells = screen.getAllByRole("cell");
    expect(cells[0]?.className).not.toContain("num");
    expect(cells[1]?.className).toContain("num");
    expect(cells[1]?.className).toContain("text-right");
    expect(table.querySelector("tfoot")?.className).toContain("border-t");
  });

  it("[UI-TABLE] compact tightens padding and text size", () => {
    render(
      <Table compact>
        <TBody>
          <Tr>
            <Td>x</Td>
          </Tr>
        </TBody>
      </Table>,
    );
    const table = screen.getByRole("table");
    expect(table.dataset["compact"]).toBe("true");
    expect(table.className).toContain("text-xs");
  });
});
