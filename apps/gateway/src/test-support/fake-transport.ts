/** Fake transport: drives TransportHandlers directly and records what each connection was sent. */
import type { ServerMessage } from "@hapiecoin/schema";
import type {
  Connection,
  Headers,
  SocketServer,
  SocketServerFactory,
  TransportHandlers,
} from "../transport/types.js";

export class FakeConnection implements Connection {
  readonly id: number;
  readonly remoteAddress = "127.0.0.1";
  isOpen = true;
  buffered = 0;
  readonly sent: (string | Uint8Array)[] = [];
  closed: { code: number; reason: string } | null = null;

  constructor(
    id: number,
    private readonly onClose: (conn: FakeConnection, code: number, reason: string) => void,
  ) {
    this.id = id;
  }

  send(data: string | Uint8Array): void {
    if (!this.isOpen) return;
    this.sent.push(data);
  }

  bufferedAmount(): number {
    return this.buffered;
  }

  /** Server-initiated close; like `ws`, the close event reaches the handlers afterwards. */
  close(code: number, reason: string): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.closed = { code, reason };
    this.onClose(this, code, reason);
  }

  /** Client-initiated close. */
  disconnect(code = 1000, reason = ""): void {
    this.close(code, reason);
  }

  frames(): ServerMessage[] {
    return this.sent.map(
      (data) => JSON.parse(typeof data === "string" ? data : Buffer.from(data).toString()) as ServerMessage,
    );
  }

  last(): ServerMessage {
    const frame = this.frames().at(-1);
    if (!frame) throw new Error("no frames sent");
    return frame;
  }

  clear(): void {
    this.sent.length = 0;
  }
}

export interface FakeTransport {
  factory: SocketServerFactory;
  handlers: () => TransportHandlers;
  listening: boolean;
  closed: boolean;
  connections: FakeConnection[];
  /** Perform the upgrade; null when the server refused it (403). */
  connect(headers?: Headers): FakeConnection | null;
  /** Deliver a client frame (objects are JSON-encoded, strings verbatim). */
  send(conn: FakeConnection, message: unknown): void;
}

export function createFakeTransport(port = 34567): FakeTransport {
  let handlers: TransportHandlers | null = null;
  let nextId = 0;
  const transport: FakeTransport = {
    listening: false,
    closed: false,
    connections: [],
    factory: (h) => {
      handlers = h;
      const server: SocketServer = {
        listen: () => {
          transport.listening = true;
          return Promise.resolve(port);
        },
        close: () => {
          transport.closed = true;
          transport.listening = false;
          for (const conn of transport.connections) conn.close(1001, "server shutdown");
          return Promise.resolve();
        },
        connectionCount: () => transport.connections.filter((c) => c.isOpen).length,
      };
      return server;
    },
    handlers: () => {
      if (!handlers) throw new Error("transport factory not called");
      return handlers;
    },
    connect: (headers = {}) => {
      const h = transport.handlers();
      if (!h.upgrade({ url: "/", headers, remoteAddress: "127.0.0.1" })) return null;
      nextId += 1;
      const conn = new FakeConnection(nextId, (c, code, reason) => h.close(c, code, reason));
      transport.connections.push(conn);
      h.open(conn);
      return conn;
    },
    send: (conn, message) => {
      transport.handlers().message(conn, typeof message === "string" ? message : JSON.stringify(message));
    },
  };
  return transport;
}
