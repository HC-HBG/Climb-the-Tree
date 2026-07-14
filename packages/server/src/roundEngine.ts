import {
  DEFAULT_CONFIG,
  drawCrash,
  multiplierAtTime,
  payoutCents,
  randomSeedHex,
  sha256Hex,
  timeForMultiplier,
  type CrashDraw,
  type ErrorCode,
  type GameConfig,
} from "@climb-the-tree/engine";
import type { Wallet } from "./wallet.js";

export type RoundState = "IDLE" | "CLIMBING";

export interface ReadyInfo {
  seedHash: string;
  nonce: number;
}

export type PlaceBetResult =
  | { ok: true; startTs: number; crashAtMs: number; autoCashoutAtMs?: number }
  | { ok: false; error: ErrorCode; message: string };

export interface CrashSettlement {
  kind: "cashed" | "crashed";
  x: number;
  winCents: number;
  balanceCents: number;
  crash: number;
  /** Present only when a seed:rotate request is being fulfilled by this settlement (FR-21). */
  serverSeedRevealed?: string;
}

export type CashoutResult =
  | ({ ok: true } & CrashSettlement)
  | { ok: false; error: ErrorCode; message: string };

interface ActiveRound {
  betCents: number;
  autoXHundredths?: number;
  draw: CrashDraw;
  startTs: number;
  crashAtMs: number;
  autoCashoutAtMs?: number;
  settled: boolean;
}

/**
 * Authoritative round engine for a single player session, per FSD §2.1/§3.
 * Owns the seed, the crash draw, and settlement; the crash point never
 * leaves the server during a live round. Deliberately timer-free — the
 * caller (the WebSocket layer) decides when to poll `checkDue`, which makes
 * this class trivial to drive deterministically from tests.
 */
export class RoundSession {
  private readonly config: GameConfig;
  private readonly wallet: Wallet;
  private serverSeed: string;
  private clientSeed: string;
  private pendingClientSeed: string | undefined;
  private nonce = 0;
  private state: RoundState = "IDLE";
  private round: ActiveRound | undefined;
  private rotationPending = false;

  constructor(
    wallet: Wallet,
    config: GameConfig = DEFAULT_CONFIG,
    options?: { serverSeed?: string; clientSeed?: string; nonce?: number },
  ) {
    this.wallet = wallet;
    this.config = config;
    this.serverSeed = options?.serverSeed ?? randomSeedHex();
    this.clientSeed = options?.clientSeed ?? "default";
    this.nonce = options?.nonce ?? 0;
  }

  getState(): RoundState {
    return this.state;
  }

  async getReadyInfo(): Promise<ReadyInfo> {
    const seedHash = await sha256Hex(this.serverSeed);
    return { seedHash, nonce: this.nonce };
  }

  /** FR-20: takes effect next round only. */
  setClientSeed(seed: string): void {
    this.pendingClientSeed = seed;
  }

  /**
   * FR-20/FR-21: queues a server-seed rotation. Takes effect — and reveals
   * the outgoing seed via the next round:crashed — only once the round
   * in flight (if any) settles, never mid-round. If no round is active the
   * rotation applies immediately and the revealed seed is returned directly.
   */
  requestSeedRotation(): string | undefined {
    this.rotationPending = true;
    return this.state === "IDLE" ? this.applyRotation() : undefined;
  }

  private applyRotation(): string {
    const revealed = this.serverSeed;
    this.serverSeed = randomSeedHex();
    this.nonce = 0;
    this.rotationPending = false;
    return revealed;
  }

