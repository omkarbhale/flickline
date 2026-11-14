import type { Subscribable } from '../core/eventBus';
import { colorToHex, type CrosshairParams } from '../settings/crosshair';
import type { SettingsEvents } from '../settings/settings';
import type { ModeEvents } from '../modes/contracts';
import type { SimEvents } from '../sim/types';
import { CrosshairView } from './crosshairView';
import { LiveHud, type LiveHudDeps } from './liveHud';

/**
 * In-game overlay: crosshair, hit marker and the live HUD (`LiveHud`: timer, score, counters, stat
 * strip, ghost-pace, edge meter, ammo). DOM is written only from events and on change (never per
 * frame, except the run clock in `update()`). The hit marker restarts a CSS animation by swapping
 * the animation name, which needs no forced reflow.
 */
export class Hud {
  private readonly hitMarker: HTMLElement;
  private hitFlip = false;
  readonly root: HTMLElement;
  /** The crosshair canvas; redraws only on change (see `CrosshairView`). */
  readonly crosshair: CrosshairView;
  /** The live readouts (design §7.2, §13.1). */
  readonly live: LiveHud;

  constructor(
    root: HTMLElement,
    bus: Subscribable<SimEvents & SettingsEvents & ModeEvents>,
    crosshair: Readonly<CrosshairParams>,
    liveDeps: LiveHudDeps,
  ) {
    this.root = root;
    root.innerHTML = `<div class="hitmarker"><i></i><i></i><i></i><i></i></div>`;
    this.hitMarker = root.querySelector('.hitmarker') as HTMLElement;
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
    });

    bus.on('targetHit', () => this.flash(false));
    bus.on('targetKilled', () => this.flash(true));
  }

  private applyHitColor(p: Readonly<CrosshairParams>): void {
    this.root.style.setProperty('--hit-color', colorToHex(p.hitMarkerColor));
  }

  private flash(kill: boolean): void {
    const el = this.hitMarker;
    this.hitFlip = !this.hitFlip;
    el.classList.toggle('flip', this.hitFlip);
    el.classList.add('show');
    el.classList.toggle('kill', kill);
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
