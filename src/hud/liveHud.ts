import type { Subscribable } from '../core/eventBus';
import type { HudTunables } from '../config/hud';
import type { WeaponTable } from '../config/weapon';
import type { EdgeMeter } from '../feedback/edgeMeter';
import { NO_PACE, paceFraction, type RunPaceSource } from '../feedback/ghostPace';
import type { HudStatsSource } from '../feedback/hudStats';
import type { ModeEvents } from '../modes/contracts';
import { HUD_ELEMENTS, HUD_LABELS, type HudElementId, type HudSettings } from '../settings/hud';
import type { SettingsEvents } from '../settings/settings';
import type { PlayerHealth, SimEvents, WeaponState } from '../sim/types';
import {
  chainText, formatClock, formatDelta, formatMs, formatMult, formatPercent, formatScore, formatSeconds, formatTenths,
} from './format';
import { restartAnimation as restart } from './restartAnimation';

/** The run clock the timer reads (the mode host satisfies it). */
export interface HudClock {
  readonly phase: 'idle' | 'ready' | 'live' | 'result';
  readonly modeId: string | null;
  /** Seconds since the run went live. */
  readonly timeSec: number;
  /** Seconds left, `Infinity` for an untimed run. */
  readonly remainingSec: number;
}

type LiveHudEvents = Pick<
  SimEvents,
  'shotFired' | 'targetHit' | 'targetKilled' | 'reloadStarted' | 'reloadCompleted' | 'reloadCancelled' | 'weaponSwitched' | 'playerDamaged' | 'playerHealed' | 'playerShielded'
> &
  Pick<ModeEvents, 'runReady' | 'runStarted' | 'runEnded' | 'scoreAwarded' | 'chainUpdated' | 'streakUpdated'> &
  SettingsEvents;

export interface LiveHudDeps {
  /** The stat tracker (design §14.3 "the HUD renders from it"): the HUD never computes a stat. */
  stats: HudStatsSource;
  edge: EdgeMeter;
  clock: HudClock;
  hud: HudTunables;
  /** Clean streak that fills the ring (scoring `streakCap`). */
  streakCap: number;
  settings: Readonly<HudSettings>;
  weapon: WeaponState;
  weapons: WeaponTable;
  /**
   * The player's health state. When given, a run that starts with a shield (modes with enemy fire,
   * design §5.1) shows health and shield from the ready phase instead of from the first hit.
   */
  health?: Readonly<PlayerHealth>;
  /** How long the health bar flashes when the player is hit, ms (design §7.1; `damageFx.hpFlashMs`). */
  hpFlashMs?: number;
}

const ELEMENT_ATTR = 'data-el';
const NO_TIMER = '–:––';

/**
 * The live HUD of design §7.2 / §13.1: timer, score and multiplier, chain, streak ring, ghost-pace
 * bar, stat strip, edge meter, health and ammo, as a DOM overlay in the default layout.
 *
 * Rules it follows (architecture §7.7, design §13.1):
 *  - Reads only the stat tracker, the edge meter, the run clock and the event bus; no stat is
 *    computed here.
 *  - Writes the DOM only when a displayed value changes (events, plus `update()` once per frame,
 *    which does arithmetic and early-outs; it allocates nothing and touches the DOM at most when
 *    the clock's displayed text changes, once per second, or ten times a second in the last 10 s).
 *  - Layout-neutral writes only: `textContent` on elements with fixed size, and transform /
 *    stroke-dashoffset for bars and the ring. Animations restart by swapping the animation name
 *    (`a`/`b` classes), never by forcing a reflow.
 */
