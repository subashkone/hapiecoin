import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { REDACTED, createLogger, scrub, scrubPath } from "./logger.js";

describe("[LOGS] secret scrubbing", () => {
  it("redacts secret-looking keys at any depth and keeps the rest", () => {
    const input = {
      email: "a@b.c",
      apiKey: "k",
      api_secret: "s",
      nested: { otp: "123456", password: "p", list: [{ cookie: "c" }, "plain"] },
      when: new Date(0),
      buf: Buffer.from("x"),
      n: 1,
    };
    const out = scrub(input);
    expect(out.email).toBe("a@b.c");
    expect(out.apiKey).toBe(REDACTED);
    expect(out.api_secret).toBe(REDACTED);
    expect(out.nested.otp).toBe(REDACTED);
    expect(out.nested.password).toBe(REDACTED);
    expect(out.nested.list[0]).toEqual({ cookie: REDACTED });
    expect(out.nested.list[1]).toBe("plain");
    expect(out.when).toBeInstanceOf(Date);
    expect(Buffer.isBuffer(out.buf)).toBe(true);
    expect(out.n).toBe(1);
    expect(input.apiKey).toBe("k");
  });

  it("cuts cycles", () => {
    const a: Record<string, unknown> = { name: "a" };
    a["self"] = a;
    expect(scrub(a)).toEqual({ name: "a", self: "[circular]" });
  });

  it("scrubs secret query parameters from paths", () => {
    expect(scrubPath("/v1/x?otp=123456&email=a%40b.c")).toBe(
      `/v1/x?otp=${encodeURIComponent(REDACTED)}&email=a%40b.c`,
    );
    expect(scrubPath("/v1/x")).toBe("/v1/x");
  });

  it("pino redacts known paths in emitted lines", async () => {
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk: Buffer, _enc, cb) {
        lines.push(chunk.toString());
        cb();
      },
    });
    const logger = createLogger({ level: "info", destination: sink, base: { env: "test" } });
    logger.info({ apiKey: "k1", body: { password: "p1" }, safe: "ok" }, "hello");
    await new Promise((r) => setTimeout(r, 20));
    const joined = lines.join("");
    expect(joined).toContain('"service":"hapiecoin-api"');
    expect(joined).toContain('"level":"info"');
    expect(joined).toContain('"safe":"ok"');
    expect(joined).not.toContain("k1");
    expect(joined).not.toContain("p1");
    expect(createLogger({ level: "silent" }).level).toBe("silent");
  });
});
