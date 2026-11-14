import { colorToHex, type CrosshairParams } from '../settings/crosshair';
import { computeCrosshairLayout, createLayout, LAYER_OUTLINE } from './crosshairLayout';

const SPREAD_STEP_MS = 80;

/**
 * Draws a crosshair on one 2D canvas, centred in its container.
 *
 * Redraws ONLY on a change: new parameters, a container/DPR resize, or one of the three discrete
 * spread steps after a moving shot (open -> half -> closed, driven by timeouts). There is no
 * per-frame work and nothing here allocates per draw; `draws` counts redraws so the debug overlay
 * can prove it.
 */
export class CrosshairView {
  readonly canvas: HTMLCanvasElement;
  /** Number of canvas redraws so far (debug counter). */
  draws = 0;

  private readonly ctx: CanvasRenderingContext2D;
  private readonly layout = createLayout();
  private readonly observer: ResizeObserver;
  private params: CrosshairParams;
  /** 0 = closed, 1 = half open, 2 = fully open. */
  private spreadStep = 0;
  private timer = 0;
  private lastW = 0;
  private lastH = 0;
  private lastDpr = 0;
  private lastCanvasW = 0;
  private lastCanvasH = 0;

  constructor(private readonly container: HTMLElement, params: Readonly<CrosshairParams>) {
    this.params = params as CrosshairParams;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'crosshair-canvas';
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable');
    this.ctx = ctx;
    container.appendChild(this.canvas);
    this.observer = new ResizeObserver(this.onResize);
    this.observer.observe(container);
    window.addEventListener('resize', this.onResize);
    this.redraw();
  }

  setParams(params: Readonly<CrosshairParams>): void {
    this.params = params as CrosshairParams;
    this.redraw();
  }

  /** A shot was fired while moving too fast: open the spread, then close it in steps. */
  pulse(): void {
    if (!this.params.firingError.show) return;
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(this.closeStep, SPREAD_STEP_MS);
    if (this.spreadStep !== 2) {
      this.spreadStep = 2;
      this.redraw();
    }
  }

  dispose(): void {
    window.clearTimeout(this.timer);
    this.observer.disconnect();
    window.removeEventListener('resize', this.onResize);
    this.canvas.remove();
  }

  private readonly closeStep = (): void => {
    this.spreadStep--;
    if (this.spreadStep > 0) this.timer = window.setTimeout(this.closeStep, SPREAD_STEP_MS);
    this.redraw();
  };

  private readonly onResize = (): void => {
    this.redraw();
  };

  /** Recompute the layout and repaint. Exposed so the editor can force it after showing a hidden panel. */
  redraw(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w === 0 || h === 0) return; // hidden: the ResizeObserver redraws when it is shown
    const dpr = window.devicePixelRatio || 1;
    const L = this.layout;
    computeCrosshairLayout(this.params, this.spreadStep / 2, w, h, dpr, L);
    this.lastW = w; this.lastH = h; this.lastDpr = dpr;

    const c = this.canvas;
    if (L.canvasW !== this.lastCanvasW || L.canvasH !== this.lastCanvasH) {
      c.width = L.canvasW; // also clears; sized 1:1 with device pixels
      c.height = L.canvasH;
      c.style.width = `${L.canvasW / dpr}px`;
      c.style.height = `${L.canvasH / dpr}px`;
      this.lastCanvasW = L.canvasW; this.lastCanvasH = L.canvasH;
    }
    // A transform, not left/top: some browsers snap fractional layout offsets to whole CSS pixels
    // (off by a device pixel at DPR 1.25 / 2); the compositor places a transform on device pixels.
    c.style.transform = `translate(${L.canvasLeft / dpr}px, ${L.canvasTop / dpr}px)`;

    const ctx = this.ctx;
    ctx.clearRect(0, 0, L.canvasW, L.canvasH);
    const fill = colorToHex(this.params.color);
    for (let i = 0; i < L.count; i++) {
      const r = L.rects[i]!;
      ctx.globalAlpha = r.alpha;
      ctx.fillStyle = r.layer === LAYER_OUTLINE ? '#000' : fill;
      ctx.fillRect(r.x, r.y, r.w, r.h);
    }
    ctx.globalAlpha = 1;
    this.draws++;
  }

  /** Device-pixel geometry of the last draw, for tests and the debug hook. */
  describe(): { containerW: number; containerH: number; dpr: number; canvasW: number; canvasH: number; left: number; top: number } {
    return {
      containerW: this.lastW, containerH: this.lastH, dpr: this.lastDpr,
      canvasW: this.layout.canvasW, canvasH: this.layout.canvasH,
      left: this.layout.canvasLeft, top: this.layout.canvasTop,
    };
  }
}
