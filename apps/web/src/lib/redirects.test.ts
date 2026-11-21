// HC-SH-142 (ADR-106): the workspace lives at /desk and the account pages at /plans and /invite. The product had no
// users when they were renamed, so the earlier addresses are not kept alive: no redirect rule exists for them.
import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

describe("HC-SH-142 the renamed routes carry no redirects from earlier addresses", () => {
  it("the Next config defines no redirect rules", () => {
    expect(nextConfig.redirects).toBeUndefined();
  });
});