export class LiveHud {
  private readonly el: Record<HudElementId, HTMLElement>;
  private readonly timerV: HTMLElement;
  private readonly scoreV: HTMLElement;
  private readonly multV: HTMLElement;
  private readonly chainV: HTMLElement;
  private readonly ringV: HTMLElement;
  private readonly ringNum: HTMLElement;
  private readonly ghostAhead: HTMLElement;
  private readonly ghostBehind: HTMLElement;
  private readonly ghostText: HTMLElement;
  private readonly edgeFill: HTMLElement;
  private readonly edgeNum: HTMLElement;
  private readonly hpFill: HTMLElement;
  private readonly hpNum: HTMLElement;
  private readonly shBar: HTMLElement;
  private readonly shFill: HTMLElement;
  private readonly shNum: HTMLElement;
  private readonly ammoName: HTMLElement;
  private readonly ammoCount: HTMLElement;
  private readonly statV: Record<'acc' | 'hs' | 'rt' | 'ttk' | 'moving', HTMLElement>;

  private pace: RunPaceSource = NO_PACE;
  private score = 0;
  private chain = 0;
  private streak = 0;
  private paceTick = -1;
  private paceDirty = true;
  private paceKey = NaN;
  private paceVisible = false;
  private lastPhase: HudClock['phase'] | '' = '';
  private lastTimerKey = NaN;
  private lastEdgeKey = NaN;
  private readonly hpBars: HTMLElement;
  private hpAlwaysShown = false;
  private hpFrac = NaN;
  private shFrac = NaN;
  private shMax = 0;
  /** Shield now, kept for heals (they carry no shield; kill-heal never restores it). */
  private shNow = 0;
  private readonly statKey = { acc: NaN, hs: NaN, rt: NaN, ttk: NaN, moving: NaN };

