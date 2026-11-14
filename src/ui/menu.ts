import { SELF_REPORTS, type SelfReport } from '../config/profile';
import type { MenuTunables } from '../config/menu';
import type { Tunables } from '../config/tunables';
import type { ProfileStore } from '../settings/profile';
import type { SettingsStore } from '../settings/settings';
import { icon } from './kit/icons';
import { applyPalette, button, h, panel } from './kit/kit';
import { wordmark } from './kit/wordmark';
import type { CardModel, SessionView } from './menuModel';
import { gridMove, resolveKey, type NavAction, type NavState, type RunPhase, type Screen } from './navigation';
import { SettingsPanel } from './settingsPanel';

/**
 * - `firstRun`: a new player (design 13.4): compact bottom-centre panel over the live Range with
 *   the sensitivity field, self-report chips and Click to play. No tutorial text.
 * - `main`: the landing menu: Play (today's session), the mode cards, settings.
 * - `pause`: the pointer lock was lost (Esc, alt-tab): Resume, Restart, Settings, Menu.
 * `settings` is reached from `main` and `pause` and goes back to where it came from.
 */
export type MenuMode = 'firstRun' | 'main' | 'pause';

/** What the menu asks of the game, and what it reads from it. */
export interface MenuHost {
  /** First run: enter the game (and take pointer lock); needs a user gesture. */
  play(): void;
  /** Take the pointer lock back and carry on. */
  resume(): void;
  /** Restart the current run from its seed (and take the lock). */
  restart(): void;
  /** Leave the run and show the main menu. */
  toMenu(): void;
  /** Start Today's session (its first step, or the next one when it is under way). */
  playSession(): void;
  /** Skip the current step of the session. */
  skipStep(): void;
  /** Start one mode from its card. */
  launchMode(modeId: string): void;
  /** `Enter` on a finished run: the next session step, or the same mode again. */
  nextRun(): void;
  /** The run clock's phase (for the in-run keys). */
  runPhase(): RunPhase;
  /** Cards for the registered modes. */
  cards(): CardModel[];
  /** Today's session: the plan, or the progress through it. */
  session(): SessionView;
  /** Name of the mode in progress ("Orbit") for the pause title, or null. */
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
  private readonly cardsEl: HTMLElement;
  private readonly sessionEl: HTMLElement;
  private readonly mainButtons: HTMLElement;
  private readonly pauseTitle: HTMLElement;
  private readonly pauseSub: HTMLElement;
  private readonly pauseSession: HTMLElement;
  private readonly pauseSkip: HTMLButtonElement;
  private readonly cfg: MenuTunables;
  private screen: Screen = 'main';
  private settingsReturn: Exclude<Screen, 'settings'> = 'main';
  private open = false;
  private lastView: SessionView = { active: false, steps: [], progressText: '' };
  private cardEls: HTMLButtonElement[] = [];
  private playBtn!: HTMLButtonElement;
  private skipBtn!: HTMLButtonElement;

