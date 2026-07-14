import { Application, Container, FillGradient, Graphics, Text } from "pixi.js";
import type { GameController } from "./GameController.js";
import { MILESTONES } from "./GameController.js";

const WIDTH = 880;
const HEIGHT = 620;
const TREE_X = WIDTH * 0.44;
const TREE_WIDTH = 74;
const BEAR_Y = HEIGHT * 0.4;
const LADDER_X = WIDTH - 64;
const SCROLL_PX = 1400; // px for the full 1x -> 1000x climb
const LOG_MAX = Math.log(1000);
const LADDER_TICKS = [1, 2, 5, 10, 20, 50, 100, 500, 1000];
const GROUND_OFFSET = 220; // vertical gap between the bear anchor and the ground at rest

function heightOf(m: number): number {
  return Math.log(Math.max(m, 1)) / LOG_MAX;
}

/** Deterministic pseudo-random in [0, 1), for stable procedural background texture. */
function prand(i: number): number {
  const x = Math.sin(i * 127.1) * 43758.5453;
  return x - Math.floor(x);
}

interface Particle {
  container: Container;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
}

interface Star {
  gfx: Graphics;
  seed: number;
}

/** Bear pixel-grid + palette, adapted from the concept prototype. */
const BEAR_PALETTE: Record<string, number> = {
  D: 0x3a2314,
  B: 0x7a4a21,
  L: 0xa06a35,
  T: 0xd9b380,
  K: 0x14100a,
  W: 0xf5f0e0,
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
const BEAR_PIXEL = 3;

/**
 * Placeholder pixel-art scene (FR-12–FR-16): a bear climbing a central tree
 * at night, with a moon, parallax mountains and pines, log-spaced milestone
 * branches, a ladder rail, and crash/cash-out feedback. Final sprites come
 * later — this is plain Pixi Graphics, styled to match the concept mockup.
 */
export class Scene {
  readonly app = new Application();

  private readonly world = new Container();
  private readonly starsLayer = new Container();
  private readonly moonLayer = new Container();
  private readonly mountainsFar = new Container();
  private readonly mountainsNear = new Container();
  private readonly pinesLayer = new Container();
  private readonly groundLayer = new Container();
  private readonly branchLayer = new Container();
  private readonly bear = new Container();
  private readonly bearPaws = new Graphics();
  private readonly ladderMarker = new Graphics();
  private readonly particleLayer = new Container();
  private readonly branches: { container: Container; multiplier: number }[] = [];
  private readonly stars: Star[] = [];

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
      width: WIDTH,
      height: HEIGHT,
      backgroundColor: 0x141033,
      antialias: true,
    });
    parent.appendChild(this.app.canvas);

    this.drawSky();
    this.drawStars();
    this.drawMoon();
    const groundYAtRest = BEAR_Y + GROUND_OFFSET;
    this.drawMountainRange(this.mountainsFar, groundYAtRest - 10, 300, 5, 0x2e2258, 1);
    this.drawMountainRange(this.mountainsNear, groundYAtRest + 4, 220, 4, 0x3d2d72, 11);
    this.drawPines();
    this.drawGround();
    this.drawTree();
    this.drawMilestoneBranches();
    this.drawLadder();
    this.drawBear();

    this.world.addChild(
      this.starsLayer,
      this.moonLayer,
      this.mountainsFar,
      this.mountainsNear,
      this.pinesLayer,
      this.groundLayer,
      this.particleLayer,
    );
    this.app.stage.addChild(this.world);

    this.app.ticker.add(() => this.frame());
  }

  private drawSky(): void {
    const gradient = new FillGradient({
      type: "linear",
      start: { x: 0, y: 0 },
      end: { x: 0, y: 1 },
    });
    gradient.addColorStop(0, "#141033");
    gradient.addColorStop(0.55, "#2b1e4e");
    gradient.addColorStop(0.85, "#4a2a5e");
    gradient.addColorStop(1, "#5e3366");
    const sky = new Graphics().rect(-20, -20, WIDTH + 40, HEIGHT + 40).fill(gradient);
    this.world.addChildAt(sky, 0);
  }

  private drawStars(): void {
    for (let i = 0; i < 70; i++) {
      const gfx = new Graphics().rect(-1.25, -1.25, 2.5, 2.5).fill({ color: 0xe8e6ff });
      gfx.x = prand(i) * WIDTH;
      this.starsLayer.addChild(gfx);
      this.stars.push({ gfx, seed: i });
    }
  }

  private drawMoon(): void {
    const moon = new Graphics()
      .circle(110, 90, 42)
      .fill({ color: 0xf0e2b8 })
      .circle(96, 82, 9)
      .fill({ color: 0xd9c795 })
      .circle(122, 102, 6)
      .fill({ color: 0xd9c795 });
    this.moonLayer.addChild(moon);
  }

  /** Draws a jagged mountain silhouette once; vertical parallax is applied via container.y per frame. */
  private drawMountainRange(
    layer: Container,
    baseY: number,
    peakHeight: number,
    segments: number,
    color: number,
    seedOffset: number,
  ): void {
    const gfx = new Graphics();
    const points: number[] = [-20, HEIGHT + 20];
    for (let i = 0; i <= segments; i++) {
      const x = (i / segments) * WIDTH;
      const peak = baseY - peakHeight * (0.5 + 0.5 * prand(i * 7 + seedOffset));
      points.push(x - WIDTH / segments / 2, peak, x, baseY - peakHeight * 0.4);
    }
    points.push(WIDTH + 20, HEIGHT + 20);
    gfx.poly(points).fill({ color });
    layer.addChild(gfx);
  }

  private drawPines(): void {
    const base = BEAR_Y + GROUND_OFFSET - 6;
    for (let i = 0; i < 14; i++) {
      const x = prand(i + 40) * WIDTH;
      const h = 60 + prand(i + 80) * 90;
      const yb = base - prand(i + 120) * 40;
      const gfx = new Graphics()
        .poly([x, yb - h, x - h * 0.38, yb, x + h * 0.38, yb])
        .fill({ color: 0x12240f });
      this.pinesLayer.addChild(gfx);
    }
  }

  private drawGround(): void {
    const ground = new Graphics()
      .rect(-20, 0, WIDTH + 40, 2000)
      .fill({ color: 0x1e3317 })
      .rect(-20, 0, WIDTH + 40, 10)
      .fill({ color: 0x2a4520 });
    this.groundLayer.addChild(ground);

    // A little foreground charm to match the mockup: mushrooms and rocks.
    const decorations = [
      { x: WIDTH * 0.18, mushroom: true },
      { x: WIDTH * 0.28, mushroom: false },
      { x: WIDTH * 0.72, mushroom: true },
      { x: WIDTH * 0.84, mushroom: false },
      { x: WIDTH * 0.92, mushroom: true },
    ];
    for (const d of decorations) {
      const gfx = new Graphics();
      if (d.mushroom) {
        gfx.rect(-2, 0, 4, 8).fill({ color: 0xe8e0c8 });
        gfx.ellipse(0, -2, 9, 6).fill({ color: 0xd44f3e });
        gfx.circle(-3, -3, 1.4).fill({ color: 0xf5efe0 });
        gfx.circle(3, -1, 1.2).fill({ color: 0xf5efe0 });
      } else {
        gfx.ellipse(0, 0, 12, 7).fill({ color: 0x4a5a48 });
      }
      gfx.x = d.x;
      gfx.y = 4;
      this.groundLayer.addChild(gfx);
    }
  }

  private drawTree(): void {
    const trunk = new Graphics()
      .rect(TREE_X - TREE_WIDTH / 2, -40, TREE_WIDTH, HEIGHT + 80)
      .fill({ color: 0x5d3a1e });
    const bark = new Graphics()
      .rect(TREE_X - TREE_WIDTH / 2, -40, 7, HEIGHT + 80)
      .fill({ color: 0x6e4626 })
      .rect(TREE_X + TREE_WIDTH / 2 - 7, -40, 7, HEIGHT + 80)
      .fill({ color: 0x3a2413 });
    this.world.addChild(trunk, bark);
  }

  private drawMilestoneBranches(): void {
    for (let i = 0; i < MILESTONES.length; i++) {
      const mm = MILESTONES[i];
      if (mm === undefined) continue;
      const side = i % 2 === 0 ? 1 : -1;
      const container = new Container();

      const branch = new Graphics()
        .rect(side === 1 ? 0 : -46, -4, 46, 9)
        .fill({ color: 0x5d3a1e });
      const leaves = new Graphics()
        .rect(side === 1 ? 14 : -60, -18, 32, 16)
        .fill({ color: 0x2f6b2a })
        .rect(side === 1 ? 20 : -50, -24, 20, 10)
        .fill({ color: 0x3f8f37 });
      const label = new Text({
        text: `${mm}x`,
        style: { fontFamily: "monospace", fontSize: 14, fill: 0xffd75e },
      });
      label.x = side === 1 ? 60 : -60 - label.width;
      label.y = -6;

      container.addChild(branch, leaves, label);
      this.branchLayer.addChild(container);
      this.branches.push({ container, multiplier: mm });
    }
    this.world.addChild(this.branchLayer);
  }

  private drawLadder(): void {
    const top = 40;
    const bottom = HEIGHT - 40;
    const rail = new Graphics().rect(LADDER_X - 3, top, 6, bottom - top).fill({ color: 0xffd23f });
    this.world.addChild(rail);

    for (const mm of LADDER_TICKS) {
      const f = heightOf(mm);
      const y = bottom - f * (bottom - top);
      const tick = new Graphics().rect(LADDER_X - 8, y - 1, 16, 3).fill({ color: 0x000000, alpha: 0.5 });
      const label = new Text({
        text: `${mm}x`,
        style: {
          fontFamily: "monospace",
          fontSize: 11,
          fill: mm >= 10 ? 0x8fe08a : mm >= 2 ? 0xffd75e : 0xff9c94,
        },
      });
      label.x = LADDER_X + 12;
      label.y = y - 6;
      this.world.addChild(tick, label);
    }

    this.world.addChild(this.ladderMarker);
  }

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
          .rect(-(w * BEAR_PIXEL) / 2 + c * BEAR_PIXEL, -(h * BEAR_PIXEL) / 2 + r * BEAR_PIXEL, BEAR_PIXEL + 0.5, BEAR_PIXEL + 0.5)
          .fill({ color });
      }
    }
    this.bear.addChild(this.bearPaws, body);
    this.redrawPaws(true);

    this.bear.x = TREE_X + 46;
    this.bear.y = BEAR_Y;
    this.world.addChild(this.bear);
  }

  private redrawPaws(up: boolean): void {
    const w = (BEAR_GRID[0]?.length ?? 0) * BEAR_PIXEL;
    const h = BEAR_GRID.length * BEAR_PIXEL;
    this.bearPaws.clear();
    const y1 = up ? -h / 2 + 6 : -h / 2 + 22;
    const y2 = up ? -h / 2 + 34 : -h / 2 + 18;
    this.bearPaws
      .rect(-w / 2 - 14, y1, 14, 10)
      .fill({ color: 0x7a4a21 })
      .stroke({ color: 0x3a2314, width: 2 })
      .rect(-w / 2 - 14, y2, 14, 10)
      .fill({ color: 0x7a4a21 })
      .stroke({ color: 0x3a2314, width: 2 });
  }

  private spawnCoins(): void {
    for (let i = 0; i < 20; i++) {
      const g = new Graphics().rect(-5, -5, 10, 10).fill({ color: 0xffd23f });
      const container = new Container();
      container.addChild(g);
      container.x = this.bear.x;
      container.y = this.bear.y;
      this.particleLayer.addChild(container);
      this.particles.push({
        container,
        x: 0,
        y: 0,
        vx: (Math.random() - 0.5) * 380,
        vy: -(150 + Math.random() * 330),
        life: 1.1 + Math.random() * 0.5,
        maxLife: 1.1 + Math.random() * 0.5,
      });
    }
  }

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
        this.fallVy = -80;
        this.fallRotation = 0;
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
    const camH = heightOf(displayMultiplier) * SCROLL_PX;

    // Parallax background layers (coefficients derived from the concept prototype).
    for (const star of this.stars) {
      let sy = (prand(star.seed + 500) * HEIGHT * 3 - camH * 0.15) % (HEIGHT * 1.2);
      if (sy < 0) sy += HEIGHT * 1.2;
      star.gfx.y = sy - 20;
      const twinkle = 0.5 + 0.5 * Math.sin(now / 400 + star.seed);
      star.gfx.alpha = 0.3 + 0.6 * twinkle * prand(star.seed + 900);
    }
    this.moonLayer.y = -camH * 0.05;
    this.mountainsFar.y = camH * 0.042;
    this.mountainsNear.y = camH * 0.06;
    this.pinesLayer.y = camH * 0.1375;
    this.groundLayer.y = BEAR_Y + camH + GROUND_OFFSET;

    for (const branch of this.branches) {
      const wy = heightOf(branch.multiplier) * SCROLL_PX;
      const sy = BEAR_Y + (camH - wy);
      branch.container.y = sy;
      branch.container.visible = sy > -60 && sy < HEIGHT + 60;
    }

    const ladderTop = 40;
    const ladderBottom = HEIGHT - 40;
    const f = heightOf(displayMultiplier);
    const markerY = ladderBottom - f * (ladderBottom - ladderTop);
    this.ladderMarker
      .clear()
      .poly([LADDER_X - 14, markerY, LADDER_X - 4, markerY - 6, LADDER_X - 4, markerY + 6])
      .fill({ color: 0xffffff });

    if (snap.state === "CRASHED") {
      const isInstant = snap.crashResult?.crash === 1;
      if (!isInstant) {
        this.fallVy += 900 * dt;
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

    this.bear.y = BEAR_Y + this.fallY + (snap.state === "CLIMBING" ? Math.sin(now / 110) * 2 : 0);
    this.bear.rotation = this.fallRotation;

    const shakeX = this.shakeMagnitude > 0 ? (Math.random() - 0.5) * this.shakeMagnitude * 14 : 0;
    const shakeY = this.shakeMagnitude > 0 ? (Math.random() - 0.5) * this.shakeMagnitude * 8 : 0;
    this.world.x = shakeX;
    this.world.y = shakeY;

    for (const p of this.particles) {
      p.vy += 600 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      p.container.x = this.bear.x + p.x;
      p.container.y = this.bear.y + p.y;
      p.container.alpha = Math.max(0, p.life / p.maxLife);
    }
    for (const p of this.particles.filter((p) => p.life <= 0)) {
      this.particleLayer.removeChild(p.container);
      p.container.destroy();
    }
    this.particles = this.particles.filter((p) => p.life > 0);
  }
}
