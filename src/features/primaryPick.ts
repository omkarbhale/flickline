import { defineFeature } from '../app/feature';
import type { WeaponId } from '../config/weapon';
import { SWEEP_MODE } from '../modes/sweep';

declare module '../debug/hook' {
  interface FlicklineDebug {
    /**
     * The primary pick of Sweep's `ready` screen (design §4.1, #207). `state()`: the primary the next
     * run carries (the last pick, kept in the save), whether the screen is up and its seconds left.
     * `pick(id)`: press the key of `id` (`kestrel`, `vane`, `rill`): it becomes the primary and the run
     * starts at its next tick. False when no run waits on the screen or `id` is not a pick.
     */
    readonly primaryPick: {
      state(): { primary: string; screenUp: boolean; leftSec: number; saved: string };
      pick(id: string): boolean;
    };
  }
}

/** Number-row and keypad digits `1`..`3` -> index of the pick. */
const KEY_INDEX: Readonly<Record<string, number>> = { Digit1: 0, Digit2: 1, Digit3: 2, Numpad1: 0, Numpad2: 1, Numpad3: 2 };

/**
 * The primary pick (design §4.1): Sweep's `ready` screen offers Kestrel, Vane and Rill on `1`..`3`
 * (the sidearm is always Pace); the last pick is the default, kept in the save, and a pick starts the run
 * at once. Without a pick the screen times out on the default (`sweep.pick.readySec`). Presentation:
 * the screen is DOM written from events, plus one text write per second for the countdown.
 */
export const feature = defineFeature({
  id: 'primaryPick',
  stage: 'presentation',
  setup(game) {
    const cfg = game.tunables.sweep.pick;
    const store = game.progress;

    // The default is the last pick, if the save has one and it is still a pick.
    if (store.lastPrimary) game.modes.setPrimary(store.lastPrimary);

    const root = document.createElement('div');
    root.className = 'ready-pick';
    root.hidden = true;
    root.setAttribute('role', 'group');
    root.setAttribute('aria-label', 'Pick your primary');
    const title = document.createElement('div');
    title.className = 'rp-title';
    title.textContent = 'Pick your primary';
    const row = document.createElement('div');
    row.className = 'rp-row';
    const slots: HTMLElement[] = [];
    cfg.primaries.forEach((id, i) => {
      const def = game.tunables.weapon[id];
      const el = document.createElement('div');
      el.className = 'rp-slot';
      el.dataset.id = id;
      const key = document.createElement('b');
      key.textContent = String(i + 1);
      const name = document.createElement('span');
      name.textContent = def.name;
      el.append(key, name);
      row.appendChild(el);
      slots.push(el);
    });
    const hint = document.createElement('div');
    hint.className = 'rp-hint';
    root.append(title, row, hint);
    game.hud.root.appendChild(root);

    let shown = false;
    let lastSec = -1;
    let lastPrimary = '';
    const draw = (): void => {
      const primary = game.modes.primary;
      const left = Math.max(0, Math.ceil(game.modes.runner.readyLeftSec));
      if (primary === lastPrimary && left === lastSec) return;
      lastPrimary = primary;
      lastSec = left;
      for (const el of slots) el.classList.toggle('on', el.dataset.id === primary);
      hint.textContent = `Press 1–3 to pick and go · starting with ${game.tunables.weapon[primary].name} in ${left}`;
    };
    const show = (on: boolean): void => {
      if (on === shown) return;
      shown = on;
      root.hidden = !on;
      if (on) {
        lastSec = -1;
        lastPrimary = '';
        draw();
      }
    };
    const up = (): boolean => game.modes.modeId === SWEEP_MODE && game.modes.phase === 'ready';

    game.bus.on('runReady', (e) => show(e.mode === SWEEP_MODE));
    game.bus.on('runStarted', () => show(false));
    game.bus.on('runEnded', () => show(false));
    game.onReset(() => {
      if (!up()) show(false);
    });
    game.onFrame(() => {
      if (shown) draw();
    });
    game.bus.on('primaryPicked', (e) => store.setLastPrimary(e.weapon));

    window.addEventListener('keydown', (e) => {
      if (e.repeat || !shown || !up() || !game.input.locked) return;
      const i = KEY_INDEX[e.code];
      const id = i === undefined ? undefined : cfg.primaries[i];
      if (id === undefined) return;
      e.preventDefault();
      game.modes.pickPrimary(id);
    });

    game.addOverlayLines(() => (shown ? `ready: primary ${game.modes.primary}` : ''));
    game.addDebug({
      primaryPick: {
        state: () => ({ primary: game.modes.primary as WeaponId, screenUp: shown, leftSec: game.modes.runner.readyLeftSec, saved: store.lastPrimary }),
        pick(id) {
          const ok = game.modes.pickPrimary(id);
          if (ok) game.renderNow();
          return ok;
        },
      },
    });
  },
});
