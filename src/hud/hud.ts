import type { Subscribable } from '../core/eventBus';
import type { SessionStats } from '../feedback/sessionStats';
import { colorToHex, type CrosshairParams } from '../settings/crosshair';
import type { SettingsEvents } from '../settings/settings';
import type { SimEvents } from '../sim/types';
import { CrosshairView } from './crosshairView';

/**
 * In-game overlay: crosshair, hit marker, session counters. DOM is written only from events
 * (never per frame). The hit marker restarts a CSS animation by toggling a class.
 */
export class Hud {
  private readonly hitMarker: HTMLElement;
  private readonly counters: HTMLElement;
  readonly root: HTMLElement;
  /** The crosshair canvas; redraws only on change (see `CrosshairView`). */
  readonly crosshair: CrosshairView;

  constructor(
    root: HTMLElement,
    bus: Subscribable<SimEvents & SettingsEvents>,
    private readonly stats: SessionStats,
    crosshair: Readonly<CrosshairParams>,
  ) {
    this.root = root;
    root.innerHTML = `
      <div class="hitmarker"><i></i><i></i><i></i><i></i></div>
      <div class="counters"></div>`;
    this.hitMarker = root.querySelector('.hitmarker') as HTMLElement;
    this.counters = root.querySelector('.counters') as HTMLElement;
    this.crosshair = new CrosshairView(root, crosshair);
    this.applyHitColor(crosshair);

    bus.on('settingsChanged', ({ settings, changed }) => {
      if (!changed.includes('crosshair')) return;
      this.crosshair.setParams(settings.crosshair);
      this.applyHitColor(settings.crosshair);
    });
    bus.on('shotFired', (e) => {
      if (e.moving) this.crosshair.pulse();
    });

    bus.on('targetHit', () => this.flash(false));
    bus.on('targetKilled', () => this.flash(true));
    bus.on('shotFired', () => this.refresh());
    bus.on('targetHit', () => this.refresh());
    this.refresh();
  }

  private applyHitColor(p: Readonly<CrosshairParams>): void {
    this.root.style.setProperty('--hit-color', colorToHex(p.hitMarkerColor));
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
