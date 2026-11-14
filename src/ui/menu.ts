import { SELF_REPORTS, type SelfReport } from '../config/profile';
import type { MenuTunables } from '../config/menu';
import type { Tunables } from '../config/tunables';
import type { ProfileStore } from '../settings/profile';
import type { SettingsStore } from '../settings/settings';
import { keyLabel, type KeyAction } from '../settings/keys';
import { applyPalette, button, h, panel } from './kit/kit';
import { wordmark } from './kit/wordmark';
import { gridMove, resolveKey, type NavAction, type NavKeys, type NavState, type RunPhase, type Screen } from './navigation';
import { rawInputText } from './rawInputText';
import { SettingsPanel, type SettingsHost, type SettingsTab } from './settingsPanel';

/**
 * - `firstRun`: a new player (design 13.4): compact bottom-centre panel over the live Range (the Lobby)
 *   with the sensitivity field, self-report chips and Play. No tutorial text.
 * - `main`: the landing menu: Play (a Sweep run on a new seed) and settings.
 * - `pause`: the pointer lock was lost (Esc, alt-tab): Click to resume, New run, Settings, Menu.
 * `settings` is reached from `main` and `pause` and goes back to where it came from.
 */
export type MenuMode = 'firstRun' | 'main' | 'pause';

/** What the menu asks of the game, and what it reads from it. */
export interface MenuHost extends SettingsHost {
  /** Play: a Sweep run on a new seed, with the pointer lock (needs a user gesture). The first one applies the self-report. */
  play(): void;
  /** Take the pointer lock back and carry on. */
  resume(): void;
  /** Start a new run on a new seed (and take the lock). */
  newRun(): void;
  /** Leave the run and show the main menu. */
  toMenu(): void;
  /** The run clock's phase (for the in-run keys). */
  runPhase(): RunPhase;
  /** What the pause menu says about the run in progress ("Sweep"), or null when there is none. */
  runLabel(): string | null;
}

/**
 * The menu shell: one router over the screens, built once. Screens are plain DOM written on show
 * (never per frame); the settings form is `SettingsPanel`, and the key rules are `navigation.ts`.
 * Shown whenever the pointer is not locked.
 */
export class Menu {
  private readonly el: HTMLElement;
  private readonly settingsPanel: SettingsPanel;
  private readonly screens: Record<Screen, HTMLElement>;
  private readonly firstRunHost: HTMLElement;
  private readonly settingsBasicsHome: HTMLElement;
  private readonly chips: HTMLButtonElement[];
  private readonly rawNotes: HTMLElement[] = [];
  private readonly pauseSub: HTMLElement;
  private readonly cfg: MenuTunables;
  /** The controls reminder under Play and the New run button's key hint: both follow the player's bindings. */
  private readonly keysLine = h('p', { class: 'keys' });
  private restartBtn!: HTMLButtonElement;
  private screen: Screen = 'main';
  private settingsReturn: Exclude<Screen, 'settings'> = 'main';
  private open = false;
  private playBtn!: HTMLButtonElement;

