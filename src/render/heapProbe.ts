import { runInNewContext } from 'node:vm';
import { setFlagsFromString } from 'node:v8';

/**
 * Test helper: bytes of JS heap retained by running `fn` `iterations` times after a warm-up.
 * Forces full GCs before and after (the flag is switched on at runtime, so no CLI option is
 * needed), so garbage still waiting for collection is not mistaken for a leak, and per-call
 * allocations that die young do not count: this measures what stays, which for a pooled hot path
 * must be ~0. Not used by the game.
 */
export function retainedHeapBytes(fn: () => void, iterations: number, warmup = 3000): number {
  setFlagsFromString('--expose-gc');
  const gc = runInNewContext('gc') as () => void;
  for (let i = 0; i < warmup; i++) fn();
  gc();
  const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < iterations; i++) fn();
  gc();
  return process.memoryUsage().heapUsed - before;
}
