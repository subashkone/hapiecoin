import type { ServerMessage } from "@hapiecoin/schema";
import { describe, expect, it } from "vitest";
import { InProcessPubSub } from "./in-process.js";

const PONG: ServerMessage = { t: "pong" };
const SPOT: ServerMessage = { t: "spot", s: "BTC", p: "79521" };

describe("[GATEWAY] in-process pubsub", () => {
  it("[GATEWAY] delivers to every handler of a topic in order and only to that topic", () => {
    const bus = new InProcessPubSub();
    const seen: string[] = [];
    const offA = bus.subscribe("spot:BTC", (m) => seen.push(`a:${m.t}`));
    bus.subscribe("spot:BTC", (m) => seen.push(`b:${m.t}`));
    bus.subscribe("spot:ETH", (m) => seen.push(`eth:${m.t}`));
    expect(bus.topicCount()).toBe(2);

    bus.publish("spot:BTC", SPOT);
    bus.publish("spot:XAUT", SPOT); // nobody listening: no error
    expect(seen).toEqual(["a:spot", "b:spot"]);

    offA();
    offA(); // idempotent
    bus.publish("spot:BTC", PONG);
    expect(seen).toEqual(["a:spot", "b:spot", "b:pong"]);
    expect(bus.topicCount()).toBe(2);
  });

  it("[GATEWAY] a handler that unsubscribes during delivery does not break the loop; close clears all", async () => {
    const bus = new InProcessPubSub();
    const seen: string[] = [];
    const off = bus.subscribe("spot:BTC", () => {
      seen.push("first");
      off();
    });
    bus.subscribe("spot:BTC", () => seen.push("second"));
    bus.publish("spot:BTC", SPOT);
    expect(seen).toEqual(["first", "second"]);
    bus.publish("spot:BTC", SPOT);
    expect(seen).toEqual(["first", "second", "second"]);

    const offLast = bus.subscribe("spot:ETH", () => seen.push("eth"));
    offLast();
    expect(bus.topicCount()).toBe(1);
    offLast(); // topic already removed
    await bus.close();
    expect(bus.topicCount()).toBe(0);
    bus.publish("spot:BTC", SPOT);
    expect(seen).toHaveLength(3);
  });
});
