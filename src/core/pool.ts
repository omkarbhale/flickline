/**
 * Fixed-capacity object pool for transient things (tracers, impacts, particles).
 * Objects are created once up front; acquire() returns null when exhausted (callers should
 * recycle the oldest or skip the effect rather than allocate).
 */
export class Pool<T> {
  private readonly free: T[] = [];
  readonly all: T[] = [];

  constructor(
    readonly capacity: number,
    create: () => T,
  ) {
    for (let i = 0; i < capacity; i++) {
      const o = create();
      this.all.push(o);
      this.free.push(o);
    }
  }

  acquire(): T | null {
    return this.free.pop() ?? null;
  }

  release(o: T): void {
    this.free.push(o);
  }

  get available(): number {
    return this.free.length;
  }
}
