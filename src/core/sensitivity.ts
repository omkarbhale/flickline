/**
 * Mouse sensitivity conversion.
 *
 * Sensitivity is stored in the reference tactical shooter's scale so a player can type their
 * existing number. One mouse count turns the view by `DEGREES_PER_COUNT * sensitivity` degrees,
 * for both yaw and pitch (the reference uses the same factor on both axes).
 *
 *   cm/360 = 360 / (DEGREES_PER_COUNT * sens * dpi) * 2.54
 *
 * Check: sens 0.4 @ 800 DPI -> 40.8 cm/360.
 */
export const DEGREES_PER_COUNT = 0.07;
const CM_PER_INCH = 2.54;

/** Degrees of view rotation per raw mouse count. */
export function degreesPerCount(sensitivity: number): number {
  return DEGREES_PER_COUNT * sensitivity;
}

export function cmPer360(sensitivity: number, dpi: number): number {
  return (360 / (DEGREES_PER_COUNT * sensitivity * dpi)) * CM_PER_INCH;
}

/** Inverse of cmPer360: the sensitivity that gives `cm` per 360 at `dpi`. */
export function sensitivityFromCmPer360(cm: number, dpi: number): number {
  return (360 * CM_PER_INCH) / (DEGREES_PER_COUNT * cm * dpi);
}
