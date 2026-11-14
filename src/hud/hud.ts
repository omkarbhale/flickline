import { TICK_DT } from '../core/time';
import type { Subscribable } from '../core/eventBus';
import { cssHex, palette } from '../config/palette';
import type { FeedbackTunables } from '../config/feedback';
import type { SessionStats } from '../feedback/sessionStats';
import { colorToHex, type CrosshairParams } from '../settings/crosshair';
import type { SettingsEvents } from '../settings/settings';
import { CrosshairView } from './crosshairView';
import { formatRtTtk, hitmarkerKind, provisionalKillScore, type HitmarkerKind } from '../feedback/hitFeedback';
import type { FeedbackOptions } from '../feedback/options';
import { PulseBudget } from '../feedback/pulseBudget';
import type { HitZone, SimEvents } from '../sim/types';

/** What the HUD needs from the rest of the app for per-shot feedback. */
export interface HudFeedbackDeps {
  options: Readonly<FeedbackOptions>;
  cfg: FeedbackTunables;
  /** World point -> CSS pixels (false if behind the camera). Must not allocate. */
  project: (x: number, y: number, z: number, out: { x: number; y: number }) => boolean;
}

const MARKER_CLASSES = ['hm-body', 'hm-leg', 'hm-head', 'hm-kill', 'hm-headkill'] as const;
const MARKER_CLASS: Record<HitmarkerKind, (typeof MARKER_CLASSES)[number]> = {
  body: 'hm-body',
  leg: 'hm-leg',
  head: 'hm-head',
  kill: 'hm-kill',
  headKill: 'hm-headkill',
};

/**
 * In-game overlay: crosshair, hit markers, floating numbers, screen pulse, session counters.
 *
 * DOM is written only from events (never per frame). Every effect is an element that is
 * created once and restarted by toggling a class (CSS does the animation and its timing in
 * milliseconds, so it looks the same at 60 and 240 fps). Everything fires synchronously from
 * the sim event callback, i.e. in the same rendered frame as the shot.
 */
export class Hud {
  private readonly hitMarker: HTMLElement;
  private readonly moveGlyph: HTMLElement;
  private readonly rtFloat: HTMLElement;
  private readonly pulse: HTMLElement;
  private readonly counters: HTMLElement;
  private readonly floats: HTMLElement[] = [];
  private nextFloat = 0;
  private readonly labels: string[] = [];
  private readonly budget: PulseBudget;
  private readonly scratch = { x: 0, y: 0 };
  private markerKind: (typeof MARKER_CLASSES)[number] = 'hm-body';
  readonly root: HTMLElement;
  /** The crosshair canvas; redraws only on change (see `CrosshairView`). */
  readonly crosshair: CrosshairView;

