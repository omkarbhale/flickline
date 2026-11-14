import type { Tunables } from '../config/tunables';
import type { RenderStats } from '../render/gameRenderer';
import type { PerfStats } from './perfStats';

interface HeapInfo { usedJSHeapSize: number }

/**
 * Debug overlay (toggle with the backtick key). Text is refreshed 4x per second; the frame-time
 * graph (one bar per frame, red above the 144 Hz budget) is a small 2D canvas redrawn every frame
 * only while visible.
 */
export class DebugOverlay {
  private readonly pre: HTMLPreElement;
  private readonly graph: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;
  private nextText = 0;
  private visible = false;
  /** Extra lines supplied by the game (position etc.), refreshed with the text. */
  extra: () => string = () => '';

  constructor(
    private readonly root: HTMLElement,
    private readonly perf: PerfStats,
    private readonly render: RenderStats,
    private readonly tunables: Tunables,
  ) {
    this.pre = document.createElement('pre');
    this.pre.style.margin = '0';
    this.graph = document.createElement('canvas');
    this.graph.width = 240;
    this.graph.height = 40;
    this.g = this.graph.getContext('2d')!;
    root.append(this.pre, this.graph);
  }

  get isVisible(): boolean {
    return this.visible;
  }

  toggle(): void {
    this.setVisible(!this.visible);
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.root.hidden = !v;
  }

  update(nowMs: number): void {
    if (!this.visible) return;
    this.drawGraph();
    if (nowMs < this.nextText) return;
    this.nextText = nowMs + 250;
    const b = this.tunables.render.budget;
    const p = this.perf;
    const r = this.render;
    const bad = (cond: boolean, s: string): string => (cond ? `<span class="bad">${s}</span>` : s);
    const heap = (performance as unknown as { memory?: HeapInfo }).memory;
    const heapMb = heap ? `${(heap.usedJSHeapSize / 1048576).toFixed(1)} MB` : 'n/a';
    this.pre.innerHTML =
      `FPS      ${bad(p.fps < 144, p.fps.toFixed(0))}\n` +
      `frame    avg ${p.avgMs.toFixed(2)}  p99 ${p.p99Ms.toFixed(2)}  max ${p.maxMs.toFixed(2)} ms\n` +
      `cpu/frm  ${bad(p.workMs > b.frameMs, p.workMs.toFixed(2))} ms\n` +
      `sim tick ${bad(p.tickMs > b.tickMs, p.tickMs.toFixed(3))} ms  (${p.ticksLastFrame} ticks last frame)\n` +
      `draws    ${bad(r.drawCalls > b.drawCalls, String(r.drawCalls))}\n` +
      `tris     ${bad(r.triangles > b.triangles, String(r.triangles))}\n` +
      `geo/tex  ${r.geometries}/${r.textures}   JS heap ${heapMb}\n` +
      this.extra();
  }

  private drawGraph(): void {
    const g = this.g;
    const h = this.graph.height;
    const budget = this.tunables.render.budget.frameMs;
    g.clearRect(0, 0, this.graph.width, h);
    const scale = h / (budget * 3); // full height = 3x budget
    this.perf.forEachRecent(this.graph.width, (ms, i) => {
      g.fillStyle = ms > budget * 1.1 ? '#ff6a6a' : '#6aff9c';
      const bh = Math.min(h, ms * scale);
      g.fillRect(i, h - bh, 1, bh);
    });
    g.fillStyle = 'rgba(255,255,255,.4)';
    g.fillRect(0, h - budget * scale, this.graph.width, 1);
  }
}
