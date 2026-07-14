/** Default game parameters, per Math Specification §Summary. Operator-configurable. */
export interface GameConfig {
  /** Theoretical return-to-player, e.g. 0.97 for 97%. */
  rtp: number;
  /** Multiplier ceiling; reaching it force-settles as a win. */
  maxMultiplier: number;
  /** Growth constant k in m(t) = e^(k*t). Presentation only, no effect on odds. */
  growthK: number;
  minBetCents: number;
  maxBetCents: number;
}

export const DEFAULT_CONFIG: GameConfig = {
  rtp: 0.97,
  maxMultiplier: 1000,
  growthK: 0.15,
  minBetCents: 10,
  maxBetCents: 20_000,
};
