import { defineFeature } from '../app/feature';
import type { Screen } from '../ui/navigation';

declare module '../debug/hook' {
  interface FlicklineDebug {
    /** Menu shell and Today's session for playtests (pointer lock cannot be taken headlessly). */
    readonly menu: {
      /** Which screen shows, whether the menu is open, the cards and the session. */
      state(): unknown;
      /** Show a screen without a pointer-lock change (`settings` returns to where it came from). */
      show(screen: Screen): void;
      /** The plan Today's session would have right now. */
      plan(): unknown;
      /** Press Play (today's session), skip the current step, or advance after a finished run. */
      play(): void;
      skip(): void;
      next(): void;
      /** Start one mode as a card would (ends the session). */
      launch(modeId: string): void;
    };
  }
}

/** Debug access to the menu shell: read what is shown, switch screens, drive the session. */
export const feature = defineFeature({
  id: 'menuFlow',
  stage: 'tools',
  setup(game) {
    game.addDebug({
      menu: {
        state() {
          const root = document.getElementById('menu')!;
          return {
            screen: game.menu.current,
            open: game.menu.isOpen,
            cards: Array.from(root.querySelectorAll<HTMLElement>('.fl-card')).map((c) => ({
              id: c.dataset.mode,
              text: c.innerText.replace(/\s+/g, ' ').trim(),
            })),
            session: game.todaysSession.view(),
            focus: document.activeElement instanceof HTMLElement ? document.activeElement.className || document.activeElement.tagName : null,
          };
        },
        show(screen) {
          game.menu.setVisible(true);
          if (screen === 'settings') {
            game.menu.openSettings();
            return;
          }
          game.menu.setMode(screen);
        },
        plan: () => game.todaysSession.plan(),
        play: () => game.playSession(),
        skip: () => game.skipStep(),
        next: () => game.nextRun(),
        launch: (id) => {
          game.todaysSession.abandon();
          game.launchMode(id);
        },
      },
    });
  },
});
