import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installMockFetch, type MockFetch } from "../../test/helpers";
import { resetErrorReporting } from "@/lib/errors/report";
import ErrorPage from "./error";
import GlobalError from "./global-error";

let mock: MockFetch;
beforeEach(() => {
  mock = installMockFetch();
  resetErrorReporting();
});
afterEach(() => mock.restore());

describe("HC-SH-132 the error screen (ADR-081)", () => {
  it("reports the render error once as a boundary report, shows the reference, and Try again resets", async () => {
    const reset = vi.fn();
    const error = Object.assign(new Error("render broke"), { digest: "d1" });
    render(<ErrorPage error={error} reset={reset} />);
    expect(screen.getByTestId("error-screen").textContent).toContain("Something broke on our side");
    expect(screen.getByTestId("error-screen").textContent).toContain("cannot change your strategies or orders");
    expect(screen.getByTestId("error-reference").textContent).toContain("d1"); // the digest until the report answers
    await waitFor(() => expect(screen.getByTestId("error-reference").textContent).toContain("mock-1"));
    expect(mock.state.clientErrors).toEqual([expect.objectContaining({ message: "render broke", name: "Error", kind: "boundary" })]);
    fireEvent.click(screen.getByTestId("error-retry"));
    expect(reset).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("error-reload")).toBeTruthy();
  });

  it("the root-layout screen renders its own document with the same words", () => {
    const html = renderToStaticMarkup(<GlobalError error={new Error("layout broke")} reset={() => undefined} />);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain("Something broke on our side");
    expect(html).toContain("Reference: not sent");
    expect(html).toContain("Try again");
  });
});