  constructor(
    private readonly root: HTMLElement,
    bus: Subscribable<LiveHudEvents>,
    private readonly d: LiveHudDeps,
  ) {
    const zoneLo = d.hud.edgeZoneLo * 100;
    const zoneW = (d.hud.edgeZoneHi - d.hud.edgeZoneLo) * 100;
    const wrap = document.createElement('div');
    wrap.className = 'lh';
    wrap.innerHTML = `
      <div class="lh-top">
        <div class="lh-timer" ${ELEMENT_ATTR}="timer"><span data-v>${NO_TIMER}</span></div>
        <div class="lh-scorebox">
          <div class="lh-score" ${ELEMENT_ATTR}="score"><span data-v>0</span></div>
          <div class="lh-mult" ${ELEMENT_ATTR}="multiplier" data-tier="0"><span data-v>×1.0</span></div>
        </div>
        <div class="lh-ghost off" ${ELEMENT_ATTR}="ghost">
          <div class="lh-ghost-bar"><i class="behind"></i><i class="ahead"></i><b></b></div>
          <span class="lh-ghost-txt">best run</span>
        </div>
      </div>
      <div class="lh-counters">
        <div class="lh-chain off" ${ELEMENT_ATTR}="chain"><span data-v></span></div>
        <div class="lh-ring" ${ELEMENT_ATTR}="streak">
          <svg viewBox="0 0 40 40" aria-hidden="true">
            <circle class="track" cx="20" cy="20" r="16" pathLength="1" />
            <circle class="fill" cx="20" cy="20" r="16" pathLength="1" transform="rotate(-90 20 20)" />
          </svg>
          <span data-v>0</span>
        </div>
      </div>
      <div class="lh-bl">
        <div class="lh-strip">
          <div class="lh-stat" ${ELEMENT_ATTR}="acc"><span class="k">ACC</span><span class="v" data-v>–</span></div>
          <div class="lh-stat" ${ELEMENT_ATTR}="hs"><span class="k">HS</span><span class="v" data-v>–</span></div>
          <div class="lh-stat" ${ELEMENT_ATTR}="rt" title="Median time to shot: target visible to your first shot aimed at it"><span class="k">TTS</span><span class="v" data-v>–</span></div>
          <div class="lh-stat" ${ELEMENT_ATTR}="ttk"><span class="k">TTK</span><span class="v" data-v>–</span></div>
          <div class="lh-stat" ${ELEMENT_ATTR}="moving"><span class="k">MOVING</span><span class="v" data-v>0</span></div>
        </div>
        <div class="lh-edge" ${ELEMENT_ATTR}="edge" title="Rolling success rate over your last ${d.hud.edgeWindow} trials. Target zone ${Math.round(zoneLo)}–${Math.round(zoneLo + zoneW)}%.">
          <span class="k">EDGE</span>
          <div class="lh-edge-track"><u style="left:${zoneLo}%;width:${zoneW}%"></u><i></i></div>
          <span class="v" data-v>–</span>
        </div>
      </div>
      <div class="lh-br">
        <div class="lh-hp off" ${ELEMENT_ATTR}="hp">
          <div class="lh-hp-bars"><div class="lh-sh-bar off"><i></i></div><div class="lh-hp-bar"><i></i></div></div>
          <span class="lh-sh-n off" title="Shield"></span><span data-v>100</span>
        </div>
        <div class="lh-ammo" ${ELEMENT_ATTR}="ammo"><span class="n"></span><span class="c" data-v></span></div>
      </div>`;
    root.appendChild(wrap);

    const el = {} as Record<HudElementId, HTMLElement>;
    for (const id of HUD_ELEMENTS) {
      el[id] = wrap.querySelector(`[${ELEMENT_ATTR}="${id}"]`) as HTMLElement;
      el[id].setAttribute('title', el[id].getAttribute('title') ?? HUD_LABELS[id]);
    }
    this.el = el;
    const v = (id: HudElementId): HTMLElement => el[id].querySelector('[data-v]') as HTMLElement;
    this.timerV = v('timer');
    this.scoreV = v('score');
    this.multV = v('multiplier');
    this.chainV = v('chain');
    this.ringNum = v('streak');
    this.ringV = el.streak.querySelector('.fill') as HTMLElement;
    this.ghostAhead = el.ghost.querySelector('.ahead') as HTMLElement;
    this.ghostBehind = el.ghost.querySelector('.behind') as HTMLElement;
    this.ghostText = el.ghost.querySelector('.lh-ghost-txt') as HTMLElement;
    this.edgeFill = el.edge.querySelector('i') as HTMLElement;
    this.edgeNum = v('edge');
    this.hpBars = el.hp.querySelector('.lh-hp-bars') as HTMLElement;
    if (d.hpFlashMs !== undefined) wrap.style.setProperty('--lh-hp-flash-ms', `${d.hpFlashMs}ms`);
    this.hpFill = el.hp.querySelector('.lh-hp-bar i') as HTMLElement;
    this.shBar = el.hp.querySelector('.lh-sh-bar') as HTMLElement;
    this.shFill = this.shBar.querySelector('i') as HTMLElement;
    this.shNum = el.hp.querySelector('.lh-sh-n') as HTMLElement;
    this.hpNum = v('hp');
    this.ammoName = el.ammo.querySelector('.n') as HTMLElement;
    this.ammoCount = v('ammo');
    this.statV = { acc: v('acc'), hs: v('hs'), rt: v('rt'), ttk: v('ttk'), moving: v('moving') };

    this.applySettings(d.settings);
    bus.on('settingsChanged', ({ settings, changed }) => {
      if (changed.includes('hud')) this.applySettings(settings.hud);
    });

    // Health is shown from the first damage or heal of a run (modes with enemy fire), hidden again when a run is readied.
    bus.on('playerDamaged', (e) => {
      this.setHp(e.hp, e.maxHp, e.shield, e.maxShield);
      // The flash is a CSS animation; Reduce flashing switches it off there (styles.css).
      restart(this.hpBars, 'lh-hit');
    });
    bus.on('playerHealed', (e) => this.setHp(e.hp, e.maxHp, this.shNow, this.shMax));
    bus.on('playerShielded', (e) => this.setHp(e.hp, e.maxHp, e.shield, e.maxShield));
    bus.on('runReady', () => this.onRunReady());
    bus.on('runStarted', () => { this.paceDirty = true; });
    bus.on('runEnded', () => { this.paceDirty = true; });
    bus.on('scoreAwarded', (e) => this.onScore(e.total));
    bus.on('chainUpdated', (e) => this.onChain(e.count));
    bus.on('streakUpdated', (e) => this.onStreak(e.streak, e.mult));

    bus.on('shotFired', () => { this.refreshStats(); this.refreshAmmo(); });
    bus.on('targetHit', () => this.refreshStats());
    bus.on('targetKilled', () => this.refreshStats());
    bus.on('reloadStarted', () => this.refreshAmmo());
    bus.on('reloadCompleted', () => this.refreshAmmo());
    bus.on('reloadCancelled', () => this.refreshAmmo());
    bus.on('weaponSwitched', () => this.refreshAmmo());

    this.refreshAll();
  }

