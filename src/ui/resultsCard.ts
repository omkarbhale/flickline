import { results as defaultResults, type ResultsTunables } from '../config/results';
import { DASH, type CardModel } from '../feedback/results';
import './resultsCard.css';

/**
 * When the user pressed: the event's own timestamp (it includes time queued before our handler ran),
 * unless that is not on the `performance.now()` clock or is implausibly old (synthetic input), then now.
 */
function pressTime(e: Event): number {
  const now = performance.now();
  const age = now - e.timeStamp;
  return age >= 0 && age < 1000 ? e.timeStamp : now;
}

export interface ResultsCardHandlers {
  /** `Enter` / the Play again button. `pressedAt` is the key event's timestamp (performance.now() base). */
  onPlayAgain(pressedAt: number): void;
  /** `Esc` when the pointer is already free / the Menu button. */
  onMenu(): void;
  /** True while another full-screen layer (the menu) is on top: the card ignores keys then. */
  blocked(): boolean;
  /** Whether `code` is the confirm key (default `Enter`; the player can rebind it). */
  isConfirm?(code: string): boolean;
}

/**
 * The results card (design §8.2): header, rating, headline stats, medals, one thing to fix and the
 * flow keys. Static markup built once; `show()` only writes text into it, so showing the card
 * costs a handful of DOM writes inside the `runEnded` dispatch. Keyboard: `Enter` plays again,
 * `Esc` opens the menu (under pointer lock the browser takes `Esc` and the menu opens through the
 * lock change instead). Tab order is Play again, Menu.
 */
export class ResultsCard {
  readonly el: HTMLElement;
  private readonly q: (k: string) => HTMLElement;
  private readonly statsEl: HTMLElement;
  private readonly medalsList: HTMLElement;
  private readonly play: HTMLButtonElement;
  private readonly menuBtn: HTMLButtonElement;
  private readonly statCells: { dt: HTMLElement; val: HTMLElement; hint: HTMLElement }[] = [];
  private open = false;
  private endedAt = 0;
  /** Time from `runEnded` to the card's DOM being written, and to the next painted frame (ms; -1 until known). */
  lastBuildMs = -1;
  lastAppearMs = -1;
  model: CardModel | null = null;

  constructor(
    parent: HTMLElement,
    private readonly handlers: ResultsCardHandlers,
    private readonly cfg: ResultsTunables = defaultResults,
  ) {
    const el = document.createElement('section');
    el.className = 'rc';
    el.id = 'results';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Run results');
    el.innerHTML = `
      <div class="rc-panel">
        <header class="rc-head">
          <div>
            <p class="rc-kicker" data-k="end"></p>
            <h2 class="rc-title" data-k="mode"></h2>
            <p class="rc-seed">Seed <span data-k="seed"></span></p>
            <p class="rc-clean" data-k="clean" hidden>Clean run: no coaching cues, reference-like HUD. Treat this score as your reference-game level.</p>
          </div>
          <div class="rc-score">
            <span class="rc-score-num" data-k="score" aria-label="Score"></span>
            <span class="rc-pb" data-k="pb"></span>
          </div>
        </header>
        <section class="rc-rating" aria-label="Rating" data-k="rating">
          <div class="rc-rating-row" data-k="ratingRow">
            <span class="rc-skill" data-k="skill"></span>
            <span class="rc-rnum before" data-k="before"></span>
            <span class="rc-arrow" aria-hidden="true">→</span>
            <span class="rc-rnum" data-k="after"></span>
            <span class="rc-delta" data-k="delta"></span>
            <span class="rc-shift" data-k="shift"></span>
            <span class="rc-badge" data-k="badge"></span>
          </div>
          <div class="rc-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" data-k="bar"><i></i></div>
          <span class="rc-bartext" data-k="bartext"></span>
          <p class="rc-unrated" data-k="unrated" hidden>This run does not move your rating.</p>
        </section>
        <dl class="rc-stats" data-k="stats"></dl>
        <section class="rc-medals" aria-label="Medals"><h3>Medals</h3><ul data-k="medals"></ul></section>
        <section class="rc-fix" aria-label="One thing to fix" data-k="fix">
          <h3>One thing to fix</h3>
          <p class="rc-fix-title" data-k="fixTitle"></p>
          <p data-k="fixEvidence"></p>
          <p data-k="fixAction"></p>
        </section>
        <footer class="rc-actions">
          <button type="button" class="rc-btn primary" data-k="play">Play again <kbd>Enter</kbd></button>
          <button type="button" class="rc-btn" data-k="menu">Menu <kbd>Esc</kbd></button>
        </footer>
      </div>`;
    parent.appendChild(el);
    this.el = el;
    this.q = (k) => el.querySelector(`[data-k="${k}"]`) as HTMLElement;
    this.statsEl = this.q('stats');
    this.medalsList = this.q('medals');
    this.play = this.q('play') as HTMLButtonElement;
    this.menuBtn = this.q('menu') as HTMLButtonElement;
    this.play.addEventListener('click', (e) => handlers.onPlayAgain(pressTime(e)));
    this.menuBtn.addEventListener('click', () => handlers.onMenu());
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('resize', this.fit);
    this.fit();
  }

  /** Scale the card up on large screens (the layout is designed for 1280x720): 1x up to 2x. */
  private readonly fit = (): void => {
    const z = Math.max(1, Math.min(2, Math.min(window.innerWidth / this.cfg.designWidth, window.innerHeight / this.cfg.designHeight)));
    this.el.style.setProperty('--rc-zoom', z.toFixed(3));
  };

  get isOpen(): boolean {
    return this.open;
  }

