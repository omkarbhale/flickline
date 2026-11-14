import type { CrosshairParams } from '../settings/crosshair';

/**
 * Pure crosshair geometry in DEVICE pixels. No DOM, so it is unit tested at several DPRs.
 *
 * The crosshair canvas has one backing-store pixel per device pixel and an even/odd size that
 * matches the container's device width/height, so its centre is exactly the container centre.
 * Every rectangle has integer edges (no anti-aliasing blur). When a shape's thickness has the
 * opposite parity to the container, it cannot be perfectly symmetric about the centre; it is then
 * biased by exactly half a device pixel (left / up), which is the best any pixel grid can do.
 */

export type LayoutKind = 0 | 1; // 0 = outline, 1 = fill
export const LAYER_OUTLINE = 0;
export const LAYER_FILL = 1;

/** Upper bound on rectangles: 4 inner + 4 outer + 1 dot, each with an outline. */
export const MAX_RECTS = 18;

export interface LayoutRect {
  /** Canvas-space rectangle, integer device pixels. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** `LAYER_OUTLINE` or `LAYER_FILL`. */
  layer: LayoutKind;
  /** Alpha for the group (outline alpha or fill alpha). */
  alpha: number;
}

export interface CrosshairLayout {
  /** Canvas backing-store size and its top-left in container device pixels. */
  canvasW: number;
  canvasH: number;
  canvasLeft: number;
  canvasTop: number;
  rects: LayoutRect[];
  count: number;
}

export function createLayout(): CrosshairLayout {
  const rects: LayoutRect[] = [];
  for (let i = 0; i < MAX_RECTS; i++) rects.push({ x: 0, y: 0, w: 0, h: 0, layer: LAYER_FILL, alpha: 1 });
  return { canvasW: 0, canvasH: 0, canvasLeft: 0, canvasTop: 0, rects, count: 0 };
}

const px = (css: number, dpr: number): number => Math.max(1, Math.round(css * dpr));
const px0 = (css: number, dpr: number): number => Math.max(0, Math.round(css * dpr));

function push(out: CrosshairLayout, x: number, y: number, w: number, h: number, layer: LayoutKind, alpha: number): void {
  const r = out.rects[out.count++]!;
  r.x = x; r.y = y; r.w = w; r.h = h; r.layer = layer; r.alpha = alpha;
}

/**
 * Compute the layout for a container of `containerW x containerH` CSS px at `dpr`.
 * `spread` is 0..1, how far the firing-error spread is open.
 * Writes into `out` (no allocation).
 */
export function computeCrosshairLayout(
  p: CrosshairParams,
  spread: number,
  containerW: number,
  containerH: number,
  dpr: number,
  out: CrosshairLayout,
): void {
  const devW = Math.max(1, Math.round(containerW * dpr));
  const devH = Math.max(1, Math.round(containerH * dpr));
  const extra = p.firingError.show ? px0(p.firingError.amount * spread, dpr) : 0;
  const ol = p.outline.show ? px(p.outline.thickness, dpr) : 0;

  // How far from the centre anything is drawn.
  let reach = 0;
  const innerGap = px0(p.inner.gap, dpr) + extra;
  const innerLen = px(p.inner.length, dpr);
  const outerGap = px0(p.outer.gap, dpr) + extra;
  const outerLen = px(p.outer.length, dpr);
  if (p.inner.show) reach = Math.max(reach, innerGap + innerLen);
  if (p.outer.show) reach = Math.max(reach, outerGap + outerLen);
  const dotSize = px(p.dot.size, dpr);
  if (p.dot.show) reach = Math.max(reach, Math.ceil(dotSize / 2));
  reach += ol + 1;

  // Canvas size shares the container's parity, so the canvas centre IS the container centre.
  const canvasW = 2 * reach + (devW & 1);
  const canvasH = 2 * reach + (devH & 1);
  out.canvasW = canvasW;
  out.canvasH = canvasH;
  out.canvasLeft = (devW - canvasW) / 2;
  out.canvasTop = (devH - canvasH) / 2;
  out.count = 0;

  const cx = canvasW / 2; // integer or x.5
  const cy = canvasH / 2;
  const loX = Math.floor(cx), hiX = Math.ceil(cx);
  const loY = Math.floor(cy), hiY = Math.ceil(cy);

  const arms = (gap: number, len: number, thick: number, layer: LayoutKind, grow: number, alpha: number): void => {
    const t = thick + 2 * grow;
    const l = len + 2 * grow;
    const g = gap - grow;
    const x0 = Math.floor(cx - t / 2);
    const y0 = Math.floor(cy - t / 2);
    push(out, x0, loY - g - l, t, l, layer, alpha); // top
    push(out, x0, hiY + g, t, l, layer, alpha); // bottom
    push(out, loX - g - l, y0, l, t, layer, alpha); // left
    push(out, hiX + g, y0, l, t, layer, alpha); // right
  };
  const dotRect = (layer: LayoutKind, grow: number, alpha: number): void => {
    const s = dotSize + 2 * grow;
    push(out, Math.floor(cx - s / 2), Math.floor(cy - s / 2), s, s, layer, alpha);
  };

  if (ol > 0) {
    if (p.outer.show) arms(outerGap, outerLen, px(p.outer.thickness, dpr), LAYER_OUTLINE, ol, p.outline.opacity);
    if (p.inner.show) arms(innerGap, innerLen, px(p.inner.thickness, dpr), LAYER_OUTLINE, ol, p.outline.opacity);
    if (p.dot.show) dotRect(LAYER_OUTLINE, ol, p.outline.opacity);
  }
  if (p.outer.show) arms(outerGap, outerLen, px(p.outer.thickness, dpr), LAYER_FILL, 0, p.outer.opacity);
  if (p.inner.show) arms(innerGap, innerLen, px(p.inner.thickness, dpr), LAYER_FILL, 0, p.inner.opacity);
  if (p.dot.show) dotRect(LAYER_FILL, 0, p.dot.opacity);
}
