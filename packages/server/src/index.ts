import { WebSocketServer } from "ws";
import { handleConnection } from "./connection.js";

const PORT = Number(process.env.PORT ?? 8787);

const wss = new WebSocketServer({ port: PORT });

wss.on("connection", (ws) => {
  handleConnection(ws);
});

wss.on("listening", () => {
  console.log(`Climb the Tree round engine listening on ws://localhost:${PORT}`);
});
