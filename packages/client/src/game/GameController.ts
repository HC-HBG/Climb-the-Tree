import {
  DEFAULT_CONFIG,
  STUB_STARTING_BALANCE_CENTS,
  multiplierAtTime,
  type ErrorCode,
  type GameConfig,
} from "@climb-the-tree/engine";
import type { Transport } from "../net/transport.js";

export type ClientState = "BOOT" | "IDLE" | "WAITING" | "CLIMBING" | "CASHED" | "CRASHED" | "RESET";

export const MILESTONES = [2, 5, 10, 20, 50, 100, 250, 500, 1000];

const RESET_DELAY_MS = 2200;
const MAIN_BUTTON_DEBOUNCE_MS = 150;

export interface HistoryEntry {
  crash: number;
  won: boolean;
}

export interface GameSnapshot {
  state: ClientState;
  balanceCents: number;
  betCents: number;
  autoOn: boolean;
  autoXHundredths: number;
  seedHash: string;
  nonce: number;
  currentMultiplier: number;
  cashResult: { x: number; winCents: number } | undefined;
  crashResult: { crash: number } | undefined;
  history: HistoryEntry[];
  highestCashedX: number;
  lastError: { code: ErrorCode; message: string } | undefined;
}

/**
 * Client-side state machine implementing FSD §3 (BOOT/IDLE/WAITING/CLIMBING/
 * CASHED/CRASHED/RESET) and the betting/auto-cashout/in-round behavior of
 * §4.1–§4.3. Owns the WebSocket connection and the locally-predicted
 * multiplier curve; the true crash point is never known client-side until
 * the server reveals it in round:crashed (or the round is won first).
 */
export class GameController {
  readonly config: GameConfig = DEFAULT_CONFIG;

  private readonly socket: Transport;
  private readonly listeners = new Set<() => void>();

  private state: ClientState = "BOOT";
  private balanceCents = STUB_STARTING_BALANCE_CENTS;
  private betCents = 10_000; // $100.00 default, matches the mockup
  private autoOn = false;
  private autoXHundredths = 1000; // 10.00x default

  private seedHash = "";
  private nonce = 0;

  private roundStartTs: number | undefined;
  private clockOffsetMs = 0;
  private maxElapsedMs = 0;
  private currentMultiplier = 1;

  private wonThisRound = false;
  private cashResult: { x: number; winCents: number } | undefined;
  private crashResult: { crash: number } | undefined;
  private history: HistoryEntry[] = [];
  private highestCashedX = 1;
  private lastError: { code: ErrorCode; message: string } | undefined;

  private pendingBetDebitCents: number | undefined;
  private lastMainPressAtMs = 0;
  private resetTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(transport: Transport) {
    this.socket = transport;
    this.socket.onMessage((msg) => {
      switch (msg.type) {
        case "round:ready":
          this.seedHash = msg.seedHash;
          this.nonce = msg.nonce;
          if (this.state === "BOOT") this.state = "IDLE";
          this.notify();
          break;
        case "round:started":
          if (this.state === "WAITING") {
            this.state = "CLIMBING";
            this.roundStartTs = msg.startTs;
            this.maxElapsedMs = 0;
            this.currentMultiplier = 1;
            this.wonThisRound = false;
            this.cashResult = undefined;
            this.crashResult = undefined;
          }
          this.notify();
          break;
        case "round:tick": {
          const newOffset = msg.serverTime - Date.now();
          this.clockOffsetMs = this.clockOffsetMs + 0.25 * (newOffset - this.clockOffsetMs);
          break;
        }
        case "cashout:confirmed":
          this.wonThisRound = true;
          this.cashResult = { x: msg.x, winCents: msg.win };
          this.balanceCents = msg.balance;
          if (msg.x > this.highestCashedX) this.highestCashedX = msg.x;
          this.state = "CASHED";
          this.scheduleReset();
          this.notify();
          break;
        case "round:crashed":
          this.crashResult = { crash: msg.crash };
          this.history.unshift({ crash: msg.crash, won: this.wonThisRound });
          if (this.history.length > 20) this.history.pop();
          if (!this.wonThisRound) {
            this.state = "CRASHED";
            this.scheduleReset();
          }
          this.notify();
          break;
        case "error":
          if (this.pendingBetDebitCents !== undefined) {
            this.balanceCents += this.pendingBetDebitCents;
            this.pendingBetDebitCents = undefined;
          }
          this.lastError = { code: msg.code, message: msg.msg };
          if (this.state === "WAITING") this.state = "IDLE";
          this.notify();
          break;
      }
    });
  }