  // ---- public ---------------------------------------------------------------------------------

  /** Where the pace against the best run comes from (#217). The default answers "none" and the bar hides. */
  setPace(src: RunPaceSource | null): void {
    this.pace = src ?? NO_PACE;
    this.paceDirty = true;
    this.paceTick = -1;
  }

  /**
   * Player health (modes with enemy fire), or `null` to hide the bar. With a shield (`maxShield` >
   * 0, spec §4.1) a thin shield bar and its number sit above the health bar; without one nothing
   * extra is drawn. Health shows rounded up (0 means dead), the shield too.
   */
  setHp(hp: number | null, max = 100, shield = 0, maxShield = 0): void {
    if (hp === null) {
      this.hpFrac = NaN;
      this.shFrac = NaN;
      this.shNow = this.shMax = 0;
      this.el.hp.classList.add('off');
      return;
    }
    const f = Math.min(1, Math.max(0, hp / max));
    if (f !== this.hpFrac) {
      this.hpFrac = f;
      this.hpFill.style.transform = `scaleX(${f})`;
      this.hpNum.textContent = String(Math.max(0, Math.ceil(hp)));
      this.el.hp.classList.toggle('low', f <= 0.3);
    }
    this.shNow = shield;
    this.shMax = maxShield;
    const sf = maxShield > 0 ? Math.min(1, Math.max(0, shield / maxShield)) : 0;
    const key = maxShield > 0 ? sf : -1;
    if (key !== this.shFrac) {
      this.shFrac = key;
      const on = maxShield > 0;
      this.shBar.classList.toggle('off', !on);
      this.shNum.classList.toggle('off', !on);
      this.el.hp.classList.toggle('shielded', on);
      this.el.hp.classList.toggle('broken', on && shield <= 0);
      this.shFill.style.transform = `scaleX(${sf})`;
      this.shNum.textContent = on ? String(Math.max(0, Math.ceil(shield))) : '';
    }
    this.el.hp.classList.remove('off');
  }

  /**
   * Keep the health bar up from the start of a run, even at full health and without a shield
   * (debug / playtest switch; modes with enemy fire show it from the first hit otherwise).
   */
  setHpAlwaysVisible(v: boolean): void {
    this.hpAlwaysShown = v;
    const h = this.d.health;
    if (!h) return;
    if (v || h.maxShield > 0 || h.hp < h.maxHp) this.setHp(h.hp, h.maxHp, h.shield, h.maxShield);
    else this.setHp(null);
  }

