import { defineFeature } from '../app/feature';
import type { Screen } from '../ui/navigation';
import type { SettingsTab } from '../ui/settingsPanel';

declare module '../debug/hook' {
  interface FlicklineDebug {
    /** Menu shell for playtests (pointer lock cannot be taken headlessly). */
    readonly menu: {
      /** Which screen shows, whether the menu is open, its buttons and the focus. */
      state(): unknown;
      /** Show a screen without a pointer-lock change (`settings` returns to where it came from). */
      show(screen: Screen): void;
      /** Switch the settings screen to a group: mouse, keys, audio, graphics, gameplay or data. */
      tab(id: SettingsTab): void;
      /** Press Play: a Sweep run on a new seed (the first one applies the self-report). */
      play(): void;
      /** Press New run (the pause menu's button): the mode in progress on a new seed. */
      newRun(): void;
    };
  }
}

/** Debug access to the menu shell: read what is shown, switch screens, press its buttons. */
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
            settingsTab: game.menu.settingsTab,
            open: game.menu.isOpen,
            buttons: Array.from(root.querySelectorAll<HTMLElement>('.screen:not([hidden]) button')).map((b) => b.innerText.replace(/\s+/g, ' ').trim()),
            text: Array.from(root.querySelectorAll<HTMLElement>('.screen:not([hidden])')).map((e) => e.innerText.replace(/\s+/g, ' ').trim()).join(' | '),
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
        tab(id) {
          game.menu.setVisible(true);
          game.menu.openSettings();
          game.menu.selectSettingsTab(id);
        },
        play: () => game.playRun(),
        newRun: () => game.newRun(),
      },
    });
  },
});
