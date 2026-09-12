"use client";
// React binding for GatewayClient: one client per tab (provider), `useTopic` for a chain topic and
// `useSpot` for spot ticks. Updates are batched per animation frame so a burst of `q` frames renders once.
import { chainTopic, spotTopic, type Topic, type Underlying } from "@hapiecoin/schema";
import type { VenueId } from "@hapiecoin/venues/core";
import { useVenueId } from "@/lib/useVenue";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { GatewayClient, type ConnectionStatus } from "./client";
import type { ChainState, SpotState } from "./reducer";

const GatewayContext = createContext<GatewayClient | null>(null);

export interface GatewayProviderProps {
  url: string;
  children: ReactNode;
  /** Injected in tests. */
  client?: GatewayClient;
}

export function GatewayProvider({ url, children, client }: GatewayProviderProps) {
  const [instance] = useState(() => client ?? new GatewayClient({ url }));
  useEffect(() => {
    instance.reopen();
    return () => instance.close();
  }, [instance]);
  return <GatewayContext.Provider value={instance}>{children}</GatewayContext.Provider>;
}

export function useGateway(): GatewayClient {
  const c = useContext(GatewayContext);
  if (!c) throw new Error("useGateway must be used inside <GatewayProvider>");
  return c;
}

/** rAF-coalesced subscribe helper: many events per frame → one store notification. */
function useFrameBatched<T>(subscribeSource: (notify: () => void) => () => void, read: () => T): T {
  const subscribe = useMemo(
    () => (onStoreChange: () => void) => {
      let raf: number | null = null;
      const schedule = () => {
        if (raf !== null) return;
        const anim = typeof requestAnimationFrame === "function" ? requestAnimationFrame : null;
        if (anim) {
          raf = anim(() => {
            raf = null;
            onStoreChange();
          });
        } else {
          onStoreChange();
        }
      };
      const off = subscribeSource(schedule);
      return () => {
        off();
        if (raf !== null && typeof cancelAnimationFrame === "function") cancelAnimationFrame(raf);
      };
    },
    [subscribeSource],
  );
  return useSyncExternalStore(subscribe, read, read);
}

export function useConnectionStatus(): ConnectionStatus {
  const gw = useGateway();
  return useSyncExternalStore(
    (cb) => gw.on("status", () => cb()),
    () => gw.getStatus(),
    () => "idle" as const,
  );
}

export function useLatency(): number {
  const gw = useGateway();
  return useSyncExternalStore(
    (cb) => gw.on("latency", () => cb()),
    () => gw.getLatency(),
    () => 0,
  );
}

/** Subscribe to a chain topic for the lifetime of the component; returns the reducer state (or undefined). */
export function useTopic(topic: Topic | null): ChainState | undefined {
  const gw = useGateway();
  useEffect(() => {
    if (!topic) return;
    return gw.subscribe(topic);
  }, [gw, topic]);
  const source = useMemo(
    () => (notify: () => void) =>
      gw.on("chain", (t) => {
        if (t === topic) notify();
      }),
    [gw, topic],
  );
  return useFrameBatched(source, () => (topic ? gw.getChain(topic) : undefined));
}

/** The chain of `underlying` / `expiry` on the workspace venue (ADR-069), or on `venue` when a strategy names its own. */
export function useChain(underlying: Underlying, expiry: string | null, venue?: VenueId): ChainState | undefined {
  const current = useVenueId();
  const topic = expiry ? chainTopic(venue ?? current, underlying, expiry) : null;
  return useTopic(topic);
}

/** Subscribe to spot ticks of one underlying. */
export function useSpot(underlying: Underlying): SpotState | undefined {
  const gw = useGateway();
  useEffect(() => gw.subscribe(spotTopic(underlying)), [gw, underlying]);
  const source = useMemo(
    () => (notify: () => void) =>
      gw.on("spot", (u) => {
        if (u === underlying) notify();
      }),
    [gw, underlying],
  );
  return useFrameBatched(source, () => gw.getSpot(underlying));
}

/**
 * Flash class for a value that just changed: "flash-up" / "flash-down" for ~800ms, keyed by the update
 * timestamp so consecutive identical values do not re-trigger.
 */
export function useFlash(dir: "up" | "down" | null, updatedAt: number | undefined): string {
  const [cls, setCls] = useState("");
  const last = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!dir || updatedAt === undefined || updatedAt === last.current) return;
    last.current = updatedAt;
    setCls(dir === "up" ? "flash-up" : "flash-down");
    const id = setTimeout(() => setCls(""), 800);
    return () => clearTimeout(id);
  }, [dir, updatedAt]);
  return cls;
}