  constructor(
    root: HTMLElement,
    bus: Subscribable<SimEvents & SettingsEvents>,
    private readonly stats: SessionStats,
    crosshair: Readonly<CrosshairParams>,
    private readonly fx: HudFeedbackDeps,
  ) {
    this.root = root;
    const cfg = fx.cfg;
    root.style.setProperty('--hm-body', `${cfg.hitmarker.bodyMs}ms`);
    root.style.setProperty('--hm-leg', `${cfg.hitmarker.legMs}ms`);
    root.style.setProperty('--hm-head', `${cfg.hitmarker.headMs}ms`);
    root.style.setProperty('--hm-kill', `${cfg.hitmarker.killMs}ms`);
    root.style.setProperty('--glyph-ms', `${cfg.moveGlyphMs}ms`);
    root.style.setProperty('--float-ms', `${cfg.floatText.ms}ms`);
    root.style.setProperty('--rt-ms', `${cfg.floatText.rtTtkMs}ms`);
    root.style.setProperty('--float-rise', `${cfg.floatText.riseRem}rem`);
    root.style.setProperty('--pulse-ms', `${cfg.pulse.ms}ms`);
    root.style.setProperty('--pulse-alpha', String(cfg.pulse.maxAlpha));
    for (const k of ['trim', 'gold', 'ok', 'warn', 'alert', 'core'] as const) {
      root.style.setProperty(`--${k}`, cssHex(palette[k]));
    }

    root.innerHTML = `
      <div class="edge-pulse"></div>
      <div class="hitmarker"><i></i><i></i><i></i><i></i><b></b></div>
      <div class="move-glyph" aria-hidden="true">⇆</div>
      <div class="rt-float"></div>
      <div class="floats"></div>
      <div class="counters"></div>`;
    this.pulse = root.querySelector('.edge-pulse') as HTMLElement;
    this.hitMarker = root.querySelector('.hitmarker') as HTMLElement;
    this.moveGlyph = root.querySelector('.move-glyph') as HTMLElement;
    this.rtFloat = root.querySelector('.rt-float') as HTMLElement;
    this.counters = root.querySelector('.counters') as HTMLElement;
    const floatRoot = root.querySelector('.floats') as HTMLElement;
    for (let i = 0; i < cfg.floatText.pool; i++) {
      const el = document.createElement('div');
      el.className = 'fnum';
      el.appendChild(document.createElement('span'));
      floatRoot.appendChild(el);
      this.floats.push(el);
    }
    this.budget = new PulseBudget(cfg.pulse.maxPerSecond);
    this.crosshair = new CrosshairView(root, crosshair);
    this.applyHitColor(crosshair);

    bus.on('settingsChanged', ({ settings, changed }) => {
      if (!changed.includes('crosshair')) return;
      this.crosshair.setParams(settings.crosshair);
      this.applyHitColor(settings.crosshair);
    });
    bus.on('shotFired', (e) => {
      if (e.moving) this.crosshair.pulse();
      if (e.moving && fx.options.coachingCues) this.restart(this.moveGlyph, 'show');
      this.refresh();
    });
    bus.on('targetHit', (e) => {
      const kind = hitmarkerKind(e.zone, e.killed);
      this.showMarker(kind);
      if (!e.killed && fx.options.damageNumbers) this.floatNumber(e.point.x, e.point.y, e.point.z, e.damage, e.zone, false);
      this.refresh();
    });
    bus.on('targetKilled', (e) => {
      if (!fx.options.reduceFlashing && this.budget.tryAcquire(e.tick * TICK_DT)) this.restart(this.pulse, 'show');
      this.floatNumber(e.point.x, e.point.y, e.point.z, provisionalKillScore(e.zone, fx.cfg), e.zone, true);
      const text = formatRtTtk(e.rtMs, e.ttkMs);
      if (text !== null) {
        this.rtFloat.textContent = text;
        this.restart(this.rtFloat, 'show');
      }
      this.refresh();
    });
    this.refresh();
  }

  /** Restart a one-shot CSS animation on `el` by toggling `cls` (forces one reflow; per event, not per frame). */
  private restart(el: HTMLElement, cls: string): void {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }

  private applyHitColor(p: Readonly<CrosshairParams>): void {
    this.root.style.setProperty('--hit-color', colorToHex(p.hitMarkerColor));
  }

  private showMarker(kind: HitmarkerKind): void {
    const el = this.hitMarker;
    const cls = MARKER_CLASS[kind];
    el.classList.remove('show', this.markerKind);
    void el.offsetWidth;
    el.classList.add('show', cls);
    this.markerKind = cls;
    if (kind === 'head' || kind === 'headKill') this.restart(this.crosshair.canvas, 'gap');
  }

  private label(n: number): string {
    return (this.labels[n] ??= String(n));
  }

  private floatNumber(x: number, y: number, z: number, value: number, zone: HitZone, kill: boolean): void {
    const el = this.floats[this.nextFloat]!;
    this.nextFloat = (this.nextFloat + 1) % this.floats.length;
    const p = this.scratch;
    if (!this.fx.project(x, y, z, p)) {
      p.x = window.innerWidth / 2;
      p.y = window.innerHeight / 2;
    }
    el.style.transform = `translate(${p.x.toFixed(0)}px, ${p.y.toFixed(0)}px)`;
    const span = el.firstChild as HTMLElement;
    span.textContent = kill ? `+${this.label(value)}` : this.label(value);
    el.classList.remove('show', 'f-body', 'f-leg', 'f-head', 'f-kill');
    void el.offsetWidth;
    el.classList.add('show', kill ? 'f-kill' : zone === 'head' ? 'f-head' : zone === 'leg' ? 'f-leg' : 'f-body');
    if (kill && zone === 'head') el.classList.add('f-head');
  }

  refresh(): void {
    const s = this.stats;
    this.counters.textContent = `KILLS ${s.kills}   ACC ${(s.accuracy * 100).toFixed(0)}%`;
  }

  setVisible(v: boolean): void {
    this.root.style.display = v ? '' : 'none';
  }
}
