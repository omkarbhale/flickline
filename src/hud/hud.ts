import { TICK_DT } from '../core/time';
import type { Subscribable } from '../core/eventBus';
import { css } from '../config/palette';
import type { FeedbackTunables } from '../config/feedback';
import { colorToHex, type CrosshairParams } from '../settings/crosshair';
import type { SettingsEvents } from '../settings/settings';
import type { ModeEvents } from '../modes/contracts';
import type { HitZone, SimEvents } from '../sim/types';
import { CrosshairView } from './crosshairView';
import { LiveHud, type LiveHudDeps } from './liveHud';
import { restartAnimation } from './restartAnimation';
import { formatRtTtk, hitmarkerKind, provisionalKillScore, type HitmarkerKind } from '../feedback/hitFeedback';
import type { CueTunables } from '../config/cues';
import { tunables as allTunables } from '../config/tunables';
import { damageNumbersShown, movingCueShown, readoutShown } from '../feedback/cueGate';
import type { FeedbackOptions } from '../feedback/options';
import { PulseBudget } from '../feedback/pulseBudget';

/** What the HUD needs from the rest of the app for per-shot feedback. */
export interface HudFeedbackDeps {
  options: Readonly<FeedbackOptions>;
  cfg: FeedbackTunables;
  /** World point -> CSS pixels (false if behind the camera). Must not allocate. */
  project: (x: number, y: number, z: number, out: { x: number; y: number }) => boolean;
  /** Cue-fading thresholds (design §7.4); defaults to the tunables. */
  cues?: CueTunables;
  /** The run's median time to shot in ms (NaN with none), for the readout's bandwidth rule. */
  medianRtMs?: () => number;
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
  private readonly floats: HTMLElement[] = [];
  private nextFloat = 0;
  private readonly labels: string[] = [];
  private readonly budget: PulseBudget;
  private readonly scratch = { x: 0, y: 0 };
  private markerKind: (typeof MARKER_CLASSES)[number] = 'hm-body';
  /** The live readouts (design §7.2, §13.1): timer, score, counters, stat strip, ghost-pace, edge meter, ammo. */
  readonly live: LiveHud;
  readonly root: HTMLElement;
  private readonly cues: CueTunables;
  /** The crosshair canvas; redraws only on change (see `CrosshairView`). */
  readonly crosshair: CrosshairView;

  constructor(
    root: HTMLElement,
    bus: Subscribable<SimEvents & SettingsEvents & ModeEvents>,
    crosshair: Readonly<CrosshairParams>,
    liveDeps: LiveHudDeps,
    private readonly fx: HudFeedbackDeps,
  ) {
    this.root = root;
    this.cues = fx.cues ?? allTunables.cues;
    const cfg = fx.cfg;
    root.style.setProperty('--hm-body', `${cfg.hitmarker.bodyMs}ms`);
    root.style.setProperty('--hm-leg', `${cfg.hitmarker.legMs}ms`);
    root.style.setProperty('--hm-head', `${cfg.hitmarker.headMs}ms`);
    root.style.setProperty('--hm-kill', `${cfg.hitmarker.killMs}ms`);
    root.style.setProperty('--glyph-ms', `${cfg.moveGlyphMs}ms`);
    root.style.setProperty('--float-ms', `${cfg.floatText.ms}ms`);
    root.style.setProperty('--rt-ms', `${cfg.floatText.rtTtkMs}ms`);
    root.style.setProperty('--float-rise', `${cfg.floatText.riseRem}rem`);
    root.style.setProperty('--kill-lift', `${cfg.floatText.killLiftRem}rem`);
    root.style.setProperty('--rt-drop', `${cfg.floatText.rtDropRem}rem`);
    root.style.setProperty('--pulse-ms', `${cfg.pulse.ms}ms`);
    root.style.setProperty('--pulse-alpha', String(cfg.pulse.maxAlpha));
    for (const k of ['trim', 'gold', 'ok', 'warn', 'alert', 'core'] as const) {
      root.style.setProperty(`--${k}`, css[k]);
    }

    root.innerHTML = `
      <div class="edge-pulse"></div>
      <div class="hitmarker"><i></i><i></i><i></i><i></i><b></b></div>
      <div class="move-glyph" aria-hidden="true">⇆</div>
      <div class="rt-float"></div>
      <div class="floats"></div>`;
    this.pulse = root.querySelector('.edge-pulse') as HTMLElement;
    this.hitMarker = root.querySelector('.hitmarker') as HTMLElement;
    this.moveGlyph = root.querySelector('.move-glyph') as HTMLElement;
    this.rtFloat = root.querySelector('.rt-float') as HTMLElement;
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
    this.live = new LiveHud(root, bus, liveDeps);
    this.applyHitColor(crosshair);

    bus.on('settingsChanged', ({ settings, changed }) => {
      if (!changed.includes('crosshair')) return;
      this.crosshair.setParams(settings.crosshair);
      this.applyHitColor(settings.crosshair);
    });
    bus.on('shotFired', (e) => {
      if (e.moving) this.crosshair.pulse();
      if (e.moving && movingCueShown(fx.options, this.cues, e.speed, e.airborne)) this.restart(this.moveGlyph, 'show');
    });
    bus.on('targetHit', (e) => {
      const kind = hitmarkerKind(e.zone, e.killed);
      this.showMarker(kind);
      if (!e.killed && damageNumbersShown(fx.options, this.cues)) this.floatNumber(e.point.x, e.point.y, e.point.z, e.damage, e.zone, false);
    });
    bus.on('targetKilled', (e) => {
      if (!fx.options.reduceFlashing && this.budget.tryAcquire(e.tick * TICK_DT)) this.restart(this.pulse, 'show');
      this.floatNumber(e.point.x, e.point.y, e.point.z, provisionalKillScore(e.zone, fx.cfg), e.zone, true);
      const text = formatRtTtk(e.rtMs, e.ttkMs);
      if (text !== null && readoutShown(fx.options, this.cues, e.rtMs ?? NaN, fx.medianRtMs?.() ?? NaN)) {
        this.rtFloat.textContent = text;
        this.restart(this.rtFloat, 'show');
      }
    });

  }

  /** Restart a one-shot CSS animation on `el` (twin classes, no forced reflow; see `restartAnimation`). */
  private restart(el: HTMLElement, cls: string): void {
    restartAnimation(el, cls);
  }

  private applyHitColor(p: Readonly<CrosshairParams>): void {
    this.root.style.setProperty('--hit-color', colorToHex(p.hitMarkerColor));
  }

  private showMarker(kind: HitmarkerKind): void {
    const el = this.hitMarker;
    const cls = MARKER_CLASS[kind];
    el.classList.remove(this.markerKind);
    el.classList.add(cls);
    this.restart(el, 'show');
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
    el.classList.remove('f-body', 'f-leg', 'f-head', 'f-kill');
    this.restart(el, 'show');
    el.classList.add(kill ? 'f-kill' : zone === 'head' ? 'f-head' : zone === 'leg' ? 'f-leg' : 'f-body');
    if (kill && zone === 'head') el.classList.add('f-head');
  }

  /** Re-read every live readout from its source (after a reset). */
  refresh(): void {
    this.live.refreshAll();
  }

  /** Per frame: the run clock and ghost-pace bar. Cheap; writes the DOM only on change. */
  update(): void {
    this.live.update();
  }

  setVisible(v: boolean): void {
    this.root.style.display = v ? '' : 'none';
  }
}
