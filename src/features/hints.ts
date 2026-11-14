import { defineFeature } from '../app/feature';
import { TICK_DT } from '../core/time';
import type { HintId } from '../config/hints';
import { HintRules } from '../feedback/hints';
import { restartAnimation } from '../hud/restartAnimation';

declare module '../debug/hook' {
  interface FlicklineDebug {
    /**
     * The one-time hints (design 13.4). `show(id)` shows a hint as its trigger would (false when it was
     * already shown: each shows once, ever); the gate hint `pickDoor` has no trigger until gates exist (#205),
     * which calls the same path. `state()` reads which were shown and what the lines say right now.
     */
    readonly hints: {
      show(id: HintId): boolean;
      state(): { seen: readonly string[]; hint: string; ask: string };
    };
  }
}

/**
 * Presentation of the one-time in-world hints (design §13.4) and of the "press Backspace again" ask
 * (design §2.3). The pure rules are `feedback/hints.ts`; this subscribes to the events they read, writes one
 * short line near the crosshair (DOM, from events only, faded by a CSS animation) and stores which hints were
 * shown in the profile so each shows once and never again after a reload.
 */
export const feature = defineFeature({
  id: 'hints',
  stage: 'presentation',
  setup(game) {
    const cfg = game.tunables.hints;
    const rules = new HintRules(game.profile.get().hintsSeen, cfg, TICK_DT);
    const root = game.hud.root;
    const make = (cls: string): HTMLElement => {
      const el = document.createElement('div');
      el.className = `hint-line ${cls}`;
      el.setAttribute('role', 'status');
      el.style.setProperty('--hint-ms', `${cfg.showSec * 1000}ms`);
      root.appendChild(el);
      return el;
    };
    const hintEl = make('hint');
    const askEl = make('ask');
    askEl.style.setProperty('--hint-ms', `${cfg.discardWindowSec * 1000}ms`);

    const write = (el: HTMLElement, text: string): void => {
      el.textContent = text;
      restartAnimation(el, 'hint-show');
    };
    const hide = (el: HTMLElement): void => {
      el.classList.remove('hint-show', 'hint-show-b');
      el.textContent = '';
    };
    /** A hint is owed: store that it was shown, then show it. */
    const owed = (id: HintId): void => {
      game.profile.set({ hintsSeen: rules.shown() });
      write(hintEl, cfg.text[id]);
    };

    game.bus.on('shotFired', (e) => rules.onShot(e.shotId, e.moving, e.aimTargetId >= 0));
    game.bus.on('shotImpact', (e) => {
      if (rules.onShotEnded(e.shotId, e.result === 'hit')) owed('stopToShoot');
    });
    game.bus.on('footstep', (e) => rules.onFootstep(e.tick, e.walking, e.crouching));
    game.bus.on('enemySawPlayer', (e) => {
      if (rules.onEchoNoticed(e.tick, e.initiator === 'enemy')) owed('walkQuiet');
    });
    game.bus.on('runDiscardAsked', () => write(askEl, cfg.discardText));
    game.bus.on('runReady', () => hide(askEl));
    game.onReset(() => {
      hide(hintEl);
      hide(askEl);
    });

    game.addDebug({
      hints: {
        show(id) {
          if (!rules.claim(id)) return false;
          owed(id);
          return true;
        },
        state: () => ({ seen: rules.shown(), hint: hintEl.textContent ?? '', ask: askEl.textContent ?? '' }),
      },
    });
  },
});
