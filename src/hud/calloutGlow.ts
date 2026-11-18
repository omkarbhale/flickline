import { arcAlpha, arcScreenAngle } from './damageArcs';

/**
 * Where the callout's glow sits and how strong it is (engagement-information §4.2): a soft patch on
 * the screen edge towards the called direction, never a marker. Pure maths; `CalloutGlow` draws it.
 */

/**
 * The point on the edge of a `w` x `h` screen where the ray from the centre at screen angle `a`
 * (clockwise from straight up, 0 = ahead, +PI/2 = right) leaves it, pulled in by `inset` (a fraction
 * of the half size) so the glow's centre sits just inside the edge. Writes `out` = [x, y] in pixels.
 */
export function edgePoint(out: [number, number], a: number, w: number, h: number, inset: number): void {
  const dx = Math.sin(a), dy = -Math.cos(a);
  const hw = w / 2, hh = h / 2;
  const tx = Math.abs(dx) > 1e-9 ? hw / Math.abs(dx) : Infinity;
  const ty = Math.abs(dy) > 1e-9 ? hh / Math.abs(dy) : Infinity;
  const t = Math.min(tx, ty) * (1 - inset);
  out[0] = hw + dx * t;
  out[1] = hh + dy * t;
}

/**
 * The glow in a canvas that covers the view. It remembers the called world direction and the time
 * it started, and every frame it shows (and only then) redraws one radial gradient at the screen
 * edge towards that direction under the live view yaw, so it stays on its side as the player
 * turns. Fades over `glowMs`. Allocates nothing per frame (the colour strings are built once).
 */
export class CalloutGlow {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly styles: string[] = [];
  private readonly pt: [number, number] = [0, 0];
  private dirX = 0;
  private dirZ = -1;
  private startMs = -1e9;
  private active = false;
  private drawn = false;
  private w = 0;
  private h = 0;
  /** Redraws, for the debug state and tests. */
  draws = 0;

  constructor(
    root: HTMLElement,
    rgb: readonly [number, number, number],
    private readonly glowMs: number,
    private readonly widthRad: number,
  ) {
    const c = document.createElement('canvas');
    c.className = 'callout-glow';
    root.appendChild(c);
    this.canvas = c;
    this.ctx = c.getContext('2d');
    for (let i = 0; i <= 32; i++) this.styles.push(`rgba(${rgb[0]},${rgb[1]},${rgb[2]},${(i / 32).toFixed(3)})`);
  }

  /** Size the canvas for the viewport; a glow is blurry by nature, so it draws at a quarter of the pixels. */
  resize(width: number, height: number): void {
    this.w = Math.max(16, Math.round(width / 4));
    this.h = Math.max(16, Math.round(height / 4));
    this.canvas.width = this.w;
    this.canvas.height = this.h;
    this.drawn = false;
  }

  /** Start a glow towards the world direction (`dirX`, `dirZ`) at time `nowMs`. */
  show(dirX: number, dirZ: number, nowMs: number): void {
    this.dirX = dirX;
    this.dirZ = dirZ;
    this.startMs = nowMs;
    this.active = true;
  }

  reset(): void {
    this.active = false;
    this.clear();
  }

  get showing(): boolean {
    return this.active;
  }

  /** Per frame: redraw while showing; nothing (and no canvas work) when idle. */
  update(nowMs: number, liveYaw: number): void {
    if (!this.active) {
      if (this.drawn) this.clear();
      return;
    }
    const ctx = this.ctx;
    if (!ctx || this.w === 0) return;
    const age = nowMs - this.startMs;
    const a = arcAlpha(age, this.glowMs);
    if (age >= this.glowMs) {
      this.active = false;
      this.clear();
      return;
    }
    edgePoint(this.pt, arcScreenAngle(this.dirX, this.dirZ, 0, liveYaw), this.w, this.h, 0.04);
    const r = Math.min(this.w, this.h) * 0.5 * (this.widthRad / (Math.PI / 2));
    const g = ctx.createRadialGradient(this.pt[0], this.pt[1], 0, this.pt[0], this.pt[1], r);
    g.addColorStop(0, this.styles[Math.round(Math.max(0, Math.min(1, a * 0.55)) * 32)]!);
    g.addColorStop(1, this.styles[0]!);
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.w, this.h);
    this.drawn = true;
    this.draws++;
  }

  private clear(): void {
    this.ctx?.clearRect(0, 0, this.w, this.h);
    this.drawn = false;
  }

  dispose(): void {
    this.canvas.remove();
  }
}
