import { describe, expect, it } from "vitest";
import { crashFromUniform, drawCrash, uniformFromHash } from "../src/crash.js";
import { sha256Hex } from "../src/sha256.js";
import { DEFAULT_CONFIG } from "../src/config.js";

// Deterministic test vectors from Math Specification §Test Vectors.
// Any engine implementation must reproduce the Crash column bit-exactly
// (truncated to 2dp). This is the definition of done for the engine.
const SERVER_SEED =
  "0000000000000000000000000000000000000000000000000000000000000001";
const CLIENT_SEED = "hungrybear";
const SEED_HASH = "c386d8e8d07342f2e39e189c8e6c57bb205bb373fe4e3a6f69404a8bb767b417";

const VECTORS: Array<{ nonce: number; hexPrefix: string; u: number; crash: number }> = [
  { nonce: 0, hexPrefix: "747011e714477", u: 0.4548350515, crash: 2.13 },
  { nonce: 1, hexPrefix: "56336f96b3b0e", u: 0.3367223494, crash: 2.88 },
  { nonce: 2, hexPrefix: "6b80614886be4", u: 0.4199276735, crash: 2.3 },
  { nonce: 3, hexPrefix: "2c27e585b454e", u: 0.1724837734, crash: 5.62 },
  { nonce: 4, hexPrefix: "251ce9c7972fa", u: 0.1449724304, crash: 6.69 },
  { nonce: 5, hexPrefix: "d34d7da92d3e9", u: 0.8254011667, crash: 1.17 },
  { nonce: 6, hexPrefix: "309e25b8547e7", u: 0.189913137, crash: 5.1 },
  { nonce: 7, hexPrefix: "d7a60094b49ad", u: 0.8423767436, crash: 1.15 },
];

describe("provably-fair crash derivation — Math Specification §Test Vectors", () => {
  it("hashes the server seed to the published commitment hash", async () => {
    await expect(sha256Hex(SERVER_SEED)).resolves.toBe(SEED_HASH);
  });

  for (const v of VECTORS) {
    it(`nonce ${v.nonce}: reproduces H, U and crash bit-exactly`, async () => {
      const draw = await drawCrash(SERVER_SEED, CLIENT_SEED, v.nonce);
      expect(draw.hash.slice(0, 13)).toBe(v.hexPrefix);
      expect(draw.u).toBeCloseTo(v.u, 10);
      expect(draw.crash).toBe(v.crash);
    });
  }
});

describe("crashFromUniform boundary cases — Math Specification §Test Vectors note", () => {
  it("caps to MaxMultiplier as U -> 1e-12 (or below)", () => {
    expect(crashFromUniform(1e-12)).toBe(DEFAULT_CONFIG.maxMultiplier);
    expect(crashFromUniform(0)).toBe(DEFAULT_CONFIG.maxMultiplier);
  });

  it("clamps to 1.00 instant fall when U >= RTP", () => {
    expect(crashFromUniform(0.99)).toBe(1.0);
    expect(crashFromUniform(1)).toBe(1.0);
  });

  it("clamps to exactly 1.00 when U equals RTP exactly", () => {
    expect(crashFromUniform(DEFAULT_CONFIG.rtp)).toBe(1.0);
  });

  it("truncates rather than rounds to 2dp", () => {
    // Choose u so that raw = RTP/u = 2.999 exactly: truncation gives 2.99,
    // rounding would give 3.00.
    const u = DEFAULT_CONFIG.rtp / 2.999;
    expect(crashFromUniform(u)).toBe(2.99);
  });
});

describe("uniformFromHash", () => {
  it("maps a hex digest to [0, 1)", () => {
    const u = uniformFromHash("747011e71447700000000000000000000000000000000000000000000000");
    expect(u).toBeGreaterThanOrEqual(0);
    expect(u).toBeLessThan(1);
  });
});
