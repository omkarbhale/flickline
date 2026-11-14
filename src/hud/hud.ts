import type { Subscribable } from '../core/eventBus';
import type { SessionStats } from '../feedback/sessionStats';
import type { WeaponTable } from '../config/weapon';
import type { SimEvents, WeaponState } from '../sim/types';

/**
 * In-game overlay: crosshair, hit marker, session counters. DOM is written only from events
 * (never per frame). The hit marker restarts a CSS animation by toggling a class.
 */
export class Hud {
  private readonly hitMarker: HTMLElement;
  private readonly counters: HTMLElement;
  private readonly ammo: HTMLElement;
  readonly root: HTMLElement;

  constructor(
    root: HTMLElement,
    bus: Subscribable<SimEvents>,
    private readonly stats: SessionStats,
    private readonly weapon: WeaponState,
    private readonly weapons: WeaponTable,
  ) {
    this.root = root;
    root.innerHTML = `
      <div class="crosshair"><i class="ch-t"></i><i class="ch-b"></i><i class="ch-l"></i><i class="ch-r"></i><i class="ch-dot"></i></div>
      <div class="hitmarker"><i></i><i></i><i></i><i></i></div>
      <div class="counters"></div>
      <div class="ammo"></div>`;
    this.hitMarker = root.querySelector('.hitmarker') as HTMLElement;
    this.counters = root.querySelector('.counters') as HTMLElement;
    this.ammo = root.querySelector('.ammo') as HTMLElement;

    bus.on('targetHit', () => this.flash(false));
    bus.on('targetKilled', () => this.flash(true));
    bus.on('shotFired', () => this.refresh());
    bus.on('targetHit', () => this.refresh());
    bus.on('reloadStarted', () => this.refresh());
    bus.on('reloadCompleted', () => this.refresh());
    bus.on('reloadCancelled', () => this.refresh());
    bus.on('weaponSwitched', () => this.refresh());
    this.refresh();
  }

  private flash(kill: boolean): void {
    const el = this.hitMarker;
    el.classList.remove('show', 'kill');
    void el.offsetWidth; // restart the animation
    el.classList.add('show');
    if (kill) el.classList.add('kill');
  }

  /** Rewrite the counters and ammo text (called from events only). */
  refresh(): void {
    const s = this.stats;
    this.counters.textContent = `KILLS ${s.kills}   ACC ${(s.accuracy * 100).toFixed(0)}%`;
    const w = this.weapon;
    const slot = w.slots[w.active];
    if (!slot) return;
    const name = this.weapons[slot.id].name.toUpperCase();
    const mag = w.infiniteMagazine ? '\u221e' : String(slot.mag);
    const reserve = w.infiniteReserve ? '\u221e' : String(slot.reserve);
    this.ammo.textContent = `${name}   ${mag} / ${reserve}${w.reloadLeft > 0 ? '   RELOADING' : ''}`;
  }

  setVisible(v: boolean): void {
    this.root.style.display = v ? '' : 'none';
  }
}
