import { Application, Container, Graphics, RenderTexture, Sprite, Text } from "pixi.js";
import type { GameController } from "./GameController.js";
import { MILESTONES } from "./GameController.js";
import { PALETTE } from "./palette.js";

// ---- Logical (offscreen) resolution: one pixel grid for the whole scene. ----
// The scene is drawn once at RENDER_W x RENDER_H, then blitted to the real
// canvas (DISPLAY_W x DISPLAY_H, an exact integer multiple) through a single
// nearest-neighbor upscale, so every shape — background to bear — shares the
// same pixel grid instead of drifting in and out of alignment.
const RENDER_W = 320;
const RENDER_H = 220;
const DISPLAY_SCALE = 4;
const DISPLAY_W = RENDER_W * DISPLAY_SCALE;
const DISPLAY_H = RENDER_H * DISPLAY_SCALE;

const TREE_X = Math.round(RENDER_W * 0.44);
const TREE_WIDTH = 26;
const BEAR_Y = Math.round(RENDER_H * 0.4); // fixed screen position — the world scrolls, not the bear
const BEAR_OFFSET_X = TREE_WIDTH / 2 + 4;
const LADDER_X = RENDER_W - 24;
const SCROLL_PX = 500; // logical px of world scroll for the full 1x -> 1000x climb
const LOG_MAX = Math.log(1000);
const LADDER_TICKS = [1, 2, 5, 10, 20, 50, 100, 500, 1000];
const GROUND_OFFSET = 80; // vertical gap between the bear anchor and the ground at rest
const CLOUD_MULTIPLIER = 20; // clouds fade in above this multiplier

/**
 * Per-layer parallax scroll factors applied to a single camera value:
 *   layer.y = layerBaseY + cameraY * scrollFactor
 * layerBaseY is 0 for every layer — each layer's shapes are drawn using
 * their absolute resting-position (cameraY = 0, i.e. 1x) coordinates
 * directly. skyLayer and uiLayer never scroll.
 */
const SCROLL_FACTOR = {
  sky: 0,
  moon: 0.08,
  stars: 0.15,
  clouds: 0.2,
  farMountains: 0.25,
  nearMountains: 0.4,
  pines: 0.55,
  ground: 1.0,
  tree: 1.0,
} as const;

function heightOf(m: number): number {
  return Math.log(Math.max(m, 1)) / LOG_MAX;
}

/** Deterministic pseudo-random in [0, 1), for stable procedural background texture. */
function prand(i: number): number {
  const x = Math.sin(i * 127.1) * 43758.5453;
  return x - Math.floor(x);
}

function clamp01(t: number): number {
  return Math.max(0, Math.min(1, t));
}

interface Particle {
  container: Container;
  originX: number;
  originY: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  gravity: number;
  life: number;
  maxLife: number;
}

interface Star {
  gfx: Graphics;
  seed: number;
  revealAt: number; // heightOf() threshold at which this star fades in
}

interface Branch {
  container: Container;
  flashGfx: Graphics;
  multiplier: number;
  passed: boolean;
  flashAlpha: number;
}

/** Bear pixel-grid, mapped onto the locked palette (no colors outside it). */
const BEAR_PALETTE: Record<string, number> = {
  D: PALETTE.trunkDark,
  B: PALETTE.bearFur,
  L: PALETTE.trunkLight,
  T: PALETTE.bearSnout,
  K: PALETTE.outlineBlack,
  W: PALETTE.moonCore,
};
const BEAR_GRID = [
  "...DD......DD...",
  "..DBBD....DBBD..",
  "..DBBBD..DBBBD..",
  ".DBBBBBBBBBBBBD.",
  ".DBBBBBBBBBBBBD.",
  ".DBWKBBBBBBWKBD.",
  ".DBBBBTTTTBBBBD.",
  ".DBBTTTTTTTTBBD.",
  ".DBBTTTKKTTTBBD.",
  "..DBBTTTTTTBBD..",
  ".DBBBBBBBBBBBBD.",
  "DBBBBBBBBBBBBBBD",
  "DBBLLLLLLLLLLBBD",
  "DBBLLLLLLLLLLBBD",
  "DBBBBBBBBBBBBBBD",
  ".DBBBBD..DBBBBD.",
  ".DBBD......DBBD.",
  "..DD........DD..",
];
const BEAR_PIXEL = 1;

