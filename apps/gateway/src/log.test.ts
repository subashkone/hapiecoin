import { afterEach, describe, expect, it, vi } from "vitest";
import { createLogger, silentLogger } from "./log.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("[GATEWAY] logger", () => {
  it("[GATEWAY] writes JSON lines at or above the configured level with fields", () => {
    const lines: string[] = [];
    const log = createLogger(
      "info",
      (line) => lines.push(line),
      () => 1_700_000_000_000,
    );
    log.debug("hidden");
    log.info("hello", { port: 3002 });
    log.warn("careful", { error: new Error("boom") });
    log.error("bad");
    expect(lines.map((l) => JSON.parse(l) as unknown)).toEqual([
      { ts: "2023-11-14T22:13:20.000Z", level: "info", msg: "hello", port: 3002 },
      {
        ts: "2023-11-14T22:13:20.000Z",
        level: "warn",
        msg: "careful",
        error: { name: "Error", message: "boom" },
      },
      { ts: "2023-11-14T22:13:20.000Z", level: "error", msg: "bad" },
    ]);
  });

  it("[GATEWAY] silent drops everything and the default sink is stdout", () => {
    const lines: string[] = [];
    const log = createLogger("silent", (line) => lines.push(line));
    log.error("nothing");
    expect(lines).toEqual([]);
    silentLogger.error("nothing either");

    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    createLogger("debug").debug("to stdout", { a: 1 });
    expect(write).toHaveBeenCalledTimes(1);
    expect(String(write.mock.calls[0]?.[0])).toMatch(/"msg":"to stdout".*"a":1/);
  });
});

describe("HC-SH-133 the error-level hook (ADR-081)", () => {
  it("hands every enabled error call to onError with the raw fields, never warn or a suppressed level; a throwing hook does not break the log", () => {
    const lines: string[] = [];
    const records: { fields: Record<string, unknown>; msg: string; level: number }[] = [];
    const log = createLogger(
      "warn",
      (line) => lines.push(line),
      () => 0,
      (record) => {
        records.push(record);
        if (record.msg === "explode") throw new Error("hook");
      },
    );
    const error = new Error("boom");
    log.error("upstream failed", { error, venue: "deribit" });
    log.warn("not forwarded", { error });
    log.error("explode");
    log.debug("suppressed and not forwarded");
    expect(records).toEqual([
      { fields: { error, venue: "deribit" }, msg: "upstream failed", level: 50 },
      { fields: {}, msg: "explode", level: 50 },
    ]);
    expect(lines).toHaveLength(3);
    expect(lines[2]).toContain('"msg":"explode"');
    const silent = createLogger("silent", (line) => lines.push(line), () => 0, (record) => records.push(record));
    silent.error("nothing enabled");
    expect(records).toHaveLength(2);
  });
});
