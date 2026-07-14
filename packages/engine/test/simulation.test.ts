import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { crashFromUniform, crashMessage, isInstantFall, uniformFromHash } from "../src/crash.js";
import { DEFAULT_CONFIG } from "../src/config.js";

/**
 * Statistical validation of the crash draw, per FSD §7 acceptance criteria
 * and Math Specification §QA Tests ("RTP convergence", "Instant-fall
 * frequency"): 1M rounds, RTP within ±0.3% of 97% at targets 1.5/2/5/10,
 * instant-fall 3.0% ± 0.1%.
 *
 * Uses node:crypto's synchronous createHash purely so 1M hashes run in
 * seconds inside a test file (this file never ships to the client); the
 * statistical properties under test — uniformFromHash, crashFromUniform and
 * isInstantFall — are the real engine functions, unmodified.
 */
const ROUNDS = 1_000_000;
const TARGETS = [1.5, 2, 5, 10];
const SERVER_SEED = "simulation-server-seed";
const CLIENT_SEED = "simulation-client-seed";

interface SimResult {
  crashes: Float64Array;
  instantFallCount: number;
}

function simulate(rounds: number): SimResult {
  const crashes = new Float64Array(rounds);
  let instantFallCount = 0;
  for (let nonce = 0; nonce < rounds; nonce++) {
    const hash = createHash("sha256")
      .update(crashMessage(SERVER_SEED, CLIENT_SEED, nonce))
      .digest("hex");
    const u = uniformFromHash(hash);
    crashes[nonce] = crashFromUniform(u);
    if (isInstantFall(u)) instantFallCount++;
  }
  return { crashes, instantFallCount };
}

describe("1M-round simulation — FSD §7 / Math Spec §QA Tests", () => {
  const { crashes, instantFallCount } = simulate(ROUNDS);

  for (const target of TARGETS) {
    it(`RTP at target ${target}x is within ±0.3% of 97%`, () => {
      let hits = 0;
      for (const c of crashes) if (c >= target) hits++;
      const rtp = (target * hits) / ROUNDS;
      expect(rtp).toBeGreaterThanOrEqual(0.97 - 0.003);
      expect(rtp).toBeLessThanOrEqual(0.97 + 0.003);
    });
  }

  it("true instant-fall rate (P(U >= RTP)) is 3.0% ± 0.1%", () => {
    const rate = instantFallCount / ROUNDS;
    expect(rate).toBeGreaterThanOrEqual(0.03 - 0.001);
    expect(rate).toBeLessThanOrEqual(0.03 + 0.001);
  });

  it("never exceeds the configured max multiplier", () => {
    let max = -Infinity;
    for (const c of crashes) if (c > max) max = c;
    expect(max).toBeLessThanOrEqual(DEFAULT_CONFIG.maxMultiplier);
  });

  it("never falls below 1.00x", () => {
    let min = Infinity;
    for (const c of crashes) if (c < min) min = c;
    expect(min).toBeGreaterThanOrEqual(1.0);
  });
});