/**
 * Pixel-art scene (FR-12–FR-16): a bear climbing a central tree at night,
 * with a moon, parallax mountains and pines, log-spaced milestone branches,
 * a ladder rail, and crash/cash-out feedback. Everything is drawn once at
 * RENDER_W x RENDER_H and upscaled — see the module doc comment above.
 *
 * Layer architecture (back to front; see SCROLL_FACTOR above for parallax):
 *   skyLayer -> celestialLayer (moon, stars, clouds) -> farMountains
 *   -> nearMountains -> pineSilhouettes -> groundLayer
 *   -> treeLayer (trunk + branches) -> bearLayer -> fxLayer
 *   -> uiLayer (ladder + in-canvas HUD).
 * Layers never draw across each other; each owns exactly the shapes named
 * above. `shakeRoot` wraps every layer except uiLayer, so crash screen-shake
 * never jitters the ladder rail. uiLayer, bearLayer, and fxLayer are
 * screen-fixed (bearLayer only follows its own bob/fall/sway animation,
 * never the camera) — the world scrolls underneath them.
 */
export class Scene {
  readonly app = new Application();

  private sceneRenderTexture!: RenderTexture;
  private displaySprite!: Sprite;
  private readonly sceneRoot = new Container();

  private readonly shakeRoot = new Container();
  private readonly skyLayer = new Container();
  private readonly skyNightOverlay = new Graphics();
  private readonly celestialLayer = new Container();
  private readonly moonLayer = new Container();
  private readonly starsLayer = new Container();
  private readonly cloudsLayer = new Container();
  private readonly farMountains = new Container();
  private readonly nearMountains = new Container();
  private readonly pineSilhouettes = new Container();
  private readonly groundLayer = new Container();
  private readonly treeLayer = new Container();
  private readonly bearLayer = new Container();
  private readonly bearPaws = new Graphics();
  private readonly fxLayer = new Container();
  private readonly uiLayer = new Container();
  private readonly ladderFill = new Graphics();
  private readonly ladderMarker = new Graphics();
  private readonly branches: Branch[] = [];
  private readonly stars: Star[] = [];
  private readonly clouds: { gfx: Graphics; seed: number }[] = [];

  private particles: Particle[] = [];
  private lastFrameTs = performance.now();
  private shakeMagnitude = 0;
  private fallY = 0;
  private fallVy = 0;
  private fallRotation = 0;
  private lastState: string | undefined;
  private lastPawFrame = -1;

  constructor(private readonly controller: GameController) {}

  async init(parent: HTMLElement): Promise<void> {
    await this.app.init({
      width: DISPLAY_W,
      height: DISPLAY_H,
      backgroundColor: PALETTE.skyTop,
      antialias: false,
    });
    parent.appendChild(this.app.canvas);

    this.sceneRenderTexture = RenderTexture.create({ width: RENDER_W, height: RENDER_H });
    this.sceneRenderTexture.source.scaleMode = "nearest";
    this.displaySprite = new Sprite(this.sceneRenderTexture);
    this.displaySprite.width = DISPLAY_W;
    this.displaySprite.height = DISPLAY_H;

    const groundYAtRest = BEAR_Y + GROUND_OFFSET;

    this.drawSky();
    this.drawStars();
    this.drawClouds();
    this.drawMoon();
    this.drawMountainRange(this.farMountains, groundYAtRest - 6, 90, 5, 1, true);
    this.drawMountainRange(this.nearMountains, groundYAtRest + 2, 66, 4, 11, false);
    this.drawPines(groundYAtRest - 2);
    this.drawGround(groundYAtRest);
    this.drawTree();
    this.drawMilestoneBranches();
    this.drawLadder();
    this.drawBear();

    this.celestialLayer.addChild(this.moonLayer, this.starsLayer, this.cloudsLayer);
    this.shakeRoot.addChild(
      this.skyLayer,
      this.celestialLayer,
      this.farMountains,
      this.nearMountains,
      this.pineSilhouettes,
      this.groundLayer,
      this.treeLayer,
      this.bearLayer,
      this.fxLayer,
    );
    // uiLayer is a sibling of shakeRoot, not a child — crash shake must never move it.
    this.sceneRoot.addChild(this.shakeRoot, this.uiLayer);

    this.app.stage.addChild(this.displaySprite);
    this.app.ticker.add(() => this.frame());
  }

