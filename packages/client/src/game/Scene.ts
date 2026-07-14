import { Application, Container, Graphics, Text } from "pixi.js";
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

function heightOf(m: number): number {
  return Math.log(Math.max(m, 1)) / LOG_MAX;
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

/**
 * Placeholder pixel-art scene (FR-12–FR-16): a bear climbing a central tree,
 * milestone branches, a ladder rail, crash/cashout feedback. Real sprites
 * come later — this uses plain Pixi Graphics so the whole round loop is
 * playable now.
 */
export class Scene {
  readonly app = new Application();

  private readonly world = new Container();
  private readonly branchLayer = new Container();
  private readonly bear = new Graphics();
  private readonly ladderMarker = new Graphics();
  private readonly particleLayer = new Container();
  private readonly branches: { container: Container; multiplier: number }[] = [];

  private particles: Particle[] = [];
  private lastFrameTs = performance.now();
  private shakeMagnitude = 0;
  private fallY = 0;
  private fallVy = 0;
  private fallRotation = 0;
  private lastState: string | undefined;

  constructor(private readonly controller: GameController) {}

  async init(parent: HTMLElement): Promise<void> {
    await this.app.init({
      width: WIDTH,
      height: HEIGHT,
      backgroundColor: 0x171233,
      antialias: true,
    });
    parent.appendChild(this.app.canvas);

    this.drawSky();
    this.drawTree();
    this.drawMilestoneBranches();
    this.drawLadder();
    this.drawBear();

    this.world.addChild(this.particleLayer);
    this.app.stage.addChild(this.world);

    this.app.ticker.add(() => this.frame());
  }

  private drawSky(): void {
    const sky = new Graphics()
      .rect(0, 0, WIDTH, HEIGHT)
      .fill({ color: 0x171233 });
    const band = new Graphics()
      .rect(0, HEIGHT * 0.55, WIDTH, HEIGHT * 0.45)
      .fill({ color: 0x2b1e4e, alpha: 0.6 });
    this.world.addChild(sky, band);
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
        .fill({ color: 0x2f6b2a });
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
    this.bear
      .roundRect(-24, -24, 48, 48, 10)
      .fill({ color: 0x7a4a21 })
      .circle(-10, -6, 5)
      .fill({ color: 0x14100a })
      .circle(10, -6, 5)
      .fill({ color: 0x14100a })
      .roundRect(-14, 4, 28, 14, 6)
      .fill({ color: 0xd9b380 });
    this.bear.x = TREE_X + 46;
    this.bear.y = BEAR_Y;
    this.world.addChild(this.bear);
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