  /** Per frame: the run clock and the ghost-pace bar. Allocation-free; writes only on change. */
  update(): void {
    const c = this.d.clock;
    const phase = c.phase;
    if (phase !== this.lastPhase) {
      this.lastPhase = phase;
      this.root.dataset.phase = phase;
      this.lastTimerKey = NaN;
      this.paceDirty = true;
    }
    // Timer: key = displayed number * 4 + display mode, so the string is built only on change.
    let key: number;
    let mode = 0;
    if (phase === 'idle') key = -1;
    else {
      const rem = c.remainingSec;
      if (!Number.isFinite(rem)) { mode = 3; key = Math.floor(c.timeSec) * 4 + 3; }
      else if (rem < this.d.hud.timerTenthsBelowSec) { mode = 2; key = Math.floor(rem * 10 + 1e-9) * 4 + 2; }
      else { mode = 1; key = Math.ceil(rem - 1e-9) * 4 + 1; }
    }
    if (key !== this.lastTimerKey) {
      this.lastTimerKey = key;
      const t = this.timerV;
      if (mode === 0) t.textContent = NO_TIMER;
      else if (mode === 1) t.textContent = formatClock(c.remainingSec);
      else if (mode === 2) t.textContent = formatTenths(c.remainingSec);
      else t.textContent = formatClock(Math.floor(c.timeSec)); // untimed: counts up
    }
    if (phase === 'live') {
      const k = Math.floor(c.timeSec * this.d.hud.ghostRefreshHz);
      if (k !== this.paceTick || this.paceDirty) {
        this.paceTick = k;
        this.paceDirty = false;
        this.updatePace(c);
      }
    } else if (this.paceDirty) {
      this.paceDirty = false;
      if (phase === 'idle' || phase === 'ready') this.updatePace(c);
    }
    if (this.edgeKey() !== this.lastEdgeKey) this.refreshEdge();
  }

  /** Rewrite every readout from the sources (after a reset or when the HUD is created). */
  refreshAll(): void {
    this.refreshStats(true);
    this.refreshAmmo();
    this.refreshEdge();
    this.setScore(this.score);
  }

  /** Re-read the ammo line; the weapon state changed. */
  refreshAmmo(): void {
    const w = this.d.weapon;
    const slot = w.slots[w.active];
    if (!slot) return;
    const mag = w.infiniteMagazine ? '∞' : String(slot.mag);
    const reserve = w.infiniteReserve ? '∞' : String(slot.reserve);
    this.ammoName.textContent = this.d.weapons[slot.id].name.toUpperCase() + (w.reloadLeft > 0 ? '  RELOADING' : '');
    this.ammoCount.textContent = `${mag} / ${reserve}`;
    this.el.ammo.classList.toggle('reloading', w.reloadLeft > 0);
    this.el.ammo.classList.toggle('empty', !w.infiniteMagazine && slot.mag === 0);
  }

  /** The stat strip, from the tracker. Skips the write for every figure that did not change. */
  refreshStats(force = false): void {
    const s = this.d.stats;
    const k = this.statKey;
    // Keys are the displayed figure (-1 = no data), so a string is built only when it changes.
    const acc = s.accuracy >= 0 ? Math.round(s.accuracy * 100) : -1;
    if (force || acc !== k.acc) { k.acc = acc; this.statV.acc.textContent = formatPercent(s.accuracy); }
    const hs = s.headshotRate >= 0 ? Math.round(s.headshotRate * 100) : -1;
    if (force || hs !== k.hs) { k.hs = hs; this.statV.hs.textContent = formatPercent(s.headshotRate); }
    const rt = s.medianRtMs >= 0 ? Math.round(s.medianRtMs) : -1;
    if (force || rt !== k.rt) { k.rt = rt; this.statV.rt.textContent = formatMs(s.medianRtMs); }
    const ttk = s.medianTtkMs >= 0 ? Math.round(s.medianTtkMs / 10) : -1;
    if (force || ttk !== k.ttk) { k.ttk = ttk; this.statV.ttk.textContent = formatSeconds(s.medianTtkMs); }
    if (force || s.movingShots !== k.moving) {
      k.moving = s.movingShots;
      this.statV.moving.textContent = String(s.movingShots);
      this.el.moving.classList.toggle('warn', s.movingShots > 0);
    }
  }

  // ---- event handlers -------------------------------------------------------------------------