  // ---------------------------------------------------------------- sky ---

  private drawSky(): void {
    // Dithered gradient bands: discrete flat steps rather than a smooth
    // gradient, with a 2px checkerboard-dithered seam between each pair —
    // classic 8-bit sky banding instead of a modern smooth blend.
    const bands = [PALETTE.skyTop, PALETTE.skyMid, PALETTE.skyMid, PALETTE.skyHorizon];
    const bandH = RENDER_H / bands.length;
    for (let i = 0; i < bands.length; i++) {
      const color = bands[i];
      if (color === undefined) continue;
      const y = i * bandH;
      this.skyLayer.addChild(
        new Graphics().rect(-10, y - 10, RENDER_W + 20, bandH + 10).fill({ color }),
      );
      if (i > 0) {
        const prevColor = bands[i - 1];
        if (prevColor === undefined) continue;
        this.drawDitherSeam(this.skyLayer, y, prevColor, color);
      }
    }
    // Static overlay used to darken the whole sky as the bear climbs higher.
    this.skyNightOverlay
      .rect(-10, -10, RENDER_W + 20, RENDER_H + 20)
      .fill({ color: PALETTE.outlineBlack });
    this.skyNightOverlay.alpha = 0;
    this.skyLayer.addChild(this.skyNightOverlay);
  }

  private drawDitherSeam(layer: Container, y: number, colorA: number, colorB: number): void {
    // One Graphics instance for the whole seam (chained rect/fill calls) —
    // not one per checker square, which would mean hundreds of extra
    // display objects for a purely cosmetic dither line.
    const step = 4;
    const gfx = new Graphics();
    for (let x = 0; x < RENDER_W; x += step) {
      const checker = (Math.round(x / step) % 2) === 0;
      gfx.rect(x, y - step / 2, step, step).fill({ color: checker ? colorA : colorB });
    }
    layer.addChild(gfx);
  }

  private drawStars(): void {
    for (let i = 0; i < 90; i++) {
      const gfx = new Graphics().rect(0, 0, 1, 1).fill({ color: PALETTE.starWhite });
      gfx.x = Math.round(prand(i) * RENDER_W);
      gfx.y = Math.round(prand(i + 500) * RENDER_H);
      this.starsLayer.addChild(gfx);
      // Roughly a third of stars are always out; the rest reveal progressively
      // higher in the climb, so star density visibly increases with height.
      const revealAt = i % 3 === 0 ? 0 : prand(i + 1300);
      this.stars.push({ gfx, seed: i, revealAt });
    }
  }

  private drawClouds(): void {
    for (let i = 0; i < 4; i++) {
      const gfx = new Graphics();
      const puffs = 3 + Math.floor(prand(i + 700) * 2);
      for (let p = 0; p < puffs; p++) {
        const ox = p * 6 - (puffs * 6) / 2;
        gfx.ellipse(ox, 0, 7, 3).fill({ color: PALETTE.starWhite, alpha: 0.5 });
      }
      gfx.x = Math.round(prand(i + 900) * RENDER_W);
      gfx.y = 18 + Math.round(prand(i + 950) * 20);
      gfx.alpha = 0;
      this.cloudsLayer.addChild(gfx);
      this.clouds.push({ gfx, seed: i });
    }
  }