  async placeBet(amountCents: number, autoX: number | undefined, nowMs: number): Promise<PlaceBetResult> {
    if (this.state !== "IDLE") {
      return { ok: false, error: "ROUND_IN_PROGRESS", message: "A round is already active." };
    }
    if (
      !Number.isInteger(amountCents) ||
      amountCents < this.config.minBetCents ||
      amountCents > this.config.maxBetCents
    ) {
      return { ok: false, error: "INVALID_BET", message: "Bet is outside the allowed range." };
    }
    if (autoX !== undefined && (autoX < 1.01 || autoX > this.config.maxMultiplier)) {
      return { ok: false, error: "INVALID_BET", message: "Auto cash-out target is out of range." };
    }
    if (amountCents > this.wallet.balanceCents) {
      return { ok: false, error: "INSUFFICIENT_FUNDS", message: "Insufficient balance." };
    }

    if (this.pendingClientSeed !== undefined) {
      this.clientSeed = this.pendingClientSeed;
      this.pendingClientSeed = undefined;
    }

    this.wallet.debit(amountCents);
    const draw = await drawCrash(this.serverSeed, this.clientSeed, this.nonce, this.config);
    this.nonce += 1;

    const crashAtMs = nowMs + timeForMultiplier(draw.crash, this.config) * 1000;
    const autoCashoutAtMs =
      autoX !== undefined ? nowMs + timeForMultiplier(autoX, this.config) * 1000 : undefined;

    this.round = {
      betCents: amountCents,
      autoXHundredths: autoX !== undefined ? Math.round(autoX * 100) : undefined,
      draw,
      startTs: nowMs,
      crashAtMs,
      autoCashoutAtMs,
      settled: false,
    };
    this.state = "CLIMBING";

    return { ok: true, startTs: nowMs, crashAtMs, autoCashoutAtMs };
  }

  /**
   * Applies whichever settlement is due at `nowMs` (auto cash-out target or
   * crash/ceiling), if any. Idempotent: a no-op once the round is settled.
   * The caller is expected to invoke this on a timer/tick; `cashoutRequest`
   * also calls it first so a race against an already-due event resolves
   * server-authoritatively rather than by arrival order.
   */
  checkDue(nowMs: number): CrashSettlement | undefined {
    const round = this.round;
    if (!round || round.settled || this.state !== "CLIMBING") return undefined;

    const autoX =
      round.autoXHundredths !== undefined ? round.autoXHundredths / 100 : undefined;

    // E-06: auto target wins if autoX <= crash, settled at exactly the target.
    if (
      autoX !== undefined &&
      round.autoCashoutAtMs !== undefined &&
      nowMs >= round.autoCashoutAtMs &&
      autoX <= round.draw.crash
    ) {
      return this.settle(round, autoX, "cashed");
    }

    if (nowMs >= round.crashAtMs) {
      // E-07: reaching the ceiling force-settles as a win at the ceiling.
      if (round.draw.crash >= this.config.maxMultiplier) {
        return this.settle(round, this.config.maxMultiplier, "cashed");
      }
      return this.settle(round, round.draw.crash, "crashed");
    }

    return undefined;
  }

  /** FR-09: manual cashout. Server settles at the multiplier for `nowMs`. */
  cashoutRequest(nowMs: number): CashoutResult {
    if (!this.round || this.state !== "CLIMBING") {
      return { ok: false, error: "NO_ACTIVE_ROUND", message: "No active round to cash out." };
    }

    // Resolve any settlement that is already due before honoring a manual
    // request — this is what makes E-02/E-03 race conditions deterministic.
    const due = this.checkDue(nowMs);
    if (due) {
      return due.kind === "cashed"
        ? { ok: false, error: "ALREADY_SETTLED", message: "Round already settled." }
        : { ok: false, error: "AFTER_CRASH", message: "The round had already crashed." };
    }

    if (this.round.settled) {
      // E-03: double cashout (click + spacebar race) — second request ignored.
      return { ok: false, error: "ALREADY_SETTLED", message: "Round already settled." };
    }

    const elapsedSeconds = (nowMs - this.round.startTs) / 1000;
    const x = Math.min(multiplierAtTime(elapsedSeconds, this.config), this.round.draw.crash);
    const settlement = this.settle(this.round, x, "cashed");
    return { ok: true, ...settlement };
  }

  private settle(round: ActiveRound, x: number, kind: "cashed" | "crashed"): CrashSettlement {
    round.settled = true;
    this.state = "IDLE";
    const winCents = kind === "cashed" ? payoutCents(round.betCents, x) : 0;
    if (winCents > 0) this.wallet.credit(winCents);
    const serverSeedRevealed = this.rotationPending ? this.applyRotation() : undefined;
    return {
      kind,
      x,
      winCents,
      balanceCents: this.wallet.balanceCents,
      crash: round.draw.crash,
      serverSeedRevealed,
    };
  }
}