  /** Keys: Enter plays again, Esc opens the menu. A focused card button keeps its own Enter. */
  private readonly onKey = (e: KeyboardEvent): void => {
    if (!this.open || e.repeat || e.ctrlKey || e.altKey || e.metaKey || this.handlers.blocked()) return;
    const onButton = e.target instanceof HTMLButtonElement && this.el.contains(e.target);
    const confirm = this.handlers.isConfirm ? this.handlers.isConfirm(e.code) : e.code === 'Enter' || e.code === 'NumpadEnter';
    if (confirm) {
      if (onButton && e.target === this.menuBtn) return; // Enter on Menu activates Menu
      e.preventDefault();
      this.handlers.onPlayAgain(pressTime(e));
    } else if (e.code === 'Escape') {
      this.handlers.onMenu();
    }
  };

  /** The key hint on the primary button ("Enter", or the rebound key). */
  setConfirmLabel(label: string): void {
    const k = this.play.querySelector('kbd');
    if (k) k.textContent = label;
  }

  /** Rename the primary button ("Next: Orbit" inside Today's session); null restores "Play again". */
  setPlayLabel(label: string | null): void {
    const text = this.play.firstChild;
    if (text !== null && text.nodeType === Node.TEXT_NODE) text.textContent = `${label ?? 'Play again'} `;
  }

  /** Write the model into the card and show it. `endedAt` is the `performance.now()` of `runEnded`. */
  show(m: CardModel, endedAt: number): void {
    this.model = m;
    this.endedAt = endedAt;
    const q = this.q;
    q('end').textContent = m.endLabel;
    q('mode').textContent = m.modeLabel;
    q('seed').textContent = String(m.seed);
    q('clean').hidden = !m.clean;
    q('score').textContent = m.score;
    const pb = q('pb');
    pb.textContent = m.pbText === DASH ? 'Personal best: —' : `${m.pbText} vs personal best`;
    pb.dataset.tone = m.pbTone;

    const r = m.rating;
    q('ratingRow').hidden = r === null;
    q('bar').hidden = r === null;
    q('bartext').hidden = r === null;
    q('unrated').hidden = r !== null;
    if (r) {
      q('skill').textContent = r.skill;
      q('before').textContent = String(r.before);
      q('after').textContent = String(r.after);
      const d = q('delta');
      d.textContent = r.deltaText;
      d.dataset.tone = r.tone;
      q('shift').textContent = r.tierShift === 'up' ? `▲ from ${r.beforeTier}` : r.tierShift === 'down' ? `▼ from ${r.beforeTier}` : '';
      const badge = q('badge');
      badge.textContent = r.afterTier;
      const colour = this.cfg.tierColours[r.tierIndex] ?? '';
      this.el.style.setProperty('--tier', colour);
      const bar = q('bar');
      bar.setAttribute('aria-valuenow', String(Math.round(r.progress * 100)));
      bar.setAttribute('aria-label', `Progress to the next division of ${r.afterTier}`);
      (bar.firstElementChild as HTMLElement).style.width = `${(r.progress * 100).toFixed(1)}%`;
      q('bartext').textContent = r.progressText;
    }

    this.writeStats(m);
    this.writeMedals(m);
    q('fix').dataset.kind = m.fix.kind;
    q('fixTitle').textContent = m.fix.title;
    q('fixEvidence').textContent = m.fix.evidence;
    q('fixAction').textContent = m.fix.action;

    this.open = true;
    this.el.classList.add('open');
    document.body.classList.add('results-open');
    this.play.focus({ preventScroll: true });
    this.lastBuildMs = performance.now() - endedAt;
    this.lastAppearMs = -1;
    requestAnimationFrame(() => {
      this.lastAppearMs = performance.now() - this.endedAt;
    });
  }

  hide(): void {
    if (!this.open) return;
    this.open = false;
    this.el.classList.remove('open');
    document.body.classList.remove('results-open');
    // A focused button would take the game's Space/Enter presses: hand focus back to the canvas.
    const a = document.activeElement;
    if (a instanceof HTMLElement && this.el.contains(a)) (document.getElementById('game') ?? document.body).focus({ preventScroll: true });
  }

  private writeStats(m: CardModel): void {
    const cells = this.statCells;
    // Built once for the first card; later cards only rewrite text (the stat set has a fixed size).
    while (cells.length < m.stats.length) {
      const wrap = document.createElement('div');
      wrap.className = 'rc-stat';
      const dt = document.createElement('dt');
      const dd = document.createElement('dd');
      const val = document.createElement('span');
      val.className = 'rc-sval';
      const hint = document.createElement('span');
      hint.className = 'rc-shint';
      dd.append(val, hint);
      wrap.append(dt, dd);
      this.statsEl.appendChild(wrap);
      cells.push({ dt, val, hint });
    }
    for (let i = 0; i < m.stats.length; i++) {
      const s = m.stats[i]!;
      const c = cells[i]!;
      c.dt.textContent = s.label;
      c.val.textContent = s.value;
      c.val.classList.toggle('dash', s.value === DASH);
      c.hint.textContent = s.hint;
      c.hint.title = s.hint;
    }
  }

  private writeMedals(m: CardModel): void {
    const list = this.medalsList;
    list.replaceChildren();
    if (m.medals.length === 0) {
      const li = document.createElement('li');
      li.className = 'none';
      li.style.border = '0';
      li.textContent = 'None this run';
      list.appendChild(li);
      return;
    }
    for (const med of m.medals) {
      const li = document.createElement('li');
      li.textContent = med.count > 1 ? `${med.label} ×${med.count}` : med.label;
      list.appendChild(li);
    }
  }
}