  constructor(
    root: HTMLElement,
    store: SettingsStore,
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
    });
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
    const firstPlay = button('Click to play', { variant: 'primary', icon: 'play', onClick: () => host.play() });
    firstPlay.classList.add('play-wide');
    const firstPanel = panel({ class: 'first-panel' });
    firstPanel.body.append(
      h('div', { class: 'first-head' }, [wrapHtml(wordmark(22)), h('span', { class: 'first-tag', text: 'First-person aim and movement trainer' })]),
      this.firstRunHost,
      chipRow,
      firstPlay,
      this.rawNote(),
    );

    // --- Main ---
    this.sessionEl = h('div', { class: 'session-steps' });
    this.playBtn = button("Play today's session", { variant: 'primary', icon: 'play', key: 'Enter', onClick: () => host.playSession() });
    this.skipBtn = button('Skip step', { variant: 'ghost', icon: 'skip', key: 'K', onClick: () => host.skipStep() });
    const settingsBtn = button('Settings', { variant: 'ghost', icon: 'settings', key: 'S', onClick: () => this.openSettings() });
    this.mainButtons = h('div', { class: 'session-actions' }, [this.playBtn, this.skipBtn]);
    const sessionPanel = panel({ title: "Today's session", class: 'session-panel' });
    sessionPanel.body.append(this.sessionEl, this.mainButtons);
    this.cardsEl = h('div', { class: 'cards', attrs: { role: 'group', 'aria-label': 'Modes' } });
    const modesHead = h('div', { class: 'modes-head' }, [h('h2', { class: 'fl-panel-title', text: 'Modes' }), h('span', { class: 'modes-hint', text: 'Press 1–9 to start one' })]);
    const mainHead = h('header', { class: 'main-head' }, [wrapHtml(wordmark(34)), settingsBtn]);
    const mainScreen = h('div', { class: 'screen screen-main' }, [
      mainHead,
      sessionPanel.el,
      h('section', { class: 'modes' }, [modesHead, this.cardsEl]),
      h('footer', { class: 'main-foot' }, [
        this.rawNote(),
        h('p', { class: 'keys', text: 'WASD move · Space jump · Ctrl/C crouch · Shift walk · LMB shoot · R reload · Backspace restart · Esc menu' }),
      ]),
    ]);

    // --- Pause ---
    this.pauseTitle = h('h1', { class: 'pause-title', text: 'Paused' });
    this.pauseSub = h('p', { class: 'pause-sub' });
    this.pauseSession = h('p', { class: 'pause-session' });
    this.pauseSkip = button('Skip step', { variant: 'ghost', icon: 'skip', key: 'K', onClick: () => host.skipStep() });
    const pausePanel = panel({ class: 'pause-panel' });
    pausePanel.body.append(
      h('div', { class: 'pause-head' }, [wrapHtml(wordmark(20))]),
      this.pauseTitle,
      this.pauseSub,
      h('div', { class: 'pause-actions', attrs: { 'data-nav': 'list' } }, [
        button('Resume', { variant: 'primary', icon: 'resume', key: 'Esc', onClick: () => host.resume() }),
        button('Restart', { icon: 'restart', key: 'Backspace', onClick: () => host.restart() }),
        button('Settings', { icon: 'settings', key: 'S', onClick: () => this.openSettings() }),
        button('Menu', { icon: 'menu', key: 'M', onClick: () => host.toMenu() }),
      ]),
      this.pauseSession,
      this.pauseSkip,
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

  /** Refresh the settings form from the stores. */
  sync(): void {
    this.settingsPanel.sync();
    const picked = this.profile.get().selfReport;
    for (const chip of this.chips) chip.setAttribute('aria-pressed', String(chip.dataset.chip === picked));
  }

  /** Rebuild what the main and pause screens show (cards, bests, session) if they are on screen. */
  refresh(): void {
    if (!this.open) return;
    if (this.screen === 'main') this.renderMain();
    else if (this.screen === 'pause') this.renderPause();
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
    if (screen === 'main') this.renderMain();
    else if (screen === 'pause') this.renderPause();
    if (this.open) this.focusDefault();
  }

  /** Show raw-input state of the last lock request (null: not asked yet). */
  setRawInput(on: boolean | null): void {
    this.settingsPanel.setRawInput(on);
    for (const note of this.rawNotes) {
      note.dataset.state = on === null ? 'unknown' : on ? 'on' : 'off';
      note.textContent =
        on === null
          ? 'Raw input: requested when you click play'
          : on
            ? 'Raw input: on'
            : 'Raw input: off (this browser cannot disable mouse acceleration; turn off "Enhance pointer precision" in your OS)';
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

  private renderMain(): void {
    const cards = this.host.cards();
    const view = this.host.session();
    this.lastView = view;
    this.cardEls = [];
    this.cardsEl.replaceChildren();
    if (cards.length === 0) this.cardsEl.append(h('p', { class: 'cards-empty', text: this.cfg.emptyModes }));
    cards.forEach((c, i) => {
      const card = h('button', {
        class: 'fl-card',
        attrs: { type: 'button', 'data-mode': c.id, 'aria-label': `${c.name}. ${c.skillLabel}. Best ${c.bestText}. ${c.matchedText}` },
      });
      const skillIcon = c.skill;
      card.innerHTML = `
        <span class="card-top">${icon(skillIcon, 20)}<span class="card-skill"></span>${i < 9 ? '<kbd class="fl-kbd"></kbd>' : ''}</span>
        <span class="card-name"></span>
        <span class="card-blurb"></span>
        <span class="card-foot">
          <span class="card-best"><span class="k">BEST</span><span class="v"></span></span>
          <span class="card-match"></span>
        </span>`;
      card.querySelector('.card-skill')!.textContent = c.skillLabel;
      const kbd = card.querySelector('.fl-kbd');
      if (kbd) kbd.textContent = String(i + 1);
      card.querySelector('.card-name')!.textContent = c.name;
      card.querySelector('.card-blurb')!.textContent = c.blurb;
      const best = card.querySelector('.card-best .v') as HTMLElement;
      best.textContent = c.bestText;
      best.dataset.empty = String(c.best === null);
      const match = card.querySelector('.card-match') as HTMLElement;
      match.textContent = c.matchedText;
      if (c.matchedText) card.title = this.cfg.matchedHint;
      card.addEventListener('click', () => this.host.launchMode(c.id));
      this.cardsEl.append(card);
      this.cardEls.push(card);
    });
    this.renderSteps(this.sessionEl, view);
    this.playBtn.querySelector('.fl-btn-label')!.textContent = view.active ? 'Continue today’s session' : 'Play today’s session';
    this.skipBtn.hidden = !view.active;
  }

  private renderSteps(into: HTMLElement, view: SessionView): void {
    into.replaceChildren();
    if (view.steps.length === 0) {
      into.append(h('p', { class: 'session-empty', text: 'Free play: no modes are registered yet.' }));
      return;
    }
    view.steps.forEach((s, i) => {
      const step = h('div', { class: `session-step is-${s.state}`, attrs: { title: s.reason } }, [
        h('span', { class: 'step-n', text: String(i + 1) }),
        h('span', { class: 'step-body' }, [h('span', { class: 'step-name', text: s.name }), h('span', { class: 'step-why', text: s.reason })]),
      ]);
      into.append(step);
    });
    if (view.progressText) into.append(h('span', { class: 'session-progress', text: view.progressText }));
  }

  private renderPause(): void {
    const label = this.host.runLabel();
    const view = this.host.session();
    this.lastView = view;
    this.pauseSub.textContent = label ? `${label} · Backspace restarts` : 'Backspace restarts';
    this.pauseSession.textContent = view.active ? `Today’s session · ${view.progressText}` : '';
    this.pauseSession.hidden = !view.active;
    this.pauseSkip.hidden = !view.active;
  }

  /** Show the settings screen; Back returns to the screen it was opened from. */
  openSettings(): void {
    if (this.screen === 'settings') return;
    this.settingsReturn = this.screen === 'pause' ? 'pause' : 'main';
    this.show('settings');
  }

  private back(): void {
    if (this.screen === 'settings') this.show(this.settingsReturn);
  }

  // --- Keyboard ------------------------------------------------------------------------------

  /** The rules are `navigation.ts`; this builds the situation and performs the action. */
  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const st = this.navState();
    const action = resolveKey(e.code, st);
    if (action === null) return;
    // Enter, Space and Backspace belong to the focused control unless the rule says otherwise.
    e.preventDefault();
    this.perform(action);
  };

  private navState(): NavState {
    const a = document.activeElement;
    const typing = a instanceof HTMLInputElement ? a.type !== 'checkbox' && a.type !== 'button' : a instanceof HTMLSelectElement || a instanceof HTMLTextAreaElement;
    return {
      menuOpen: this.open,
      screen: this.screen,
      runPhase: this.host.runPhase(),
      typing,
      onButton: a instanceof HTMLButtonElement && this.el.contains(a),
      sessionActive: this.lastView.active,
    };
  }

  private perform(a: NavAction): void {
    switch (a.type) {
      case 'playSession':
        this.host.playSession();
        break;
      case 'resume':
        this.host.resume();
        break;
      case 'restart':
        this.host.restart();
        break;
      case 'nextRun':
        this.host.nextRun();
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
      case 'skipStep':
        this.host.skipStep();
        break;
      case 'launchCard': {
        const c = this.cardEls[a.index];
        if (c) this.host.launchMode(c.dataset.mode!);
        break;
      }
    }
  }

  /** Arrow keys move the focus: over the card grid, along the top buttons, down the pause list. */
  private readonly onArrowKey = (e: KeyboardEvent): void => {
    if (!this.open || !e.key.startsWith('Arrow')) return;
    const a = document.activeElement as HTMLElement | null;
    if (!a || a instanceof HTMLInputElement || a instanceof HTMLSelectElement || a.closest('.fl-tabs')) return;
    let items: HTMLElement[] = [];
    let cols = 1;
    if (this.screen === 'pause') {
      items = Array.from(this.screens.pause.querySelectorAll<HTMLElement>('.pause-actions button'));
    } else if (this.screen === 'main') {
      const top = [this.playBtn, this.skipBtn, this.screens.main.querySelector<HTMLElement>('.main-head .fl-btn')!].filter((b) => !b.hidden);
      if (top.includes(a)) {
        const i = top.indexOf(a);
        if (e.key === 'ArrowRight' && i < top.length - 1) top[i + 1]!.focus();
        else if (e.key === 'ArrowLeft' && i > 0) top[i - 1]!.focus();
        else if (e.key === 'ArrowDown') (this.cardEls[0] ?? a).focus();
        else return;
        e.preventDefault();
        return;
      }
      items = this.cardEls;
      cols = this.columns();
      const idx = items.indexOf(a as HTMLButtonElement);
      if (idx >= 0 && e.key === 'ArrowUp' && idx < cols) {
        this.playBtn.focus();
        e.preventDefault();
        return;
      }
    }
    const idx = items.indexOf(a);
    if (idx < 0) return;
    const next = gridMove(idx, e.key, cols, items.length);
    if (next !== idx) {
      items[next]!.focus();
      e.preventDefault();
    } else if (e.key.startsWith('Arrow')) {
      e.preventDefault();
    }
  };

  /** Cards per row, read from the layout (the first row is the cards that share the first card's top). */
  private columns(): number {
    const first = this.cardEls[0];
    if (!first) return 1;
    let n = 0;
    for (const c of this.cardEls) {
      if (c.offsetTop !== first.offsetTop) break;
      n++;
    }
    return Math.max(1, n);
  }

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
