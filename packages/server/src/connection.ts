import type WebSocket from "ws";
import { DEFAULT_CONFIG, type ServerToClientMessage } from "@climb-the-tree/engine";
import { RoundSession, type CrashSettlement } from "./roundEngine.js";
import { Wallet } from "./wallet.js";
import { parseClientMessage } from "./protocolIO.js";

const STARTING_BALANCE_CENTS = 500_000; // $5,000.00 stub wallet
const TICK_INTERVAL_MS = 250;

function send(ws: WebSocket, msg: ServerToClientMessage): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

/**
 * Wires one WebSocket connection to its own RoundSession, per FSD §2.1.
 * One session per connection; v1 has no shared/multiplayer rounds (FSD §8).
 */
export function handleConnection(ws: WebSocket): void {
  const wallet = new Wallet(STARTING_BALANCE_CENTS);
  const session = new RoundSession(wallet, DEFAULT_CONFIG);

  let tickTimer: ReturnType<typeof setInterval> | undefined;
  let crashTimer: ReturnType<typeof setTimeout> | undefined;
  let autoTimer: ReturnType<typeof setTimeout> | undefined;

  function clearTimers(): void {
    if (tickTimer) clearInterval(tickTimer);
    if (crashTimer) clearTimeout(crashTimer);
    if (autoTimer) clearTimeout(autoTimer);
    tickTimer = crashTimer = autoTimer = undefined;
  }

  function broadcastSettlement(settlement: CrashSettlement): void {
    clearTimers();
    if (settlement.kind === "cashed") {
      send(ws, {
        type: "cashout:confirmed",
        x: settlement.x,
        win: settlement.winCents,
        balance: settlement.balanceCents,
      });
    }
    send(ws, {
      type: "round:crashed",
      crash: settlement.crash,
      serverSeed: settlement.serverSeedRevealed,
    });
    void sendReady();
  }

  function settleIfDue(nowMs: number): void {
    const settlement = session.checkDue(nowMs);
    if (settlement) broadcastSettlement(settlement);
  }

  async function sendReady(): Promise<void> {
    const ready = await session.getReadyInfo();
    send(ws, { type: "round:ready", seedHash: ready.seedHash, nonce: ready.nonce });
  }

  ws.on("message", (data: WebSocket.RawData) => {
    void (async () => {
      const msg = parseClientMessage(data.toString());
      if (!msg) {
        send(ws, { type: "error", code: "INVALID_BET", msg: "Malformed message." });
        return;
      }

      switch (msg.type) {
        case "bet:place": {
          const now = Date.now();
          const result = await session.placeBet(msg.amount, msg.autoX, now);
          if (!result.ok) {
            send(ws, { type: "error", code: result.error, msg: result.message });
            return;
          }
          send(ws, { type: "round:started", startTs: result.startTs });

          clearTimers();
          tickTimer = setInterval(() => settleIfDue(Date.now()), TICK_INTERVAL_MS);
          crashTimer = setTimeout(
            () => settleIfDue(Date.now()),
            Math.max(0, result.crashAtMs - now),
          );
          if (result.autoCashoutAtMs !== undefined) {
            autoTimer = setTimeout(
              () => settleIfDue(Date.now()),
              Math.max(0, result.autoCashoutAtMs - now),
            );
          }
          // Covers the instant-fall case (crashAtMs === now) without waiting for a timer tick.
          settleIfDue(now);
          break;
        }
        case "cashout": {
          const result = session.cashoutRequest(Date.now());
          if (!result.ok) {
            send(ws, { type: "error", code: result.error, msg: result.message });
            return;
          }
          broadcastSettlement(result);
          break;
        }
        case "seed:setClient":
          session.setClientSeed(msg.seed);
          break;
        case "seed:rotate":
          session.requestSeedRotation();
          break;
      }
    })();
  });

  ws.on("close", clearTimers);

  void sendReady();
}
