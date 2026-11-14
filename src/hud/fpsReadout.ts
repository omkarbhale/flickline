import type { PerfStats } from '../debug/perfStats';

/**
 * The frame rate and the 1% lows in a corner of the screen (design §13.3 "show FPS and 1% lows"),
 * for players: unlike the debug overlay it is one quiet line. The 1% low is the frame rate of the
 * slowest 1% of recent frames (`1000 / p99 frame time`). The text is written at 4 Hz at most and
 * only while shown, never per frame; hidden it costs one boolean test.
 */
export class FpsReadout {
  readonly el: HTMLElement;
  private visible = false;
  private nextAt = 0;
  private last = '';

  constructor(parent: HTMLElement, private readonly perf: PerfStats) {
    this.el = document.createElement('div');
    this.el.className = 'fps-readout';
    this.el.setAttribute('aria-hidden', 'true');
    this.el.hidden = true;
    parent.append(this.el);
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.el.hidden = !v;
    this.nextAt = 0;
  }

  get isVisible(): boolean {
    return this.visible;
  }

  /** Call once per drawn frame with the rAF timestamp. */
  update(nowMs: number): void {
    if (!this.visible || nowMs < this.nextAt) return;
    this.nextAt = nowMs + 250;
    const p = this.perf;
    const text = p.fps > 0 ? `${Math.round(p.fps)} fps · 1% low ${p.p99Ms > 0 ? Math.round(1000 / p.p99Ms) : '–'}` : '';
    if (text === this.last) return;
    this.last = text;
    this.el.textContent = text;
  }
}
