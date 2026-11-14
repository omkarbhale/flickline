import type { CuePlayer } from './audioEngine';

/**
 * Menu ticks (design 12 "UI"): one delegated listener, no per-element wiring. A click on a button
 * ticks; the primary "play" button gets the two-note confirm. Menus only exist while the pointer
 * is unlocked, so these never sound mid-run.
 */
export function attachUiSounds(root: Document, audio: CuePlayer): () => void {
  const onClick = (e: Event): void => {
    const el = e.target instanceof Element ? e.target.closest('button') : null;
    if (!el) return;
    audio.play(el.classList.contains('play') ? 'uiConfirm' : 'uiTick');
  };
  root.addEventListener('click', onClick, true);
  return () => root.removeEventListener('click', onClick, true);
}