  private onRunReady(): void {
    this.score = 0;
    this.chain = 0;
    this.streak = 0;
    this.setScore(0);
    this.onChain(0);
    this.setStreak(0, 1);
    const h = this.d.health;
    // A shielded fight shows its health and shield from the start (the shield is part of the plan).
    if (h && (h.maxShield > 0 || this.hpAlwaysShown)) this.setHp(h.hp, h.maxHp, h.shield, h.maxShield);
    else this.setHp(null);
    this.paceDirty = true;
    this.refreshStats(true);
    this.refreshEdge();
  }

  private onScore(total: number): void {
    this.score = total;
    this.setScore(total);
    restart(this.scoreV, 'pop');
    this.paceDirty = true;
  }

  private setScore(total: number): void {
    this.scoreV.textContent = formatScore(total);
  }

  private onChain(count: number): void {
    const text = chainText(count, this.d.hud.chainShowFrom, this.d.hud.chainLabels);
    const shown = text !== '';
    this.el.chain.classList.toggle('off', !shown);
    if (shown) {
      this.chainV.textContent = text;
      if (count > this.chain) restart(this.chainV, 'pop');
    }
    this.chain = count;
  }

  private onStreak(streak: number, mult: number): void {
    const broke = streak === 0 && this.streak > 0;
    this.setStreak(streak, mult);
    if (broke) restart(this.el.streak, 'broke');
    else if (streak > 0) restart(this.ringNum, 'pop');
  }

  private setStreak(streak: number, mult: number): void {
    this.streak = streak;
    this.ringNum.textContent = String(streak);
    this.ringV.style.setProperty('--f', String(Math.min(1, streak / this.d.streakCap) ));
    this.multV.textContent = formatMult(mult);
    const tier = mult >= 2.95 ? 3 : mult >= 2 ? 2 : mult >= 1.4 ? 1 : 0;
    this.el.multiplier.dataset.tier = String(tier);
  }

  private updatePace(c: HudClock): void {
    let frac = NaN;
    let delta = 0;
    if (c.phase === 'live' && c.modeId !== null) {
      const p = this.pace.pace();
      if (p !== null) {
        frac = paceFraction(p.score, p.reference, this.d.hud);
        delta = p.score - p.reference;
      }
    }
    const visible = !Number.isNaN(frac);
    if (visible !== this.paceVisible) {
      this.paceVisible = visible;
      this.el.ghost.classList.toggle('off', !visible);
    }
    if (!visible) {
      this.paceKey = NaN;
      return;
    }
    const key = Math.round(frac * 200) * 100000 + Math.round(delta);
    if (key === this.paceKey) return;
    this.paceKey = key;
    this.ghostAhead.style.transform = `scaleX(${Math.max(frac, 0)})`;
    this.ghostBehind.style.transform = `scaleX(${Math.max(-frac, 0)})`;
    this.ghostText.textContent = `${formatDelta(delta)} vs best run`;
    this.el.ghost.dataset.pace = frac > 0.02 ? 'ahead' : frac < -0.02 ? 'behind' : 'level';
  }

  /** Changes whenever the displayed edge figure would. */
  private edgeKey(): number {
    const e = this.d.edge;
    return e.count === 0 ? -1 : Math.round(e.rate * 1000) * 64 + e.count;
  }

  private refreshEdge(): void {
    const e = this.d.edge;
    this.lastEdgeKey = this.edgeKey();
    if (e.count === 0) {
      this.edgeNum.textContent = '–';
      this.edgeFill.style.transform = 'scaleX(0)';
      this.el.edge.dataset.zone = 'none';
      return;
    }
    const r = e.rate;
    this.edgeNum.textContent = formatPercent(r);
    this.edgeFill.style.transform = `scaleX(${r})`;
    const z = this.d.hud;
    this.el.edge.dataset.zone = r < z.edgeZoneLo - 1e-9 ? 'below' : r > z.edgeZoneHi + 1e-9 ? 'above' : 'in';
  }

  private applySettings(h: Readonly<HudSettings>): void {
    for (const id of HUD_ELEMENTS) this.el[id].hidden = !h.show[id];
    this.root.style.setProperty('--hud-scale', String(h.scale));
  }
}
