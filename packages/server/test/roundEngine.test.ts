import { describe, expect, it } from "vitest";
import { timeForMultiplier } from "@climb-the-tree/engine";
import { RoundSession } from "../src/roundEngine.js";
import { Wallet } from "../src/wallet.js";

const START_BALANCE = 500_000; // $5,000.00 in cents

// Fixed serverSeed/clientSeed/nonce combos with known crash outcomes, so
// tests are deterministic without needing to fake the crypto layer.
// nonce 0 under (serverSeed, "hungrybear") is the Math Spec §Test Vectors
// seed and reproduces crash = 2.13 bit-exactly (see packages/engine tests).
const VECTOR_SEED =
  "0000000000000000000000000000000000000000000000000000000000000001";
const VECTOR_CLIENT = "hungrybear";
const VECTOR_CRASH_AT_NONCE_0 = 2.13;

// (test-server-seed-e07, test-client-seed-e07) at nonce 1658 draws U so small
// that raw crash clamps to the 1000x ceiling (found by brute-force search).
const CEILING_SEED = "test-server-seed-e07";
const CEILING_CLIENT = "test-client-seed-e07";
const CEILING_NONCE = 1658;

// (test-server-seed-instant, test-client-seed-instant) at nonce 34 draws
// U >= RTP, i.e. a genuine instant fall (crash = 1.00x).
const INSTANT_SEED = "test-server-seed-instant";
const INSTANT_CLIENT = "test-client-seed-instant";
const INSTANT_NONCE = 34;

function newSession(overrides?: { serverSeed?: string; clientSeed?: string; nonce?: number }) {
  const wallet = new Wallet(START_BALANCE);
  const session = new RoundSession(wallet, undefined, overrides);
  return { wallet, session };
}

