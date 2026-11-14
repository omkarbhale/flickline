/** Anything that can receive events. The sim depends on this, not on a concrete bus. */
export interface EventSink<E> {
  emit<K extends keyof E>(type: K, payload: E[K]): void;
}

type Listener<T> = (payload: T) => void;

/** Sees every event of a bus: `type` and its payload (same lifetime rules as a listener's). */
export type Tap<E> = <K extends keyof E>(type: K, payload: E[K]) => void;

/** Read side of a bus: what presentation code depends on (so any superset bus fits). */
export interface Subscribable<E> {
  on<K extends keyof E>(type: K, fn: Listener<E[K]>): () => void;
}

/**
 * Tiny typed synchronous event bus.
 *
 * Rules:
 *  - Payloads are plain data. Treat them as read-only and valid only during the call: senders on
 *    hot paths may reuse one payload object, so listeners must copy what they keep.
 *  - emit() does not allocate. Subscribing/unsubscribing is copy-on-write, so it is safe during
 *    dispatch (a listener added mid-dispatch first runs on the next emit).
 *  - Listeners must not throw; one throwing listener would skip later ones.
 */
export class EventBus<E> implements EventSink<E>, Subscribable<E> {
  private listeners = new Map<keyof E, Listener<never>[]>();
  private taps: Tap<E>[] = [];

  on<K extends keyof E>(type: K, fn: Listener<E[K]>): () => void {
    const prev = this.listeners.get(type) ?? [];
    this.listeners.set(type, [...prev, fn as Listener<never>]);
    return () => this.off(type, fn);
  }

  off<K extends keyof E>(type: K, fn: Listener<E[K]>): void {
    const prev = this.listeners.get(type);
    if (!prev) return;
    this.listeners.set(
      type,
      prev.filter((l) => l !== (fn as Listener<never>)),
    );
  }

  /**
   * Subscribe to every event type (event logs, test recorders). A tap runs after the type's
   * listeners, so events those listeners emit are seen first. Copy-on-write like `on`.
   */
  onAny(fn: Tap<E>): () => void {
    this.taps = [...this.taps, fn];
    return () => {
      this.taps = this.taps.filter((t) => t !== fn);
    };
  }

  emit<K extends keyof E>(type: K, payload: E[K]): void {
    const list = this.listeners.get(type) as Listener<E[K]>[] | undefined;
    if (list) for (let i = 0; i < list.length; i++) list[i]!(payload);
    const taps = this.taps;
    for (let i = 0; i < taps.length; i++) taps[i]!(type, payload);
  }

  clear(): void {
    this.listeners.clear();
    this.taps = [];
  }
}
