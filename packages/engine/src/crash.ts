import { sha256Hex } from "./sha256.js";
import { DEFAULT_CONFIG, type GameConfig } from "./config.js";

/** Number of leading hex characters of the hash used to derive U (52 bits = 13 hex chars). */
const U_HEX_CHARS = 13;
const TWO_POW_52 = 2 ** 52;

/**
 * Derives the uniform draw U in [0, 1) from a hex-encoded SHA-256 digest,
 * per Math Specification §Summary:
 *   U = first 52 bits of SHA256(serverSeed:clientSeed:nonce) / 2^52
 */
export function uniformFromHash(hashHex: string): number {
  const prefix = hashHex.slice(0, U_HEX_CHARS);
  return Number(BigInt("0x" + prefix)) / TWO_POW_52;
}

/**
 * Crash formula, per Math Specification §Summary:
 *   crash = trunc( min( max( RTP / U, 1.00 ), MaxMultiplier ), 2 dp )
 *
 * U is guarded away from 0 (which cannot occur from a real SHA-256 digest,
 * but is exercised as a boundary case) so the division never yields Infinity.
 */
export function crashFromUniform(
  u: number,
  config: Pick<GameConfig, "rtp" | "maxMultiplier"> = DEFAULT_CONFIG,
): number {
  const raw = rawCrash(u, config);
  return Math.trunc(raw * 100) / 100;
}

function rawCrash(u: number, config: Pick<GameConfig, "rtp" | "maxMultiplier">): number {
  const safeU = Math.max(u, 1e-12);
  return Math.min(Math.max(config.rtp / safeU, 1.0), config.maxMultiplier);
}

/**
 * True "instant fall" per Math Specification §Summary: P(U >= RTP), i.e. the
 * draw where the max(...,1.00) clamp binds *before* 2dp truncation.
 *
 * This is distinct from `crashFromUniform(u) === 1.00`: 2dp truncation also
 * rounds the thin (1.00, 1.01) band down to a displayed 1.00x (those rounds
 * still crash within ~70ms of round start per the growth curve, so they read
 * as instant to the player, but they are not the analytic P(U >= RTP) event
 * that the RTP/instant-fall statistics in the math spec are defined against).
 * Use this flag for statistical validation; use the crash number itself for
 * display, settlement, and the branch-snap-vs-tumble presentation trigger.
 */
export function isInstantFall(
  u: number,
  config: Pick<GameConfig, "rtp" | "maxMultiplier"> = DEFAULT_CONFIG,
): boolean {
  return rawCrash(u, config) <= 1.0;
}

export interface CrashDraw {
  serverSeed: string;
  clientSeed: string;
  nonce: number;
  hash: string;
  u: number;
  crash: number;
  instantFall: boolean;
}

/** Builds the provably-fair message hashed for a given round. */
export function crashMessage(serverSeed: string, clientSeed: string, nonce: number): string {
  return `${serverSeed}:${clientSeed}:${nonce}`;
}

/**
 * Full provably-fair crash derivation for one round: hashes
 * (serverSeed, clientSeed, nonce), derives U, and applies the crash formula.
 * Deterministic given identical inputs.
 */
export async function drawCrash(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  config: Pick<GameConfig, "rtp" | "maxMultiplier"> = DEFAULT_CONFIG,
): Promise<CrashDraw> {
  const hash = await sha256Hex(crashMessage(serverSeed, clientSeed, nonce));
  const u = uniformFromHash(hash);
  const crash = crashFromUniform(u, config);
  const instantFall = isInstantFall(u, config);
  return { serverSeed, clientSeed, nonce, hash, u, crash, instantFall };
}
