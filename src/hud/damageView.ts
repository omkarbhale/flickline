import type { Subscribable } from '../core/eventBus';
import { clamp } from '../core/math';
import type { DamageFxTunables } from '../config/damageFx';
import { palette } from '../config/palette';
import type { PlayerHealth, SimEvents } from '../sim/types';
import { arcAlpha, DamageArcPool } from './damageArcs';

type DamageEvents = Pick<SimEvents, 'playerDamaged' | 'playerHealed'>;

const ALPHA_STEPS = 32;

/**
 * The player's damage presentation (design §7.1 "Taking damage"): a directional arc towards the
 * shooter, a vignette that narrows in, a 150 ms desaturation and the HP bar flash. Event driven
 * like the rest of the HUD: the vignette, desaturation and HP flash are CSS animations restarted
 * by a class toggle. The only per-frame work is `update()`, which redraws the arcs on a small
 * canvas while one is showing (they follow the live view yaw, so the arc stays on the shooter as
 * the player turns) and does nothing otherwise. The canvas draw allocates nothing: the colour
 * strings are built once.
 *
 * Reduce flashing: no vignette pulse, no desaturation, no HP flash; the arc remains (it is
 * information, not a flash) and fades slowly instead of snapping.
 */
export class DamageView {
  private readonly vignette: HTMLElement;
  private readonly desat: HTMLElement;
  private readonly hp: HTMLElement;
  private readonly hpText: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly pool: DamageArcPool;
  private readonly styles: string[] = [];
  private readonly mergeRad: number;
  private reduceFlashing = false;
  private alwaysShowHp = false;
  private drawn = false;
  /** CSS size of the arc canvas, device pixels per side. */
  private px = 0;
  /** Counts redraws, for the debug overlay and tests. */
  draws = 0;
  private readonly offs: (() => void)[];

  constructor(
    root: HTMLElement,
    bus: Subscribable<DamageEvents>,
    private readonly fx: Readonly<DamageFxTunables>,
    private readonly health: Readonly<PlayerHealth>,
    reduceFlashing: boolean,
    private readonly now: () => number,
    private readonly liveYaw: () => number,
  ) {
    const host = document.createElement('div');
    host.className = 'dmg-root';
    host.innerHTML = `
      <div class="dmg-vignette"></div>
      <div class="dmg-desat"></div>
      <canvas class="dmg-arcs"></canvas>
      <div class="hp"><div class="hp-fill"></div><span class="hp-text"></span></div>`;
    root.appendChild(host);
    this.vignette = host.querySelector('.dmg-vignette') as HTMLElement;
    this.desat = host.querySelector('.dmg-desat') as HTMLElement;
    this.canvas = host.querySelector('.dmg-arcs') as HTMLCanvasElement;
    this.hp = host.querySelector('.hp') as HTMLElement;
    this.hpText = host.querySelector('.hp-text') as HTMLElement;
    this.ctx = this.canvas.getContext('2d');
    this.pool = new DamageArcPool(fx.arcCapacity);
    this.mergeRad = (fx.arcMergeDeg * Math.PI) / 180;
    this.reduceFlashing = reduceFlashing;

    const rgb = [(palette.alert >> 16) & 255, (palette.alert >> 8) & 255, palette.alert & 255];
    for (let i = 0; i <= ALPHA_STEPS; i++) this.styles.push(`rgba(${rgb[0]},${rgb[1]},${rgb[2]},${(i / ALPHA_STEPS).toFixed(3)})`);
    host.style.setProperty('--dmg-vignette-ms', `${fx.vignetteMs}ms`);
    host.style.setProperty('--dmg-desat-ms', `${fx.desaturateMs}ms`);
    host.style.setProperty('--dmg-desat-to', String(fx.desaturateTo));
    host.style.setProperty('--dmg-hp-flash-ms', `${fx.hpFlashMs}ms`);

    this.offs = [
      bus.on('playerDamaged', (e) => this.onDamaged(e)),
      bus.on('playerHealed', () => this.syncHp(false)),
    ];
    this.syncHp(false);
  }

  /** Reduce flashing changed (settings). */
  setReduceFlashing(v: boolean): void {
    this.reduceFlashing = v;
  }

