import {
  DEFAULT_CONFIG,
  STUB_STARTING_BALANCE_CENTS,
  type ClientToServerMessage,
  type ServerToClientMessage,
} from "@climb-the-tree/engine";
import { RoundSession, type CrashSettlement } from "@climb-the-tree/server/roundEngine";
import { Wallet } from "@climb-the-tree/server/wallet";
import type { ConnectionHandler, ServerMessageHandler, Transport } from "./transport.js";

const TICK_INTERVAL_MS = 250;

/**
 * Demo-only transport: runs the exact same RoundSession/Wallet the real
 * server uses, in-process in the browser, instead of talking to a
 * WebSocket. This intentionally breaks the FSD's "the crash point never
 * leaves the server" guarantee (there is no server) — it exists purely so a
 * static build (e.g. GitHub Pages) can demo the full round loop with zero
 * backend. The real, server-authoritative client (GameSocket) is what ships.
 */
export class LocalTransport implements Transport {
  private readonly wallet = new Wallet(STUB_STARTING_BALANCE_CENTS);
  private readonly session = new RoundSession(this.wallet, DEFAULT_CONFIG);
  private readonly messageHandlers = new Set<ServerMessageHandler>();
  private readonly openHandlers = new Set<ConnectionHandler>();

  private tickTimer: ReturnType<typeof setInterval> | undefined;
  private crashTimer: ReturnType<typeof setTimeout> | undefined;
  private autoTimer: ReturnType<typeof setTimeout> | undefined;

  connect(): void {
    for (const handler of this.openHandlers) handler();
    void this.sendReady();
  }

  onMessage(handler: ServerMessageHandler): void {
    this.messageHandlers.add(handler);
  }

  onOpen(handler: ConnectionHandler): void {
    this.openHandlers.add(handler);
  }

  onClose(): void {
    // No connection to lose in-process; nothing to wire up.
  }

  send(msg: ClientToServerMessage): void {
    // Defer to the next tick, like a real network round-trip, so a
    // synchronous send-then-handle can't re-enter the caller's own stack.
    setTimeout(() => void this.handle(msg), 0);
  }

  private emit(msg: ServerToClientMessage): void {
    for (const handler of this.messageHandlers) handler(msg);
  }

  private clearTimers(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.crashTimer) clearTimeout(this.crashTimer);
    if (this.autoTimer) clearTimeout(this.autoTimer);
    this.tickTimer = this.crashTimer = this.autoTimer = undefined;
  }

  private broadcastSettlement(settlement: CrashSettlement): void {
    this.clearTimers();
    if (settlement.kind === "cashed") {
      this.emit({
        type: "cashout:confirmed",
        x: settlement.x,
        win: settlement.winCents,
        balance: settlement.balanceCents,
      });
    }
    this.emit({
      type: "round:crashed",
      crash: settlement.crash,
      serverSeed: settlement.serverSeedRevealed,
    });
    void this.sendReady();
  }

  private settleIfDue(nowMs: number): void {
    const settlement = this.session.checkDue(nowMs);
    if (settlement) this.broadcastSettlement(settlement);
  }

  private async sendReady(): Promise<void> {
    const ready = await this.session.getReadyInfo();
    this.emit({ type: "round:ready", seedHash: ready.seedHash, nonce: ready.nonce });
  }

  private async handle(msg: ClientToServerMessage): Promise<void> {
    switch (msg.type) {
      case "bet:place": {
        const now = Date.now();
        const result = await this.session.placeBet(msg.amount, msg.autoX, now);
        if (!result.ok) {
          this.emit({ type: "error", code: result.error, msg: result.message });
          return;
        }
        this.emit({ type: "round:started", startTs: result.startTs });

        this.clearTimers();
        this.tickTimer = setInterval(
          () => this.settleIfDue(Date.now()),
          TICK_INTERVAL_MS,
        );
        this.crashTimer = setTimeout(
          () => this.settleIfDue(Date.now()),
          Math.max(0, result.crashAtMs - now),
        );
        if (result.autoCashoutAtMs !== undefined) {
          this.autoTimer = setTimeout(
            () => this.settleIfDue(Date.now()),
            Math.max(0, result.autoCashoutAtMs - now),
          );
        }
        this.settleIfDue(now);
        break;
      }
      case "cashout": {
        const result = this.session.cashoutRequest(Date.now());
        if (!result.ok) {
          this.emit({ type: "error", code: result.error, msg: result.message });
          return;
        }
        this.broadcastSettlement(result);
        break;
      }
      case "seed:setClient":
        this.session.setClientSeed(msg.seed);
        break;
      case "seed:rotate":
        this.session.requestSeedRotation();
        break;
    }
  }
}
