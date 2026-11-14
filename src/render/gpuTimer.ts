/**
 * GPU time of a span of draw calls through `EXT_disjoint_timer_query_webgl2`, for the debug hook
 * only (the post pipeline's `timer` is null unless a command turns it on). A small ring of query
 * objects, polled once a frame without stalling; results arrive a few frames late and feed a
 * running average. Allocation-free after construction. Browsers that do not expose the extension
 * (software rendering, some privacy modes) get `null` from `create`.
 */
interface TimerExt {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
}

const RING = 8;

export class GpuTimer {
  /** Exponential moving average of the timed span, ms (0 until the first result). */
  avgMs = 0;
  /** Largest single result since `reset`, ms. */
  maxMs = 0;
  samples = 0;

  private readonly queries: WebGLQuery[] = [];
  private readonly pending: boolean[] = [];
  private head = 0;
  private open = false;

  private constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly ext: TimerExt,
  ) {
    for (let i = 0; i < RING; i++) {
      this.queries.push(gl.createQuery()!);
      this.pending.push(false);
    }
  }

  static create(gl: WebGL2RenderingContext): GpuTimer | null {
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExt | null;
    return ext ? new GpuTimer(gl, ext) : null;
  }

  begin(): void {
    if (this.open || this.pending[this.head]) return;
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, this.queries[this.head]!);
    this.open = true;
  }

  end(): void {
    if (!this.open) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending[this.head] = true;
    this.head = (this.head + 1) % RING;
    this.open = false;
  }

  /** Collect finished queries (oldest first). Cheap; call once a frame. */
  poll(): void {
    const gl = this.gl;
    const disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT) as boolean;
    for (let n = 0; n < RING; n++) {
      const i = (this.head + n) % RING;
      if (!this.pending[i]) continue;
      const q = this.queries[i]!;
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      this.pending[i] = false;
      if (disjoint) continue;
      const ms = (gl.getQueryParameter(q, gl.QUERY_RESULT) as number) / 1e6;
      this.avgMs = this.samples === 0 ? ms : this.avgMs * 0.95 + ms * 0.05;
      if (ms > this.maxMs) this.maxMs = ms;
      this.samples++;
    }
  }

  reset(): void {
    this.avgMs = this.maxMs = 0;
    this.samples = 0;
  }

  dispose(): void {
    for (const q of this.queries) this.gl.deleteQuery(q);
  }
}
