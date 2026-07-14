import { DEFAULT_CONFIG, type GameConfig } from "./config.js";

/**
 * Displayed multiplier growth curve, per Math Specification §Growth Curve:
 *   m(t) = e^(k*t)
 * Presentation layer only — has zero effect on odds. Used by both the client
 * (to animate the climb) and the server (to compute how long a round lasts
 * before it reaches the pre-drawn crash multiplier).
 */
export function multiplierAtTime(
  seconds: number,
  config: Pick<GameConfig, "growthK"> = DEFAULT_CONFIG,
): number {
  return Math.exp(config.growthK * seconds);
}

/**
 * Inverse of multiplierAtTime: elapsed time (seconds) at which the curve
 * reaches multiplier m. t = ln(m) / k.
 */
export function timeForMultiplier(
  multiplier: number,
  config: Pick<GameConfig, "growthK"> = DEFAULT_CONFIG,
): number {
  return Math.log(multiplier) / config.growthK;
}
