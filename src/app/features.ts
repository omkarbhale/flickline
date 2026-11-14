import { orderFeatures, type Feature } from './feature';

/**
 * Every feature module in `src/features/`, checked and in setup order. Vite's eager glob turns
 * this into plain static imports at build time, so adding a feature is adding a file.
 */
export const FEATURES: readonly Feature[] = orderFeatures(
  import.meta.glob<{ feature?: Feature }>(['../features/*.ts', '!../features/*.test.ts'], { eager: true }),
);