  start(): void {
    this.socket.connect();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }

  private clampBetCents(cents: number): number {
    const max = Math.min(this.config.maxBetCents, this.balanceCents);
    return Math.min(Math.max(cents, this.config.minBetCents), Math.max(max, this.config.minBetCents));
  }

  /** FR-01: numeric, 2dp, clamped. Invalid input reverts (handled by caller passing last-valid on parse failure). */
  setBetCents(cents: number): void {
    if (this.state !== "IDLE") return;
    this.betCents = this.clampBetCents(cents);
    this.notify();
  }

  /** FR-02: steppers adjust by 1 below 10.00, by 10 at or above. */
  stepBetDown(): void {
    this.setBetCents(this.betCents - (this.betCents > 1000 ? 1000 : 100));
  }

  stepBetUp(): void {
    this.setBetCents(this.betCents + (this.betCents >= 1000 ? 1000 : 100));
  }

  quickHalf(): void {
    this.setBetCents(Math.round(this.betCents / 2));
  }

  quickDouble(): void {
    this.setBetCents(this.betCents * 2);
  }

  quickMax(): void {
    this.setBetCents(Math.min(this.config.maxBetCents, this.balanceCents));
  }

  toggleAuto(): void {
    this.autoOn = !this.autoOn;
    this.notify();
  }

  /** FR-05: minimum 1.01, maximum 1000, 2dp. */
  setAutoX(x: number): void {
    const clamped = Math.min(Math.max(x, 1.01), this.config.maxMultiplier);
    this.autoXHundredths = Math.round(clamped * 100);
    this.notify();
  }

  /** FR-10: spacebar mirrors the main button; 150ms debounce. */
  pressMain(nowMs = Date.now()): void {
    if (nowMs - this.lastMainPressAtMs < MAIN_BUTTON_DEBOUNCE_MS) return;
    this.lastMainPressAtMs = nowMs;
    if (this.state === "IDLE") this.climb();
    else if (this.state === "CLIMBING") this.cashOut();
  }

  private climb(): void {
    // FR-04: disabled when bet > balance, bet < minBet, or state is not IDLE.
    if (this.state !== "IDLE") return;
    if (this.betCents > this.balanceCents || this.betCents < this.config.minBetCents) return;

    this.lastError = undefined;
    this.pendingBetDebitCents = this.betCents;
    this.balanceCents -= this.betCents;
    this.state = "WAITING";
    this.notify();

    this.socket.send({
      type: "bet:place",
      amount: this.betCents,
      autoX: this.autoOn ? this.autoXHundredths / 100 : undefined,
    });
  }

  private cashOut(): void {
    if (this.state !== "CLIMBING") return;
    this.socket.send({ type: "cashout", clientTs: Date.now() });
  }

  setClientSeed(seed: string): void {
    this.socket.send({ type: "seed:setClient", seed });
  }

  rotateSeed(): void {
    this.socket.send({ type: "seed:rotate" });
  }

  /** Advances the locally-predicted multiplier curve; call every animation frame. */
  tick(clientNowMs: number): void {
    if (this.state !== "CLIMBING" || this.roundStartTs === undefined) return;
    const estimatedServerNow = clientNowMs + this.clockOffsetMs;
    let elapsedMs = estimatedServerNow - this.roundStartTs;
    // FR-11: drift correction smoothed, never backwards.
    if (elapsedMs < this.maxElapsedMs) elapsedMs = this.maxElapsedMs;
    this.maxElapsedMs = elapsedMs;
    this.currentMultiplier = multiplierAtTime(elapsedMs / 1000, this.config);
    this.notify();
  }

  private scheduleReset(): void {
    if (this.resetTimer) clearTimeout(this.resetTimer);
    this.resetTimer = setTimeout(() => {
      this.state = "RESET";
      this.notify();
      this.pendingBetDebitCents = undefined;
      this.state = "IDLE";
      this.notify();
    }, RESET_DELAY_MS);
  }

  getSnapshot(): GameSnapshot {
    return {
      state: this.state,
      balanceCents: this.balanceCents,
      betCents: this.betCents,
      autoOn: this.autoOn,
      autoXHundredths: this.autoXHundredths,
      seedHash: this.seedHash,
      nonce: this.nonce,
      currentMultiplier: this.currentMultiplier,
      cashResult: this.cashResult,
      crashResult: this.crashResult,
      history: this.history,
      highestCashedX: this.highestCashedX,
      lastError: this.lastError,
    };
  }
}
