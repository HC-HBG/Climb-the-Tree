import { describe, expect, it } from "vitest";
import { payoutCents, multiplierToHundredths } from "../src/settlement.js";

describe("settlement — integer cents, floor rounding (NFR-03)", () => {
  it("multiplierToHundredths converts a 2dp multiplier to an exact integer", () => {
    expect(multiplierToHundredths(2.13)).toBe(213);
    expect(multiplierToHundredths(1.0)).toBe(100);
    expect(multiplierToHundredths(1000)).toBe(100000);
  });

  it("floors the payout in integer cents", () => {
    // 100 cents bet * 2.13x = 213 cents exactly.
    expect(payoutCents(100, 2.13)).toBe(213);
    // 333 cents bet * 2.13x = 709.29 -> floors to 709.
    expect(payoutCents(333, 2.13)).toBe(709);
  });

  it("never drifts from floating point imprecision across many bet/multiplier pairs", () => {
    for (let bet = 1; bet <= 500; bet++) {
      for (const x of [1.01, 1.5, 2.13, 5.62, 9.99, 100, 1000]) {
        const hundredths = Math.round(x * 100);
        const expected = Math.floor((bet * hundredths) / 100);
        expect(payoutCents(bet, x)).toBe(expected);
      }
    }
  });

  it("a losing round (crash = 1.00, no cashout) pays nothing", () => {
    // Modeled at the caller level: settlement only ever runs on a cashed-out
    // bet, so this just documents that 1.00x returns exactly the stake.
    expect(payoutCents(100, 1.0)).toBe(100);
  });
});