  private drawMoon(): void {
    const cx = 34;
    const cy = 28;
    const halo = new Graphics()
      .circle(cx, cy, 20)
      .fill({ color: PALETTE.moonGlow, alpha: 0.18 })
      .circle(cx, cy, 15)
      .fill({ color: PALETTE.moonGlow, alpha: 0.22 });
    const moon = new Graphics()
      .circle(cx, cy, 11)
      .fill({ color: PALETTE.moonCore })
      .circle(cx - 4, cy - 3, 2.4)
      .fill({ color: PALETTE.moonShade })
      .circle(cx + 3, cy + 4, 1.6)
      .fill({ color: PALETTE.moonShade });
    this.moonLayer.addChild(halo, moon);
  }

  // ---------------------------------------------------------- mountains ---

  /**
   * Draws a jagged mountain silhouette with a stepped shade band (a lighter
   * "foothill" band below the dark peaks), in absolute (cameraY = 0)
   * screen coordinates. The far range is hazed via reduced layer alpha.
   */
  private drawMountainRange(
    layer: Container,
    baseY: number,
    peakHeight: number,
    segments: number,
    seedOffset: number,
    hazed: boolean,
  ): void {
    const valleyY = baseY - peakHeight * 0.4;
    const points: number[] = [-10, RENDER_H + 10];
    for (let i = 0; i <= segments; i++) {
      const x = (i / segments) * RENDER_W;
      const peak = baseY - peakHeight * (0.5 + 0.5 * prand(i * 7 + seedOffset));
      points.push(x - RENDER_W / segments / 2, peak, x, valleyY);
    }
    points.push(RENDER_W + 10, RENDER_H + 10);
    layer.addChild(new Graphics().poly(points).fill({ color: PALETTE.mtnDark }));
    // Stepped shade band: a lighter flat foothill strip beneath the valley line.
    layer.addChild(
      new Graphics().rect(-10, valleyY, RENDER_W + 20, peakHeight * 0.5).fill({ color: PALETTE.mtnLight }),
    );
    layer.alpha = hazed ? 0.6 : 1;
  }

  private drawPines(baseY: number): void {
    for (let i = 0; i < 16; i++) {
      const x = Math.round(prand(i + 40) * RENDER_W);
      const h = 14 + Math.round(prand(i + 80) * 12);
      const yb = Math.round(baseY - prand(i + 120) * 10);
      const gfx = new Graphics();
      // 3 stacked tiers, alternating shades, narrowing toward the top.
      const tiers = [
        { w: h * 0.42, yTop: yb - h, yBase: yb - h * 0.35, color: PALETTE.pineDark },
        { w: h * 0.34, yTop: yb - h * 0.7, yBase: yb - h * 0.15, color: PALETTE.pineLight },
        { w: h * 0.24, yTop: yb - h * 0.45, yBase: yb, color: PALETTE.pineDark },
      ];
      for (const t of tiers) {
        gfx.poly([x, t.yTop, x - t.w, t.yBase, x + t.w, t.yBase]).fill({ color: t.color });
      }
      this.pineSilhouettes.addChild(gfx);
    }
  }

  private drawGround(groundYAtRest: number): void {
    const ground = new Graphics()
      .rect(-10, groundYAtRest, RENDER_W + 20, 700)
      .fill({ color: PALETTE.ground })
      .rect(-10, groundYAtRest, RENDER_W + 20, 3)
      .fill({ color: PALETTE.groundEdge });
    this.groundLayer.addChild(ground);

    const decorations = [
      { x: RENDER_W * 0.18, mushroom: true },
      { x: RENDER_W * 0.28, mushroom: false },
      { x: RENDER_W * 0.72, mushroom: true },
      { x: RENDER_W * 0.84, mushroom: false },
      { x: RENDER_W * 0.92, mushroom: true },
    ];
    for (const d of decorations) {
      const gfx = new Graphics();
      if (d.mushroom) {
        gfx.rect(-1, 0, 2, 3).fill({ color: PALETTE.bearSnout });
        gfx.ellipse(0, -1, 3.5, 2.2).fill({ color: PALETTE.red });
        gfx.rect(-1.2, -1.6, 1, 1).fill({ color: PALETTE.moonCore });
        gfx.rect(1, -0.6, 0.8, 0.8).fill({ color: PALETTE.moonCore });
      } else {
        gfx.ellipse(0, 0, 4.5, 2.6).fill({ color: PALETTE.gray });
      }
      gfx.x = Math.round(d.x);
      gfx.y = groundYAtRest + 2;
      this.groundLayer.addChild(gfx);
    }
  }