  constructor(
    root: HTMLElement,
    private readonly store: SettingsStore,
    private readonly profile: ProfileStore,
    tunables: Tunables,
    private readonly host: MenuHost,
  ) {
    this.el = root;
    this.cfg = tunables.menu;
    applyPalette(root);
    root.replaceChildren();

    this.settingsPanel = new SettingsPanel(store, tunables, () => {
      if (this.screen === 'firstRun') host.play();
    }, host);
    this.settingsBasicsHome = this.settingsPanel.basics.parentElement as HTMLElement;

    // --- First run (design 13.4) ---
    const chipRow = h('div', { class: 'chips', attrs: { role: 'group', 'aria-label': 'How experienced are you with shooters?' } });
    this.chips = SELF_REPORTS.map((r) => {
      const c = h('button', { class: 'chip', text: tunables.profile.chipLabels[r], attrs: { type: 'button', 'data-chip': r, 'aria-pressed': 'false' } });
      c.addEventListener('click', () => {
        // Clicking the picked chip again clears it (skip -> prior 40).
        this.profile.set({ selfReport: this.profile.get().selfReport === r ? null : (r as SelfReport) });
        this.sync();
      });
      chipRow.append(c);
      return c;
    });
    this.firstRunHost = h('div', { class: 'first-basics' });
    const firstPlay = button('Play', { variant: 'primary', icon: 'play', key: 'Enter', onClick: () => host.play() });
    firstPlay.classList.add('play-wide');
    const firstPanel = panel({ class: 'first-panel' });
    firstPanel.body.append(
      h('div', { class: 'first-head' }, [wrapHtml(wordmark(22)), h('span', { class: 'first-tag', text: this.cfg.tagline })]),
      this.firstRunHost,
      chipRow,
      firstPlay,
      h('p', { class: 'first-lobby', text: this.cfg.lobbyNote }),
      this.rawNote(),
    );

    // --- Main ---
    this.playBtn = button('Play', { variant: 'primary', icon: 'play', key: 'Enter', onClick: () => host.play() });
    this.playBtn.classList.add('play-wide');
    const settingsBtn = button('Settings', { variant: 'ghost', icon: 'settings', key: 'S', onClick: () => this.openSettings() });
    const mainPanel = panel({ class: 'main-panel' });
    mainPanel.body.append(
      h('div', { class: 'main-brand' }, [wrapHtml(wordmark(40))]),
      h('p', { class: 'main-tag', text: this.cfg.tagline }),
      h('div', { class: 'main-actions' }, [this.playBtn, settingsBtn]),
      this.rawNote(),
      this.keysLine,
    );
    const mainScreen = h('div', { class: 'screen screen-main' }, [mainPanel.el]);

    // --- Pause ---
    this.pauseSub = h('p', { class: 'pause-sub' });
    const pausePanel = panel({ class: 'pause-panel' });
    pausePanel.body.append(
      h('div', { class: 'pause-head' }, [wrapHtml(wordmark(20))]),
      h('h1', { class: 'pause-title', text: 'Paused' }),
      this.pauseSub,
      h('div', { class: 'pause-actions', attrs: { 'data-nav': 'list' } }, [
        button('Click to resume', { variant: 'primary', icon: 'resume', key: 'Esc', onClick: () => host.resume() }),
        (this.restartBtn = button('New run', { icon: 'restart', key: 'Backspace', onClick: () => host.newRun() })),
        button('Settings', { icon: 'settings', key: 'S', onClick: () => this.openSettings() }),
        button('Menu', { icon: 'menu', key: 'M', onClick: () => host.toMenu() }),
      ]),
    );
    const pauseScreen = h('div', { class: 'screen screen-pause' }, [pausePanel.el]);

    // --- Settings ---
    const settingsPanelShell = panel({ class: 'settings-panel' });
    settingsPanelShell.body.append(
      h('div', { class: 'settings-head' }, [
        h('h1', { class: 'settings-title', text: 'Settings' }),
        button('Back', { variant: 'ghost', icon: 'back', key: 'Esc', onClick: () => this.back() }),
      ]),
      this.settingsPanel.el,
    );
    const settingsScreen = h('div', { class: 'screen screen-settings' }, [settingsPanelShell.el]);

    const firstScreen = h('div', { class: 'screen screen-first' }, [firstPanel.el]);
    this.screens = { firstRun: firstScreen, main: mainScreen, pause: pauseScreen, settings: settingsScreen };
    root.append(firstScreen, mainScreen, pauseScreen, settingsScreen);

    // The backdrop of the pause menu resumes (a click is a user gesture, so the pointer lock works).
    root.addEventListener('click', (e) => {
      if (e.target === root && this.screen === 'pause') host.resume();
    });
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('resize', this.fit);
    this.fit();
    root.addEventListener('keydown', this.onArrowKey);

    this.setRawInput(null);
    this.setMode('main');
    this.sync();
  }

  private rawNote(): HTMLElement {
    const p = h('p', { class: 'raw' });
    this.rawNotes.push(p);
    return p;
  }

  // --- State ---------------------------------------------------------------------------------

  /** The primary key of an action as the player sees it ("W", "Backspace"), or an em dash when it is unbound. */
  private keyName(action: KeyAction): string {
    const c = this.store.get().keys[action][0];
    return c === undefined ? '—' : keyLabel(c);
  }

  /** Controls reminder and the New run hint, from the current bindings. */
  private renderKeyHints(): void {
    const n = (a: KeyAction): string => this.keyName(a);
    this.keysLine.textContent =
      `${n('forward')}${n('left')}${n('back')}${n('right')} move · ${n('jump')} jump · ${n('crouch')} crouch · ${n('walk')} walk · LMB shoot · ${n('reload')} reload · ${n('restart')} new run · Esc pause`;
    const kbd = this.restartBtn.querySelector('.fl-kbd');
    if (kbd) kbd.textContent = n('restart');
    if (this.open && this.screen === 'pause') this.renderPause();
  }

  /** Refresh the settings form from the stores. */
  sync(): void {
    this.settingsPanel.sync();
    this.renderKeyHints();
    const picked = this.profile.get().selfReport;
    for (const chip of this.chips) chip.setAttribute('aria-pressed', String(chip.dataset.chip === picked));
  }

  /** Rebuild what the pause screen shows (the run in progress) if it is on screen. */
  refresh(): void {
    if (!this.open) return;
    if (this.screen === 'pause') this.renderPause();
  }

  /** Go to a base screen (the pointer lock changed): the first-run panel, the landing menu or the pause menu. */
  setMode(mode: MenuMode): void {
    this.show(mode);
  }

  private show(screen: Screen): void {
    this.screen = screen;
    this.el.dataset.screen = screen;
    for (const s of Object.keys(this.screens) as Screen[]) this.screens[s].hidden = s !== screen;
    // The sensitivity fields live in the first-run panel on that screen and in the Mouse tab otherwise.
    const home = screen === 'firstRun' ? this.firstRunHost : this.settingsBasicsHome;
    if (this.settingsPanel.basics.parentElement !== home) home.prepend(this.settingsPanel.basics);
    if (screen === 'pause') this.renderPause();
    if (this.open) this.focusDefault();
  }

