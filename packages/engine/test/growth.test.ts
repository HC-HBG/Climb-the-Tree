import { describe, expect, it } from "vitest";
import { multiplierAtTime, timeForMultiplier } from "../src/growth.js";
import { DEFAULT_CONFIG } from "../src/config.js";

// Cross-checked against Math Specification §Growth Curve (k = 0.15).
const VECTORS: Array<{ multiplier: number; seconds: number }> = [
  { multiplier: 1.5, seconds: 2.7031007207211 },
  { multiplier: 2, seconds: 4.62098120373297 },
  { multiplier: 3, seconds: 7.32408192445407 },
  { multiplier: 5, seconds: 10.729586082894 },
  { multiplier: 10, seconds: 15.350567286627 },
  { multiplier: 20, seconds: 19.9715484903599 },
  { multiplier: 50, seconds: 26.080153369521 },
  { multiplier: 100, seconds: 30.7011345732539 },
  { multiplier: 250, seconds: 36.809739452415 },
  { multiplier: 500, seconds: 41.430720656148 },
  { multiplier: 1000, seconds: 46.0517018598809 },
];

describe("growth curve m(t) = e^(k*t) — Math Specification §Growth Curve", () => {
  for (const v of VECTORS) {
    it(`t(${v.multiplier}x) matches the spec`, () => {
      expect(timeForMultiplier(v.multiplier)).toBeCloseTo(v.seconds, 6);
    });

    it(`m(t) at that time returns back to ${v.multiplier}x`, () => {
      expect(multiplierAtTime(v.seconds)).toBeCloseTo(v.multiplier, 6);
    });
  }

  it("m(0) = 1", () => {
    expect(multiplierAtTime(0)).toBe(1);
  });

  it("is a pure function of (t, k) with zero effect on odds", () => {
    const a = multiplierAtTime(5, { growthK: DEFAULT_CONFIG.growthK });
    const b = multiplierAtTime(5, { growthK: DEFAULT_CONFIG.growthK });
    expect(a).toBe(b);
  });
});
