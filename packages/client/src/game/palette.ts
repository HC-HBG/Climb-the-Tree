/**
 * Locked 24-color palette derived from the key art (night sky, gold/orange
 * logo lettering, warm wood tones, forest greens). Every fill in Scene.ts
 * pulls from this set — no ad hoc hex literals — so the whole scene reads
 * as one consistent 8-bit palette.
 */
export const PALETTE = {
  skyTop: 0x0d0a24,
  skyMid: 0x2b1e4e,
  skyHorizon: 0x6b3f6e,
  starWhite: 0xe8e6ff,
  moonCore: 0xf3e7c0,
  moonShade: 0xd8c48f,
  moonGlow: 0x8a6fae,
  mtnLight: 0x4a3577,
  mtnDark: 0x2c2154,
  pineLight: 0x1c3818,
  pineDark: 0x102410,
  ground: 0x1e3317,
  groundEdge: 0x2a4520,
  trunkLight: 0x7a4f2c,
  trunkMid: 0x5d3a1e,
  trunkDark: 0x3a2413,
  leafLight: 0x3f8f37,
  leafDark: 0x1f5b1c,
  bearFur: 0x7a4a21,
  bearSnout: 0xd9b380,
  gold: 0xffd23f,
  red: 0xd44f3e,
  gray: 0x4a5a48,
  outlineBlack: 0x140f0a,
} as const;

export type PaletteColor = keyof typeof PALETTE;
