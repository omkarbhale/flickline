/** Named wall-clock marks since page load, for first-run timing proof (`__flickline.timeline()`). */
export class Timeline {
  private readonly marks = new Map<string, number>();

  /** Record the first time `name` happens (ms since navigation start). Later calls are ignored. */
  mark(name: string): void {
    if (!this.marks.has(name)) this.marks.set(name, performance.now());
  }

  has(name: string): boolean {
    return this.marks.has(name);
  }

  /** Snapshot as a plain object, in the order the marks happened. */
  toObject(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [k, v] of this.marks) out[k] = Math.round(v);
    return out;
  }
}