  /** Show raw-input state of the last lock request (null: not asked yet). `requested`: the setting asked for it. */
  setRawInput(on: boolean | null, requested = true): void {
    const text = rawInputText(on, requested);
    this.settingsPanel.setRawInput(on, requested);
    for (const note of this.rawNotes) {
      note.dataset.state = on === null ? 'unknown' : on ? 'on' : 'off';
      note.textContent = text;
    }
  }

  setVisible(v: boolean): void {
    const was = this.open;
    this.open = v;
    this.el.style.display = v ? '' : 'none';
    this.el.classList.toggle('open', v);
    if (v && !was) {
      this.refresh();
      this.focusDefault();
    }
  }

  /** Which screen is showing (for the debug hook and tests). */
  get current(): Screen {
    return this.screen;
  }

  get isOpen(): boolean {
    return this.open;
  }

  // --- Screens -------------------------------------------------------------------------------

  private renderPause(): void {
    const label = this.host.runLabel();
    const restart = this.keyName('restart');
    this.pauseSub.textContent = label ? `${label} · ${restart} starts a new run` : `${restart} starts a new run`;
  }

  /** Show the settings screen; Back returns to the screen it was opened from. */
  openSettings(): void {
    if (this.screen === 'settings') return;
    this.settingsReturn = this.screen === 'pause' ? 'pause' : 'main';
    this.show('settings');
  }

  private back(): void {
    if (this.screen !== 'settings') return;
    this.settingsPanel.close();
    this.show(this.settingsReturn);
  }

  /** Switch the settings tab (debug hook, tests). */
  selectSettingsTab(id: SettingsTab): void {
    this.settingsPanel.select(id);
  }

  get settingsTab(): string {
    return this.settingsPanel.selected;
  }

  // --- Keyboard ------------------------------------------------------------------------------

  /** The rules are `navigation.ts`; this builds the situation and performs the action. */
  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const st = this.navState();
    const action = resolveKey(e.code, st, this.navKeys());
    if (action === null) return;
    // Enter, Space and Backspace belong to the focused control unless the rule says otherwise.
    e.preventDefault();
    this.perform(action);
  };

  private navKeys(): NavKeys {
    return this.store.get().keys;
  }

  private navState(): NavState {
    const a = document.activeElement;
    const typing = a instanceof HTMLInputElement ? a.type !== 'checkbox' && a.type !== 'button' : a instanceof HTMLSelectElement || a instanceof HTMLTextAreaElement;
    return {
      menuOpen: this.open,
      screen: this.screen,
      runPhase: this.host.runPhase(),
      typing,
      onButton: a instanceof HTMLButtonElement && this.el.contains(a),
    };
  }

  private perform(a: NavAction): void {
    switch (a.type) {
      case 'play':
        this.host.play();
        break;
      case 'resume':
        this.host.resume();
        break;
      case 'newRun':
        this.host.newRun();
        break;
      case 'openSettings':
        this.openSettings();
        break;
      case 'back':
        this.back();
        break;
      case 'toMenu':
        this.host.toMenu();
        break;
    }
  }

  /** Arrow keys move the focus: down the pause list, and between Play and Settings on the main screen. */
  private readonly onArrowKey = (e: KeyboardEvent): void => {
    if (!this.open || !e.key.startsWith('Arrow')) return;
    const a = document.activeElement as HTMLElement | null;
    if (!a || a instanceof HTMLInputElement || a instanceof HTMLSelectElement || a.closest('.fl-tabs')) return;
    let items: HTMLElement[] = [];
    if (this.screen === 'pause') items = Array.from(this.screens.pause.querySelectorAll<HTMLElement>('.pause-actions button'));
    else if (this.screen === 'main') items = Array.from(this.screens.main.querySelectorAll<HTMLElement>('.main-actions button'));
    const idx = items.indexOf(a);
    if (idx < 0) return;
    const next = gridMove(idx, e.key, this.screen === 'main' ? items.length : 1, items.length);
    if (next !== idx) items[next]!.focus();
    e.preventDefault();
  };

  /** The menus are laid out for 1280 x 720; larger windows scale them up to 2x so they stay readable (like the results card). */
  private readonly fit = (): void => {
    const z = Math.max(1, Math.min(2, Math.min(window.innerWidth / 1280, window.innerHeight / 720)));
    this.el.style.setProperty('--menu-zoom', z.toFixed(3));
  };

  private focusDefault(): void {
    const target =
      this.screen === 'main'
        ? this.playBtn
        : this.screen === 'pause'
          ? this.screens.pause.querySelector<HTMLElement>('.pause-actions button')
          : this.screen === 'settings'
            ? this.screens.settings.querySelector<HTMLElement>('.fl-tab[aria-selected="true"]')
            : this.screens.firstRun.querySelector<HTMLElement>('.play-wide');
    target?.focus({ preventScroll: true });
  }
}

/** Parse trusted static SVG markup into an element. */
function wrapHtml(markup: string): HTMLElement {
  const d = h('span', { class: 'brand' });
  d.innerHTML = markup;
  return d;
}
