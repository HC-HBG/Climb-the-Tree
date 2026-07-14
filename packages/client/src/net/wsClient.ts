import type { ClientToServerMessage, ServerToClientMessage } from "@climb-the-tree/engine";
import type { ConnectionHandler, ServerMessageHandler, Transport } from "./transport.js";

/** Thin typed wrapper around the browser WebSocket for the FSD §2.1 protocol. */
export class GameSocket implements Transport {
  private ws: WebSocket | undefined;
  private readonly messageHandlers = new Set<ServerMessageHandler>();
  private readonly openHandlers = new Set<ConnectionHandler>();
  private readonly closeHandlers = new Set<ConnectionHandler>();

  constructor(private readonly url: string) {}

  connect(): void {
    const ws = new WebSocket(this.url);
    ws.addEventListener("open", () => {
      for (const handler of this.openHandlers) handler();
    });
    ws.addEventListener("close", () => {
      for (const handler of this.closeHandlers) handler();
    });
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data as string) as ServerToClientMessage;
      for (const handler of this.messageHandlers) handler(msg);
    });
    this.ws = ws;
  }

  onMessage(handler: ServerMessageHandler): void {
    this.messageHandlers.add(handler);
  }

  onOpen(handler: ConnectionHandler): void {
    this.openHandlers.add(handler);
  }

  onClose(handler: ConnectionHandler): void {
    this.closeHandlers.add(handler);
  }

  send(msg: ClientToServerMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }
}