  /** Keep the HP bar up even at full health (modes with enemy fire). */
  setHpAlwaysVisible(v: boolean): void {
    this.alwaysShowHp = v;
    this.syncHp(false);
  }

  /** Size the arc canvas for the viewport (call on resize). The arcs sit on a ring around the crosshair. */
  resize(width: number, height: number, dpr: number): void {
    const side = Math.round(Math.min(width, height) * 0.84 * Math.min(dpr, 2));
    if (side === this.px) return;
    this.px = side;
    this.canvas.width = this.canvas.height = side;
    this.drawn = false;
  }

  /** The world was reset (restart, new run): clear everything and re-read the health. */
  reset(): void {
    this.pool.clear();
    this.clearCanvas();
    this.vignette.classList.remove('hit');
    this.desat.classList.remove('hit');
    this.hp.classList.remove('hit');
    this.syncHp(false);
  }

  private onDamaged(e: Readonly<SimEvents['playerDamaged']>): void {
    this.pool.add(e.dir.x, e.dir.z, e.yaw, this.liveYaw(), this.now(), this.mergeRad);
    if (!this.reduceFlashing) {
      this.restart(this.vignette);
      this.restart(this.desat);
    }
    this.syncHp(!this.reduceFlashing);
  }

  private restart(el: HTMLElement): void {
    el.classList.remove('hit');
    void el.offsetWidth; // restart the CSS animation
    el.classList.add('hit');
  }

  /** Rewrite the HP bar (events only). */
  private syncHp(flash: boolean): void {
    const h = this.health;
    const frac = h.maxHp > 0 ? clamp(h.hp / h.maxHp, 0, 1) : 0;
    this.hp.classList.toggle('shown', this.alwaysShowHp || h.hp < h.maxHp);
    this.hp.classList.toggle('low', frac <= 0.3);
    this.hp.style.setProperty('--hp', String(frac));
    // HP is shown rounded UP: the sim keeps floats, and 0 on the bar means dead.
    this.hpText.textContent = String(Math.ceil(h.hp));
    if (flash) this.restart(this.hp);
  }

  /** Per frame: redraw the arcs while any is showing (no-op, and no DOM or canvas work, when idle). */
  update(): void {
    const pool = this.pool;
    if (pool.active === 0) {
      if (this.drawn) this.clearCanvas();
      return;
    }
    const ctx = this.ctx;
    if (!ctx || this.px === 0) return;
    const now = this.now();
    const life = this.reduceFlashing ? this.fx.arcReducedMs : this.fx.arcMs;
    if (pool.prune(now, life) === 0) {
      this.clearCanvas();
      return;
    }
    const s = this.px;
    const c = s / 2;
    const r = s * 0.46;
    const half = (this.fx.arcWidthDeg * Math.PI) / 360;
    const yaw = this.liveYaw();
    ctx.clearRect(0, 0, s, s);
    ctx.lineCap = 'round';
    for (let i = 0; i < pool.capacity; i++) {
      if (pool.live[i] === 0) continue;
      const a = arcAlpha(now - pool.startMs[i]!, life);
      if (a <= 0) continue;
      // Screen angle is clockwise from up; canvas angles are clockwise from +X.
      const centre = pool.screenAngle(i, yaw) - Math.PI / 2;
      // Three nested strokes: a wide faint halo, the body and a bright core.
      this.stroke(ctx, c, r, centre, half, s * 0.05, a * 0.28);
      this.stroke(ctx, c, r, centre, half * 0.8, s * 0.03, a * 0.65);
      this.stroke(ctx, c, r, centre, half * 0.55, s * 0.012, a);
    }
    this.drawn = true;
    this.draws++;
  }

  private stroke(ctx: CanvasRenderingContext2D, c: number, r: number, centre: number, half: number, width: number, alpha: number): void {
    ctx.strokeStyle = this.styles[Math.round(clamp(alpha, 0, 1) * ALPHA_STEPS)]!;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.arc(c, c, r, centre - half, centre + half);
    ctx.stroke();
  }

  private clearCanvas(): void {
    this.ctx?.clearRect(0, 0, this.px, this.px);
    this.drawn = false;
  }

  /** Arcs currently showing (debug, tests). */
  get arcsShowing(): number {
    return this.pool.active;
  }

  dispose(): void {
    for (const f of this.offs) f();
  }
}
