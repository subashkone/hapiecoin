/**
 * `ws` transport on Node's http server.
 *
 * Why not uWebSockets.js (ADR-004 named it): `uNetworking/uWebSockets.js#v20.51.0` ships prebuilt
 * binaries for Node ABIs 108/115/127/131 only; this repo runs Node 24 (ABI 137) and the loader refuses
 * with "supports only Node.js versions 18, 20, 22 and 23". It also requires glibc, and the Dockerfile
 * targets node:24-alpine (musl). `ws` needs neither. The server logic is transport-agnostic (see
 * ./types.ts), so a uWS transport can be added when a compatible build exists: implement
 * `SocketServerFactory` with `App().ws(...)` and map `getBufferedAmount()` to `bufferedAmount()`.
 */
import { createServer } from "node:http";
import type { IncomingHttpHeaders, IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocket, WebSocketServer } from "ws";
import type { RawData } from "ws";
import type {
  Connection,
  Headers,
  HttpRequest,
  SocketServer,
  TransportHandlers,
  UpgradeRequest,
} from "./types.js";

export interface WsTransportOptions {
  /** Largest inbound frame accepted (default 16 KiB; a sub frame with 200 topics is ~10 KiB). */
  maxPayloadBytes?: number;
}

function flattenHeaders(headers: IncomingHttpHeaders): Headers {
  const out: Headers = {};
  for (const [name, value] of Object.entries(headers)) {
    out[name] = Array.isArray(value) ? value.join(", ") : value;
  }
  return out;
}

/** The parts of an IncomingMessage the transport reads (Node types mark method/url optional; real requests always set them). */
export interface NodeRequestLike {
  method?: string | undefined;
  url?: string | undefined;
  headers: IncomingHttpHeaders;
  socket: { remoteAddress?: string | undefined };
}

export function toHttpRequest(req: NodeRequestLike): HttpRequest {
  return { method: req.method ?? "GET", url: req.url ?? "/", headers: flattenHeaders(req.headers) };
}

export function toUpgradeRequest(req: NodeRequestLike): UpgradeRequest {
  return {
    url: req.url ?? "/",
    headers: flattenHeaders(req.headers),
    remoteAddress: req.socket.remoteAddress ?? "",
  };
}

/** `ws` hands frames over as Buffer, Buffer[] (fragments) or ArrayBuffer; the protocol is text either way. */
export function rawToString(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString();
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString();
  return data.toString();
}

export function createWsServer(handlers: TransportHandlers, options: WsTransportOptions = {}): SocketServer {
  let nextId = 0;
  const http = createServer((req, res) => {
    const response = handlers.http(toHttpRequest(req));
    res.writeHead(response.status, {
      "content-type": response.contentType,
      "cache-control": "no-store",
      ...(response.headers ?? {}),
    });
    res.end(response.body);
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: options.maxPayloadBytes ?? 16 * 1024 });

  http.on("upgrade", (req: IncomingMessage, socket, head) => {
    const upgrade = toUpgradeRequest(req);
    const allowed = handlers.upgrade(upgrade);
    if (!allowed) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      nextId += 1;
      const connection: Connection = {
        id: nextId,
        remoteAddress: upgrade.remoteAddress,
        get isOpen() {
          return ws.readyState === WebSocket.OPEN;
        },
        send: (data) => {
          if (ws.readyState === WebSocket.OPEN) ws.send(data);
        },
        bufferedAmount: () => ws.bufferedAmount,
        close: (code, reason) => ws.close(code, reason),
      };
      ws.on("message", (data) => {
        // Binary frames are not part of the protocol; passing them as text makes them fail validation
        // like any other malformed frame (strike, then close).
        handlers.message(connection, rawToString(data));
      });
      ws.on("close", (code, reason) => handlers.close(connection, code, reason.toString()));
      ws.on("error", () => {
        // a 'close' event always follows; nothing else to do
      });
      handlers.open(connection);
    });
  });

  return {
    listen: (port, host) =>
      new Promise<number>((resolve, reject) => {
        http.once("error", reject);
        http.listen(port, host, () => {
          http.off("error", reject);
          resolve((http.address() as AddressInfo).port);
        });
      }),
    close: () =>
      new Promise<void>((resolve) => {
        for (const client of wss.clients) client.close(1001, "server shutdown");
        wss.close();
        http.close(() => resolve());
        http.closeAllConnections();
      }),
    connectionCount: () => wss.clients.size,
  };
}
