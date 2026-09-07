/**
 * Transport boundary. The server logic (`GatewayServer`) speaks only to these interfaces, so the socket
 * library is swappable: `ws` today (see ./ws.ts for why), uWebSockets.js when a build for the deployed
 * Node ABI and libc exists. Tests drive `TransportHandlers` directly with a fake connection.
 */

export type Headers = Record<string, string | undefined>;

export interface HttpRequest {
  method: string;
  /** Path plus query, e.g. "/healthz". */
  url: string;
  /** Header names lower-cased. */
  headers: Headers;
}

export interface HttpResponse {
  status: number;
  contentType: string;
  body: string;
  /** Extra response headers (lower-cased names), e.g. CORS headers for browser reads of /healthz. */
  headers?: Record<string, string>;
}

export interface UpgradeRequest {
  url: string;
  headers: Headers;
  remoteAddress: string;
}

export interface Connection {
  readonly id: number;
  readonly remoteAddress: string;
  readonly isOpen: boolean;
  send(data: string | Uint8Array): void;
  /** Bytes queued on the socket and not yet handed to the kernel (backpressure signal). */
  bufferedAmount(): number;
  close(code: number, reason: string): void;
}

export interface TransportHandlers {
  http(request: HttpRequest): HttpResponse;
  /** Return false to refuse the WebSocket upgrade with 403. */
  upgrade(request: UpgradeRequest): boolean;
  open(connection: Connection): void;
  message(connection: Connection, data: string): void;
  close(connection: Connection, code: number, reason: string): void;
}

export interface SocketServer {
  /** Bind and resolve the actual port (port 0 picks a free one). */
  listen(port: number, host: string): Promise<number>;
  /** Close every connection (1001) and stop listening. */
  close(): Promise<void>;
  connectionCount(): number;
}

export type SocketServerFactory = (handlers: TransportHandlers) => SocketServer;
