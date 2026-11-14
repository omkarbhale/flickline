import type { Subscribable } from '../core/eventBus';
import type { SessionStats } from '../feedback/sessionStats';
import type { SimEvents } from '../sim/types';

/**
 * In-game overlay: crosshair, hit marker, session counters. DOM is written only from events
 * (never per frame). The hit marker restarts a CSS animation by toggling a class.
 */
export class Hud {
  private readonly hitMarker: HTMLElement;
  private readonly counters: HTMLElement;
  readonly root: HTMLElement;

  constructor(root: HTMLElement, bus: Subscribable<SimEvents>, private readonly stats: SessionStats) {
    this.root = root;
    root.innerHTML = `
      <div class="crosshair"><i class="ch-t"></i><i class="ch-b"></i><i class="ch-l"></i><i class="ch-r"></i><i class="ch-dot"></i></div>
      <div class="hitmarker"><i></i><i></i><i></i><i></i></div>
      <div class="counters"></div>`;
    this.hitMarker = root.querySelector('.hitmarker') as HTMLElement;
    this.counters = root.querySelector('.counters') as HTMLElement;

    bus.on('targetHit', () => this.flash(false));
    bus.on('targetKilled', () => this.flash(true));
    bus.on('shotFired', () => this.refresh());
    bus.on('targetHit', () => this.refresh());
    this.refresh();
  }

  private flash(kill: boolean): void {
    const el = this.hitMarker;
    el.classList.remove('show', 'kill');
    void el.offsetWidth; // restart the animation
    el.classList.add('show');
    if (kill) el.classList.add('kill');
  }

  refresh(): void {
    const s = this.stats;
    this.counters.textContent = `KILLS ${s.kills}   ACC ${(s.accuracy * 100).toFixed(0)}%`;
  }

  setVisible(v: boolean): void {
    this.root.style.display = v ? '' : 'none';
  }
}