  // -------------------------------------------------------------- tree ---

  private drawTree(): void {
    // Tall enough to stay fully on-screen across the whole climb: treeLayer
    // scrolls at factor 1.0 (up to SCROLL_PX of travel), so the trunk must
    // extend well past the canvas on both ends rather than just its height.
    const top = -(SCROLL_PX + 40);
    const span = SCROLL_PX + RENDER_H + 80;
    const left = TREE_X - TREE_WIDTH / 2;

    const trunk = new Graphics().rect(left, top, TREE_WIDTH, span).fill({ color: PALETTE.trunkMid });
    // Light/dark edge strips — gives the trunk a rounded, cylindrical read.
    const edges = new Graphics()
      .rect(left, top, 3, span)
      .fill({ color: PALETTE.trunkDark })
      .rect(left + TREE_WIDTH - 3, top, 3, span)
      .fill({ color: PALETTE.trunkLight });
    // Vertical bark-grain shade bands, tiled the length of the trunk.
    const bands = new Graphics();
    const bandOffsets = [0.32, 0.55, 0.75];
    for (const f of bandOffsets) {
      bands.rect(left + TREE_WIDTH * f, top, 1.5, span).fill({ color: PALETTE.trunkDark, alpha: 0.55 });
    }
    // Random knots scattered along the whole climbable length.
    const knots = new Graphics();
    for (let i = 0; i < 18; i++) {
      const kx = left + 4 + prand(i + 200) * (TREE_WIDTH - 8);
      const ky = top + prand(i + 260) * span;
      knots.ellipse(kx, ky, 2.2, 1.6).fill({ color: PALETTE.trunkDark, alpha: 0.8 });
    }
    this.treeLayer.addChild(trunk, bands, edges, knots);
  }

  private drawMilestoneBranches(): void {
    for (let i = 0; i < MILESTONES.length; i++) {
      const mm = MILESTONES[i];
      if (mm === undefined) continue;
      const side = i % 2 === 0 ? 1 : -1;
      const container = new Container();

      const plankLen = 14;
      const branch = new Graphics()
        .rect(side === 1 ? 0 : -plankLen, -1.5, plankLen, 3)
        .fill({ color: PALETTE.trunkMid });

      // 2-3 stacked leaf clusters in two greens.
      const leaves = new Graphics();
      const clusters = [
        { dx: side === 1 ? 8 : -8, dy: -6, r: 5, color: PALETTE.leafDark },
        { dx: side === 1 ? 13 : -13, dy: -3, r: 4, color: PALETTE.leafLight },
        { dx: side === 1 ? 10 : -10, dy: -1, r: 3.4, color: PALETTE.leafDark },
      ];
      for (const c of clusters) {
        leaves.circle(c.dx, c.dy, c.r).fill({ color: c.color });
      }

      const label = new Text({
        text: `${mm}x`,
        style: { fontFamily: "monospace", fontSize: 5, fill: PALETTE.gold },
      });
      label.x = side === 1 ? 20 : -20 - label.width;
      label.y = -3;

      const flashGfx = new Graphics().circle(side === 1 ? 10 : -10, -4, 9).fill({ color: PALETTE.starWhite });
      flashGfx.alpha = 0;

      container.addChild(branch, leaves, flashGfx, label);
      // Fixed local position (this branch's resting position at 1x, anchored
      // to the trunk itself — not the screen edge); treeLayer's own per-frame
      // scroll carries it at the correct rate.
      container.x = TREE_X;
      container.y = BEAR_Y - heightOf(mm) * SCROLL_PX;
      this.treeLayer.addChild(container);
      this.branches.push({ container, flashGfx, multiplier: mm, passed: false, flashAlpha: 0 });
    }
  }

