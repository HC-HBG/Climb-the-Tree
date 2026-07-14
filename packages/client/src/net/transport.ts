import type { ClientToServerMessage, ServerToClientMessage } from "@climb-the-tree/engine";

export type ServerMessageHandler = (msg: ServerToClientMessage) => void;
export type ConnectionHandler = () => void;

/**
 * Everything GameController needs from a connection to the round engine.
 * Implemented by GameSocket (real WebSocket) and LocalTransport (in-browser
 * demo, no server) so the controller is agnostic to which one it's driving.
 */
export interface Transport {
  connect(): void;
  onMessage(handler: ServerMessageHandler): void;
  onOpen(handler: ConnectionHandler): void;
  onClose(handler: ConnectionHandler): void;
  send(msg: ClientToServerMessage): void;
}
