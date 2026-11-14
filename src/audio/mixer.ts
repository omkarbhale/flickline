/** Pure mixing helpers (no Web Audio): decibels, ladder step clamp. */

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

export function gainToDb(gain: number): number {
  return 20 * Math.log10(Math.max(gain, 1e-9));
}

/** Kill ladder step for a clean streak: 1..maxStep (a streak of 0 or less still chimes at step 1). */
export function ladderStep(streak: number, maxStep: number): number {
  if (!Number.isFinite(streak)) return 1;
  return Math.min(maxStep, Math.max(1, Math.floor(streak)));
}

/**
 * Static soft-limiter transfer curve over input -1..1 (WaveShaper): identity up to the threshold,
 * then a tanh shoulder that approaches (never exceeds) full scale. Not a compressor: no attack or
 * release, so it adds no latency and never touches a signal below the threshold.
 */
export function softLimiterCurve(thresholdDb: number, points = 2049): Float32Array<ArrayBuffer> {
  const th = dbToGain(thresholdDb);
  const out = new Float32Array(points);
  for (let i = 0; i < points; i++) {
    const x = (i / (points - 1)) * 2 - 1;
    const a = Math.abs(x);
    const y = a <= th ? a : th + (1 - th) * Math.tanh((a - th) / (1 - th));
    out[i] = Math.sign(x) * Math.min(y, 0.999);
  }
  return out;
}

/**
 * How far (dB, positive) the weapons bus is ducked under a hit or kill cue peaking at `cuePeakDb`:
 * enough to keep the weapons `dominanceDb` under it, never less than the design's `minDb` (3).
 */
export function duckDepthDb(cuePeakDb: number, duck: { db: number; dominanceDb: number; weaponsPeakDb: number }): number {
  return Math.max(-duck.db, duck.weaponsPeakDb - (cuePeakDb - duck.dominanceDb));
}