  // ------------------------------------------------------------ ladder ---

  private drawLadder(): void {
    const top = 14;
    const bottom = RENDER_H - 14;
    this.uiLayer.addChild(this.ladderFill);
    const rail = new Graphics().rect(LADDER_X - 1, top, 2, bottom - top).fill({ color: PALETTE.gold });
    this.uiLayer.addChild(rail);

    for (const mm of LADDER_TICKS) {
      const f = heightOf(mm);
      const y = bottom - f * (bottom - top);
      const tick = new Graphics()
        .rect(LADDER_X - 3, y - 0.5, 6, 1)
        .fill({ color: PALETTE.outlineBlack, alpha: 0.6 });
      const label = new Text({
        text: `${mm}x`,
        style: {
          fontFamily: "monospace",
          fontSize: 4,
          fill: mm >= 10 ? PALETTE.leafLight : mm >= 2 ? PALETTE.gold : PALETTE.red,
        },
      });
      label.x = LADDER_X + 4;
      label.y = y - 2;
      this.uiLayer.addChild(tick, label);
    }

    this.uiLayer.addChild(this.ladderMarker);
  }

  // -------------------------------------------------------------- bear ---

  private drawBear(): void {
    const body = new Graphics();
    const w = BEAR_GRID[0]?.length ?? 0;
    const h = BEAR_GRID.length;
    for (let r = 0; r < h; r++) {
      const row = BEAR_GRID[r];
      if (!row) continue;
      for (let c = 0; c < row.length; c++) {
        const ch = row[c];
        if (!ch || ch === ".") continue;
        const color = BEAR_PALETTE[ch];
        if (color === undefined) continue;
        body
          .rect(
            -(w * BEAR_PIXEL) / 2 + c * BEAR_PIXEL,
            -(h * BEAR_PIXEL) / 2 + r * BEAR_PIXEL,
            BEAR_PIXEL,
            BEAR_PIXEL,
          )
          .fill({ color });
      }
    }
    this.bearLayer.addChild(this.bearPaws, body);
    this.redrawPaws(true);

    // Resting screen position — the world scrolls underneath, the bear
    // never scrolls with the camera (only sways with the trunk in frame()).
    this.bearLayer.x = TREE_X + BEAR_OFFSET_X;
    this.bearLayer.y = BEAR_Y;
  }

  private redrawPaws(up: boolean): void {
    const w = (BEAR_GRID[0]?.length ?? 0) * BEAR_PIXEL;
    const h = BEAR_GRID.length * BEAR_PIXEL;
    this.bearPaws.clear();
    const y1 = up ? -h / 2 + 2 : -h / 2 + 7;
    const y2 = up ? -h / 2 + 11 : -h / 2 + 6;
    this.bearPaws
      .rect(-w / 2 - 4.5, y1, 4.5, 3.2)
      .fill({ color: PALETTE.bearFur })
      .stroke({ color: PALETTE.outlineBlack, width: 0.6 })
      .rect(-w / 2 - 4.5, y2, 4.5, 3.2)
      .fill({ color: PALETTE.bearFur })
      .stroke({ color: PALETTE.outlineBlack, width: 0.6 });
  }

  // ------------------------------------------------------------- fx ------

  private spawnCoins(): void {
    for (let i = 0; i < 16; i++) {
      this.spawnParticle(this.bearLayer.x, this.bearLayer.y, PALETTE.gold, {
        vx: (Math.random() - 0.5) * 120,
        vy: -(50 + Math.random() * 110),
        gravity: 200,
        life: 0.9 + Math.random() * 0.4,
      });
    }
  }

