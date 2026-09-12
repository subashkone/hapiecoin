import { act, renderHook, waitFor } from "@testing-library/react";
import { chainTopic } from "@hapiecoin/schema";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildChain } from "../../../test/fixtures/chain";
import { FakeSocket, makeGateway } from "../../../test/helpers";
import { useUiStore } from "@/lib/store";
import {
  GatewayProvider,
  useChain,
  useConnectionStatus,
  useFlash,
  useGateway,
  useLatency,
  useSpot,
  useTopic,
} from "./hooks";

const TOPIC = chainTopic("delta_india", "BTC", "2026-09-25");
const rows = buildChain("BTC", "2026-09-25");

beforeEach(() => FakeSocket.reset());

function wrapperFor(gateway = makeGateway()) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <GatewayProvider url="ws://test" client={gateway}>
      {children}
    </GatewayProvider>
  );
  return { wrapper, gateway };
}

describe("[GATEWAY] React hooks", () => {
  it("useGateway throws outside the provider", () => {
    expect(() => renderHook(() => useGateway())).toThrow(/inside <GatewayProvider>/);
  });
  it("provider opens the socket on mount and closes on unmount", () => {
    const { wrapper, gateway } = wrapperFor();
    const { unmount } = renderHook(() => useConnectionStatus(), { wrapper });
    expect(FakeSocket.instances).toHaveLength(1);
    unmount();
    expect(gateway.getStatus()).toBe("closed");
  });
  it("creates its own client when none is injected", () => {
    vi.stubGlobal("WebSocket", function (this: FakeSocket, url: string) {
      return new FakeSocket(url);
    });
    const wrapper = ({ children }: { children: ReactNode }) => <GatewayProvider url="ws://auto">{children}</GatewayProvider>;
    renderHook(() => useConnectionStatus(), { wrapper });
    expect(FakeSocket.last().url).toBe("ws://auto");
    vi.unstubAllGlobals();
  });
  it("useTopic subscribes, receives snapshot + deltas (rAF-batched) and unsubscribes on unmount", async () => {
    const { wrapper } = wrapperFor();
    const initial: { topic: string | null } = { topic: TOPIC };
    const { result, rerender } = renderHook(({ topic }: { topic: string | null }) => useTopic(topic), {
      wrapper,
      initialProps: initial,
    });
    const ws = FakeSocket.last();
    act(() => {
      ws.open();
    });
    expect(ws.sentFrames()).toContainEqual({ op: "sub", topics: [TOPIC] });
    expect(result.current?.seq).toBe(-1);
    act(() => {
      ws.receive({ t: "snap", topic: TOPIC, seq: 0, rows });
      ws.receive({ t: "q", topic: TOPIC, seq: 1, d: [{ i: rows[0]!.call!.instrumentId, mark: "7" }] });
    });
    await waitFor(() => expect(result.current?.seq).toBe(1));
    expect(result.current?.rows[0]?.call?.mark).toBe("7");
    rerender({ topic: null });
    expect(ws.sentFrames().at(-1)).toEqual({ op: "unsub", topics: [TOPIC] });
    expect(result.current).toBeUndefined();
  });
  it("useTopic(null) and useChain(asset, null) subscribe to nothing", () => {
    const { wrapper } = wrapperFor();
    const { result } = renderHook(() => [useTopic(null), useChain("BTC", null)] as const, { wrapper });
    expect(result.current).toEqual([undefined, undefined]);
  });
  it("useChain builds the topic from asset + expiry", () => {
    const { wrapper } = wrapperFor();
    renderHook(() => useChain("ETH", "2026-09-25"), { wrapper });
    act(() => {
      FakeSocket.last().open();
    });
    expect(FakeSocket.last().sentFrames()).toContainEqual({ op: "sub", topics: [chainTopic("delta_india", "ETH", "2026-09-25")] });
  });
  it("HC-SH-124 useChain follows the workspace venue and takes a strategy's own venue (ADR-069)", () => {
    const { wrapper } = wrapperFor();
    useUiStore.setState({ venue: "deribit" });
    try {
      renderHook(() => [useChain("BTC", "2026-09-12"), useChain("ETH", "2026-09-25", "delta_india")] as const, { wrapper });
      act(() => {
        FakeSocket.last().open();
      });
      const subscribed = (FakeSocket.last().sentFrames() as { op: string; topics?: string[] }[]).filter((f) => f.op === "sub").flatMap((f) => f.topics ?? []);
      expect(subscribed).toEqual(expect.arrayContaining([chainTopic("deribit", "BTC", "2026-09-12"), chainTopic("delta_india", "ETH", "2026-09-25")]));
    } finally {
      useUiStore.setState({ venue: "delta_india" });
    }
  });
  it("useSpot / useLatency / useConnectionStatus follow the client", async () => {
    const gateway = makeGateway({ pingIntervalMs: 50, now: () => 5, setTimer: () => 0, clearTimer: () => {} });
    const { wrapper } = wrapperFor(gateway);
    const { result } = renderHook(() => ({ spot: useSpot("BTC"), latency: useLatency(), status: useConnectionStatus() }), { wrapper });
    expect(result.current.status).toBe("connecting");
    const ws = FakeSocket.last();
    act(() => {
      ws.open();
    });
    await waitFor(() => expect(result.current.status).toBe("open"));
    act(() => {
      ws.receive({ t: "pong" });
      ws.receive({ t: "spot", s: "BTC", p: "1", c24: 2 });
      ws.receive({ t: "spot", s: "ETH", p: "9" }); // other asset: no re-render needed
    });
    await waitFor(() => expect(result.current.spot?.price).toBe("1"));
    expect(result.current.latency).toBe(0);
  });
  it("HC-SH-126 useSpot follows the venue it is given and ignores the other venue's ticks (ADR-071)", async () => {
    const { wrapper } = wrapperFor();
    const { result } = renderHook(() => ({ deribit: useSpot("BTC", "deribit"), none: useSpot("XAUT", null) }), { wrapper });
    const ws = FakeSocket.last();
    act(() => {
      ws.open();
    });
    expect(ws.sentFrames()).toContainEqual({ op: "sub", topics: ["spot:deribit:BTC"] });
    expect(ws.sentFrames().some((f) => JSON.stringify(f).includes("XAUT"))).toBe(false); // null venue: nothing subscribed
    act(() => {
      ws.receive({ t: "spot", s: "BTC", p: "79000" }); // the default venue's frame: not this hook's
      ws.receive({ t: "spot", s: "BTC", v: "deribit", p: "77000" });
    });
    await waitFor(() => expect(result.current.deribit?.price).toBe("77000"));
    expect(result.current.none).toBeUndefined();
  });
  it("useFlash returns a class for ~800ms only when the timestamp changes", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ dir, at }: { dir: "up" | "down" | null; at: number | undefined }) => useFlash(dir, at), {
      initialProps: { dir: null as "up" | "down" | null, at: undefined as number | undefined },
    });
    expect(result.current).toBe("");
    rerender({ dir: "up", at: 1 });
    expect(result.current).toBe("flash-up");
    act(() => {
      vi.advanceTimersByTime(800);
    });
    expect(result.current).toBe("");
    rerender({ dir: "down", at: 1 }); // same timestamp: no new flash
    expect(result.current).toBe("");
    rerender({ dir: "down", at: 2 });
    expect(result.current).toBe("flash-down");
    vi.useRealTimers();
  });
  it("batches without requestAnimationFrame when it is unavailable", async () => {
    const raf = globalThis.requestAnimationFrame;
    // @ts-expect-error -- simulate an environment without rAF
    globalThis.requestAnimationFrame = undefined;
    const { wrapper } = wrapperFor();
    const { result } = renderHook(() => useSpot("XAUT"), { wrapper });
    act(() => {
      FakeSocket.last().open();
      FakeSocket.last().receive({ t: "spot", s: "XAUT", p: "3400" });
    });
    await waitFor(() => expect(result.current?.price).toBe("3400"));
    globalThis.requestAnimationFrame = raf;
  });
});