describe("RoundSession — FSD §3 state transitions", () => {
  it("starts IDLE and exposes a seed commitment before any bet", async () => {
    const { session } = newSession();
    expect(session.getState()).toBe("IDLE");
    const ready = await session.getReadyInfo();
    expect(ready.nonce).toBe(0);
    expect(ready.seedHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("IDLE -> CLIMBING on a valid bet", async () => {
    const { session } = newSession({ serverSeed: VECTOR_SEED, clientSeed: VECTOR_CLIENT });
    const now = 1_000;
    const result = await session.placeBet(100, undefined, now);
    expect(result.ok).toBe(true);
    expect(session.getState()).toBe("CLIMBING");
  });

  it("CLIMBING -> IDLE on manual cashout (CASHED)", async () => {
    const { session, wallet } = newSession({
      serverSeed: VECTOR_SEED,
      clientSeed: VECTOR_CLIENT,
    });
    const now = 1_000;
    await session.placeBet(100, undefined, now);
    // Crash for this seed/nonce is 2.13x, reached at ~t=1.395s (ln(2.13)/0.15).
    const cashoutAt = now + 500; // well before crash
    const result = session.cashoutRequest(cashoutAt);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.x).toBeGreaterThan(1);
      expect(result.x).toBeLessThan(2.13);
      expect(wallet.balanceCents).toBe(START_BALANCE - 100 + result.winCents);
    }
    expect(session.getState()).toBe("IDLE");
  });

  it("CLIMBING -> IDLE on crash (CRASHED), no payout", async () => {
    const { session, wallet } = newSession({
      serverSeed: VECTOR_SEED,
      clientSeed: VECTOR_CLIENT,
    });
    const now = 1_000;
    await session.placeBet(100, undefined, now);
    const crashAtMs = now + timeForMultiplier(VECTOR_CRASH_AT_NONCE_0) * 1000;
    const settlement = session.checkDue(crashAtMs + 1);
    expect(settlement?.kind).toBe("crashed");
    expect(settlement?.winCents).toBe(0);
    expect(wallet.balanceCents).toBe(START_BALANCE - 100);
    expect(session.getState()).toBe("IDLE");
  });

  it("a new round after settlement gets the next nonce", async () => {
    const { session } = newSession({ serverSeed: VECTOR_SEED, clientSeed: VECTOR_CLIENT });
    await session.placeBet(100, undefined, 0);
    session.cashoutRequest(100);
    const ready = await session.getReadyInfo();
    expect(ready.nonce).toBe(1);
  });
});

describe("RoundSession — edge cases", () => {
  it("E-02: cashout request arrives after crash is rejected; crash result stands", async () => {
    const { session, wallet } = newSession({
      serverSeed: VECTOR_SEED,
      clientSeed: VECTOR_CLIENT,
    });
    const now = 0;
    await session.placeBet(100, undefined, now);
    const crashAtMs = now + timeForMultiplier(VECTOR_CRASH_AT_NONCE_0) * 1000;

    const result = session.cashoutRequest(crashAtMs + 50);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("AFTER_CRASH");
    expect(wallet.balanceCents).toBe(START_BALANCE - 100);
    expect(session.getState()).toBe("IDLE");
  });

  it("E-03: double cashout (click + spacebar race) — second request is ignored", async () => {
    const { session } = newSession({ serverSeed: VECTOR_SEED, clientSeed: VECTOR_CLIENT });
    const now = 0;
    await session.placeBet(100, undefined, now);

    const first = session.cashoutRequest(now + 200);
    expect(first.ok).toBe(true);

    // Once settled, the round is gone server-side (not merely "already
    // cashed") — the second request is correctly told there's nothing active.
    const second = session.cashoutRequest(now + 201);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toBe("NO_ACTIVE_ROUND");
  });

  it("E-04: bet with insufficient funds is rejected and state stays IDLE", async () => {
    const poorWallet = new Wallet(50); // 50 cents — below the 100-cent bet, but within [minBet, maxBet]
    const session = new RoundSession(poorWallet, undefined, {
      serverSeed: VECTOR_SEED,
      clientSeed: VECTOR_CLIENT,
    });
    const result = await session.placeBet(100, undefined, 0);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("INSUFFICIENT_FUNDS");
    expect(session.getState()).toBe("IDLE");
    expect(poorWallet.balanceCents).toBe(50);
  });

  it("E-06: auto cashout wins when armed exactly at the crash target (autoX <= crash)", async () => {
    const { session, wallet } = newSession({
      serverSeed: VECTOR_SEED,
      clientSeed: VECTOR_CLIENT,
    });
    const now = 0;
    // Crash at this seed/nonce is 2.13x; arm auto cashout at the same value.
    const placed = await session.placeBet(100, VECTOR_CRASH_AT_NONCE_0, now);
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    expect(placed.autoCashoutAtMs).toBeDefined();

    const settlement = session.checkDue(placed.autoCashoutAtMs! + 1);
    expect(settlement?.kind).toBe("cashed");
    expect(settlement?.x).toBe(VECTOR_CRASH_AT_NONCE_0);
    expect(settlement?.winCents).toBeGreaterThan(0);
    expect(wallet.balanceCents).toBe(START_BALANCE - 100 + (settlement?.winCents ?? 0));
  });

  it("auto cashout does NOT fire when the target is above the crash", async () => {
    const { session, wallet } = newSession({
      serverSeed: VECTOR_SEED,
      clientSeed: VECTOR_CLIENT,
    });
    const now = 0;
    // Crash at this seed/nonce is 2.13x; arm auto cashout above it at 5x.
    const placed = await session.placeBet(100, 5, now);
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;

    const crashAtMs = now + timeForMultiplier(VECTOR_CRASH_AT_NONCE_0) * 1000;
    const settlement = session.checkDue(crashAtMs + 1);
    expect(settlement?.kind).toBe("crashed");
    expect(settlement?.winCents).toBe(0);
    expect(wallet.balanceCents).toBe(START_BALANCE - 100);
  });

  it("E-07: reaching the 1000x ceiling force-settles as a win at 1000x", async () => {
    const { session, wallet } = newSession({
      serverSeed: CEILING_SEED,
      clientSeed: CEILING_CLIENT,
      nonce: CEILING_NONCE,
    });
    const now = 0;
    const placed = await session.placeBet(100, undefined, now);
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;

    const settlement = session.checkDue(placed.crashAtMs + 1);
    expect(settlement?.kind).toBe("cashed");
    expect(settlement?.x).toBe(1000);
    expect(settlement?.winCents).toBe(100 * 1000);
    expect(wallet.balanceCents).toBe(START_BALANCE - 100 + 100 * 1000);
  });

  it("rejects placing a second bet while a round is already active (one round per session)", async () => {
    const { session } = newSession({ serverSeed: VECTOR_SEED, clientSeed: VECTOR_CLIENT });
    await session.placeBet(100, undefined, 0);
    const second = await session.placeBet(100, undefined, 10);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toBe("ROUND_IN_PROGRESS");
  });

  it("an instant fall (1.00x) crashes immediately (t=0) and pays nothing", async () => {
    const { session, wallet } = newSession({
      serverSeed: INSTANT_SEED,
      clientSeed: INSTANT_CLIENT,
      nonce: INSTANT_NONCE,
    });
    const now = 5_000;
    const placed = await session.placeBet(100, undefined, now);
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    expect(placed.crashAtMs).toBe(now); // ln(1.00)/k = 0 elapsed seconds

    const settlement = session.checkDue(now);
    expect(settlement?.kind).toBe("crashed");
    expect(settlement?.x).toBe(1.0);
    expect(settlement?.winCents).toBe(0);
    expect(wallet.balanceCents).toBe(START_BALANCE - 100);
  });
});
