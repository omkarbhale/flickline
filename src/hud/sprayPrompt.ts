import type { Subscribable } from '../core/eventBus';
import type { SprayEvents } from '../sim/runEvents';
import type { WeaponEvents } from '../sim/weapon';
import type { ModeEvents } from '../modes/contracts';

type PromptEvents = SprayEvents & Pick<WeaponEvents, 'shotFired' | 'reloadStarted' | 'reloadCompleted'> & Pick<ModeEvents, 'runReady' | 'runEnded'>;

/**
 * Spray Wall's own readout (design §4.5): the bullet count of the spray in progress, then how the
 * spray did and, until the reload starts, the reload prompt (magazines are real here). Written
 * only from events, never per frame; CSS does the pulsing.
 */
export class SprayPrompt {
  private readonly el: HTMLElement;
  private readonly count: HTMLElement;
  private readonly reload: HTMLElement;
  private burst = 0;
  private fired = 0;
  private active = false;
  /** A reload is under way (a full-magazine spray starts one on its last round, the same tick the spray is judged). */
  private reloading = false;

  constructor(root: HTMLElement, bus: Subscribable<PromptEvents>, reloadKey: string) {
    this.el = document.createElement('div');
    this.el.className = 'spray-prompt';
    this.el.hidden = true;
    this.el.setAttribute('aria-live', 'polite');
    this.el.innerHTML = '<div class="sp-count"></div><div class="sp-reload" hidden><b></b> to reload</div>';
    this.count = this.el.querySelector('.sp-count') as HTMLElement;
    this.reload = this.el.querySelector('.sp-reload') as HTMLElement;
    (this.reload.querySelector('b') as HTMLElement).textContent = reloadKey;
    root.appendChild(this.el);

    bus.on('runReady', () => {
      this.reloading = false;
      this.hide();
    });
    bus.on('runEnded', () => this.hide());
    bus.on('sprayStarted', (e) => {
      this.burst = e.burst;
      this.fired = 0;
      this.active = true;
      this.showCount(0);
    });
    bus.on('shotFired', () => {
      if (!this.active || this.fired >= this.burst) return;
      this.showCount(++this.fired);
    });
    bus.on('sprayEnded', (e) => {
      this.active = false;
      const pct = Math.round(e.fraction * 100);
      this.count.textContent = `${e.hits} / ${e.burst} on the wall · ${pct}% (need ${Math.round(e.requiredFraction * 100)}%)`;
      this.count.classList.toggle('good', e.success);
      this.count.classList.toggle('bad', !e.success);
      this.reload.hidden = this.reloading;
    });
    bus.on('reloadStarted', () => {
      this.reloading = true;
      this.reload.hidden = true;
    });
    bus.on('reloadCompleted', () => {
      this.reloading = false;
    });
  }

  private showCount(n: number): void {
    this.el.hidden = false;
    this.reload.hidden = true;
    this.count.classList.remove('good', 'bad');
    this.count.textContent = `${n} / ${this.burst}`;
  }

  private hide(): void {
    this.active = false;
    this.el.hidden = true;
    this.reload.hidden = true;
  }
}
