/**
 * Restart a one-shot CSS animation on `el` without forcing layout or a style flush.
 *
 * The usual `remove class; void el.offsetWidth; add class` trick forces a synchronous reflow on every
 * call. Here each animated class `cls` has a twin `cls-b` with identical rules and identical
 * keyframes under a different name (see styles.css); swapping between them changes the computed
 * `animation-name`, which restarts the animation on the next style recalc with no JS-triggered
 * layout. Architecture §7: no forced reflow in the frame loop.
 */
export function restartAnimation(el: HTMLElement, cls: string): void {
  const b = `${cls}-b`;
  if (el.classList.contains(cls)) {
    el.classList.remove(cls);
    el.classList.add(b);
  } else {
    el.classList.remove(b);
    el.classList.add(cls);
  }
}