  private spawnLeafBurst(x: number, y: number): void {
    for (let i = 0; i < 8; i++) {
      this.spawnParticle(x, y, i % 2 === 0 ? PALETTE.leafLight : PALETTE.leafDark, {
        vx: (Math.random() - 0.5) * 70,
        vy: -(20 + Math.random() * 50),
        gravity: 130,
        life: 0.5 + Math.random() * 0.4,
      });
    }
  }

  private spawnParticle(
    x: number,
    y: number,
    color: number,
    opts: { vx: number; vy: number; gravity: number; life: number },
  ): void {
    const size = color === PALETTE.gold ? 2 : 1.4;
    const g = new Graphics().rect(-size / 2, -size / 2, size, size).fill({ color });
    const container = new Container();
    container.addChild(g);
    container.x = x;
    container.y = y;
    this.fxLayer.addChild(container);
    this.particles.push({
      container,
      originX: x,
      originY: y,
      x: 0,
      y: 0,
      vx: opts.vx,
      vy: opts.vy,
      gravity: opts.gravity,
      life: opts.life,
      maxLife: opts.life,
    });
  }

  // ------------------------------------------------------------ frame ----

  private frame(): void {
    const now = performance.now();
    const dt = Math.min((now - this.lastFrameTs) / 1000, 0.05);
    this.lastFrameTs = now;

    this.controller.tick(Date.now());
    const snap = this.controller.getSnapshot();

    if (snap.state !== this.lastState) {
      if (snap.state === "CASHED") this.spawnCoins();
      if (snap.state === "CRASHED") {
        this.shakeMagnitude = 1;
        this.fallY = 0;
        this.fallVy = -30;
        this.fallRotation = 0;
      }
      if (snap.state === "CLIMBING") {
        for (const b of this.branches) {
          b.passed = false;
          b.flashAlpha = 0;
        }
      }
      if (snap.state === "IDLE") {
        this.fallY = 0;
        this.fallVy = 0;
        this.fallRotation = 0;
        this.shakeMagnitude = 0;
      }
      this.lastState = snap.state;
    }

    const displayMultiplier =
      snap.state === "CASHED" && snap.cashResult ? snap.cashResult.x : snap.currentMultiplier;
    const heightT = heightOf(displayMultiplier);
    const cameraY = heightT * SCROLL_PX;

    // One camera value, per-layer factors — see SCROLL_FACTOR docs above.
    this.moonLayer.y = Math.round(cameraY * SCROLL_FACTOR.moon);
    this.starsLayer.y = Math.round(cameraY * SCROLL_FACTOR.stars);
    this.cloudsLayer.y = Math.round(cameraY * SCROLL_FACTOR.clouds);
    this.farMountains.y = Math.round(cameraY * SCROLL_FACTOR.farMountains);
    this.nearMountains.y = Math.round(cameraY * SCROLL_FACTOR.nearMountains);
    this.pineSilhouettes.y = Math.round(cameraY * SCROLL_FACTOR.pines);
    this.groundLayer.y = Math.round(cameraY * SCROLL_FACTOR.ground);

    // Trunk sway: subtle wind sway that grows with height (log scale, so it
    // stays gentle for most of the climb and only becomes pronounced near
    // the ceiling). The bear rides along with it, staying visually attached.
    const swayAmplitude = 1.6 * heightT;
    const sway = Math.sin(now / 900) * swayAmplitude;
    this.treeLayer.x = Math.round(sway);
    this.treeLayer.y = Math.round(cameraY * SCROLL_FACTOR.tree);

    // Height ambiance: sky darkens and star density increases with altitude.
    this.skyNightOverlay.alpha = heightT * 0.55;
    for (const star of this.stars) {
      const twinkle = 0.5 + 0.5 * Math.sin(now / 400 + star.seed);
      const revealed = heightT >= star.revealAt;
      star.gfx.alpha = revealed ? 0.3 + 0.6 * twinkle * prand(star.seed + 900) : 0;
    }
    const cloudT = clamp01((displayMultiplier - CLOUD_MULTIPLIER) / (CLOUD_MULTIPLIER * 2));
    for (const cloud of this.clouds) {
      cloud.gfx.alpha = cloudT * (0.5 + 0.5 * prand(cloud.seed + 40));
    }

    for (const branch of this.branches) {
      const sy = this.treeLayer.y + branch.container.y;
      branch.container.visible = sy > -30 && sy < RENDER_H + 30;

      if (snap.state === "CLIMBING" && !branch.passed && displayMultiplier >= branch.multiplier) {
        branch.passed = true;
        branch.flashAlpha = 0.9;
        const worldX = this.treeLayer.x + branch.container.x;
        const worldY = this.treeLayer.y + branch.container.y;
        this.spawnLeafBurst(worldX, worldY);
      }
      if (branch.flashAlpha > 0) {
        branch.flashAlpha = Math.max(0, branch.flashAlpha - dt * 2.2);
        branch.flashGfx.alpha = branch.flashAlpha;
      }
    }

    // Ladder fill (progress bar up to the current position) + marker.
    const ladderTop = 14;
    const ladderBottom = RENDER_H - 14;
    const f = heightOf(displayMultiplier);
    const markerY = ladderBottom - f * (ladderBottom - ladderTop);
    this.ladderFill
      .clear()
      .rect(LADDER_X - 1, markerY, 2, ladderBottom - markerY)
      .fill({ color: PALETTE.gold, alpha: 0.45 });
    this.ladderMarker
      .clear()
      .poly([LADDER_X - 6, markerY, LADDER_X - 1.5, markerY - 3, LADDER_X - 1.5, markerY + 3])
      .fill({ color: PALETTE.starWhite });

    if (snap.state === "CRASHED") {
      const isInstant = snap.crashResult?.crash === 1;
      if (!isInstant) {
        this.fallVy += 320 * dt;
        this.fallY += this.fallVy * dt;
        this.fallRotation += 5 * dt;
      }
      this.shakeMagnitude = Math.max(0, this.shakeMagnitude - 0.5 * dt);
    }

    if (snap.state === "CLIMBING") {
      const pawFrame = Math.floor(now / 220) % 2;
      if (pawFrame !== this.lastPawFrame) {
        this.lastPawFrame = pawFrame;
        this.redrawPaws(pawFrame === 0);
      }
    }

    this.bearLayer.x = Math.round(TREE_X + BEAR_OFFSET_X + sway);
    this.bearLayer.y = Math.round(
      BEAR_Y + this.fallY + (snap.state === "CLIMBING" ? Math.sin(now / 110) * 0.8 : 0),
    );
    this.bearLayer.rotation = this.fallRotation;

    // Crash screen-shake: applied to shakeRoot only, so uiLayer (ladder/HUD) never moves.
    const shakeX = this.shakeMagnitude > 0 ? (Math.random() - 0.5) * this.shakeMagnitude * 5 : 0;
    const shakeY = this.shakeMagnitude > 0 ? (Math.random() - 0.5) * this.shakeMagnitude * 3 : 0;
    this.shakeRoot.x = Math.round(shakeX);
    this.shakeRoot.y = Math.round(shakeY);

    for (const p of this.particles) {
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      p.container.x = p.originX + p.x;
      p.container.y = p.originY + p.y;
      p.container.alpha = Math.max(0, p.life / p.maxLife);
    }
    for (const p of this.particles.filter((p) => p.life <= 0)) {
      this.fxLayer.removeChild(p.container);
      p.container.destroy();
    }
    this.particles = this.particles.filter((p) => p.life > 0);

    // Render the whole (detached) scene into the small offscreen target, then
    // Pixi's normal stage render draws displaySprite (showing that texture)
    // upscaled to the real canvas — the one nearest-neighbor blit for everything.
    this.app.renderer.render({ container: this.sceneRoot, target: this.sceneRenderTexture });
  }
}
