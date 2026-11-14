import { results as defaultResults, type ResultsTunables } from '../config/results';
import { DASH, type CardModel, type RouteTileView, type SituationView } from '../feedback/results';
import { applyPalette, button, h } from './kit/kit';
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

interface TileEls {
  li: HTMLElement;
  num: HTMLElement;
  role: HTMLElement;
  tags: HTMLElement;
  fights: HTMLElement;
  hp: HTMLElement;
  mark: HTMLElement;
}

interface RowEls {
  li: HTMLElement;
  label: HTMLElement;
  bar: HTMLElement;
  summary: HTMLElement;
  recent: HTMLElement;
}

export interface ResultsCardHandlers {
  /** `Enter` / the New run button: a new run on a new seed. `pressedAt` is the key event's timestamp (performance.now() base). */
  onPlayAgain(pressedAt: number): void;
  /** `R` / the Replay button: the same seed again (design §8.2). */
  onReplay(pressedAt: number): void;
  /** `Esc` when the pointer is already free / the Menu button. */
  onMenu(): void;
  /** True while another full-screen layer (the menu) is on top: the card ignores keys then. */
  blocked(): boolean;
  /** Whether `code` is the confirm key (default `Enter`; the player can rebind it). */
  isConfirm?(code: string): boolean;
}

/**
 * The results card (design §8.2): header (score, depth, how it ended, best-run delta), the route
 * strip, fights by situation, rating, headline stats, medals, one thing to fix and the flow keys.
 * Built from the UI kit (palette tokens, panel, buttons). Static markup built once; tiles and rows
 * are pooled and `show()` only writes text into them, so showing the card costs a few dozen DOM
 * writes inside the `runEnded` dispatch. Keyboard: `Enter` starts a new run on a new seed, `R` replays the seed, `Esc`
 * opens the menu (under pointer lock the browser takes `Esc` and the menu opens through the lock
 * change instead). Tab order is New run, Replay seed, Menu.
 */
export class ResultsCard {
  readonly el: HTMLElement;
  private readonly q: (k: string) => HTMLElement;
  private readonly statsEl: HTMLElement;
  private readonly medalsList: HTMLElement;
  private readonly routeList: HTMLElement;
  private readonly fightsList: HTMLElement;
  private readonly play: HTMLButtonElement;
  private readonly replayBtn: HTMLButtonElement;
  private readonly menuBtn: HTMLButtonElement;
  private readonly tiles: TileEls[] = [];
  private readonly rows: RowEls[] = [];
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
    applyPalette(el);
    el.innerHTML = `
      <div class="rc-panel fl-panel">
        <header class="rc-head">
          <div class="rc-id">
            <p class="rc-kicker"><span data-k="end"></span><span class="rc-dot" data-k="depthDot" aria-hidden="true">·</span><span class="rc-depth" data-k="depth"></span></p>
            <h2 class="rc-title" data-k="mode"></h2>
            <p class="rc-cause" data-k="cause" hidden></p>
            <p class="rc-seed">Seed <span data-k="seed"></span></p>
            <p class="rc-clean" data-k="clean" hidden>Clean run: no coaching cues, reference-like HUD. Treat this score as your reference-game level.</p>
          </div>
          <div class="rc-score">
            <span class="rc-score-num" data-k="score" aria-label="Score"></span>
            <span class="rc-pb" data-k="pb"></span>
            <span class="rc-ot" data-k="overtime" hidden></span>
          </div>
        </header>
        <section class="rc-route" aria-label="Route" data-k="routeSec">
          <h3>Route</h3>
          <ol class="rc-tiles" data-k="route"></ol>
        </section>
        <div class="rc-mid" data-k="mid">
          <section class="rc-fights" aria-label="Fights by situation" data-k="fightsSec">
            <h3>Fights by situation</h3>
            <ul data-k="fights"></ul>
          </section>
          <section class="rc-fix" aria-label="One thing to fix" data-k="fix">
            <h3>One thing to fix</h3>
            <p class="rc-fix-title" data-k="fixTitle"></p>
            <p data-k="fixEvidence"></p>
            <p data-k="fixAction"></p>
            <p class="rc-lean" data-k="fixLean" hidden></p>
          </section>
        </div>
        <ul class="rc-notes" aria-label="Armour" data-k="notes" hidden></ul>
        <section class="rc-rating" aria-label="Rating" data-k="rating">
          <div class="rc-rating-row" data-k="ratingRow">
            <span class="rc-skill" data-k="skill"></span>
            <span class="rc-rnum before" data-k="before"></span>
            <span class="rc-arrow" aria-hidden="true" data-k="arrow">→</span>
            <span class="rc-rnum" data-k="after"></span>
            <span class="rc-delta" data-k="delta"></span>
            <span class="rc-shift" data-k="shift"></span>
            <span class="rc-bartext" data-k="bartext"></span>
            <span class="rc-badge" data-k="badge"></span>
          </div>
          <div class="rc-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" data-k="bar"><i></i></div>
          <p class="rc-unrated" data-k="unrated" hidden>This run does not move your rating.</p>
        </section>
        <dl class="rc-stats" data-k="stats"></dl>
        <section class="rc-medals" aria-label="Medals"><h3>Medals</h3><ul data-k="medals"></ul></section>
        <footer class="rc-actions" data-k="actions"></footer>
      </div>`;
    parent.appendChild(el);
    this.el = el;
    this.q = (k) => el.querySelector(`[data-k="${k}"]`) as HTMLElement;
    this.statsEl = this.q('stats');
    this.medalsList = this.q('medals');
    this.routeList = this.q('route');
    this.fightsList = this.q('fights');
    this.play = button('New run', { variant: 'primary', key: 'Enter', onClick: () => undefined });
    this.replayBtn = button('Replay seed', { variant: 'secondary', key: 'R', onClick: () => undefined });
    this.menuBtn = button('Menu', { variant: 'ghost', key: 'Esc', onClick: () => undefined });
    this.q('actions').append(this.play, this.replayBtn, this.menuBtn);
    this.play.addEventListener('click', (e) => handlers.onPlayAgain(pressTime(e)));
    this.replayBtn.addEventListener('click', (e) => handlers.onReplay(pressTime(e)));
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

  /** Keys: Enter plays again, R replays the seed, Esc opens the menu. A focused card button keeps its own Enter. */
  private readonly onKey = (e: KeyboardEvent): void => {
    if (!this.open || e.repeat || e.ctrlKey || e.altKey || e.metaKey || this.handlers.blocked()) return;
    const onButton = e.target instanceof HTMLButtonElement && this.el.contains(e.target);
    const confirm = this.handlers.isConfirm ? this.handlers.isConfirm(e.code) : e.code === 'Enter' || e.code === 'NumpadEnter';
    if (confirm) {
      if (onButton && e.target !== this.play) return; // Enter on Replay or Menu activates that button
      e.preventDefault();
      this.handlers.onPlayAgain(pressTime(e));
    } else if (e.code === 'KeyR') {
      e.preventDefault();
      this.handlers.onReplay(pressTime(e));
    } else if (e.code === 'Escape') {
      this.handlers.onMenu();
    }
  };

  /** The key hint on the primary button ("Enter", or the rebound key). */
  setConfirmLabel(label: string): void {
    const k = this.play.querySelector('kbd');
    if (k) k.textContent = label;
  }

  /** Show or hide the Replay button (a session step has no same-seed replay of its own). */
  setReplayEnabled(on: boolean): void {
    this.replayBtn.hidden = !on;
  }

  /** Write the model into the card and show it. `endedAt` is the `performance.now()` of `runEnded`. */
  show(m: CardModel, endedAt: number): void {
    this.model = m;
    this.endedAt = endedAt;
    const q = this.q;
    q('end').textContent = m.endLabel;
    q('depth').textContent = m.depth;
    q('depthDot').hidden = m.depth === '' || m.endLabel === '';
    q('mode').textContent = m.modeLabel;
    const cause = q('cause');
    cause.textContent = m.deathLine ?? '';
    cause.hidden = m.deathLine === null;
    q('seed').textContent = String(m.seed);
    q('clean').hidden = !m.clean;
    q('score').textContent = m.score;
    const pb = q('pb');
    pb.textContent = m.pbLabel;
    pb.hidden = m.pbLabel === '';
    pb.dataset.tone = m.pbTone;
    const ot = q('overtime');
    ot.hidden = m.overtime === null;
    if (m.overtime) {
      ot.textContent = `Overtime ${m.overtime.points} ${m.overtime.state}`;
      ot.dataset.state = m.overtime.state;
    }

    const r = m.rating;
    q('ratingRow').hidden = r === null;
    q('bar').hidden = r === null;
    q('unrated').hidden = r !== null;
    if (r) {
      q('skill').textContent = r.skill;
      q('before').textContent = String(r.before);
      q('after').textContent = String(r.after);
      // A first rating has nothing to compare with: just the rating and where it sits.
      for (const k of ['before', 'arrow', 'delta', 'shift']) q(k).hidden = r.first;
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

    const notes = q('notes');
    notes.replaceChildren(...m.notes.map((n) => h('li', { text: n })));
    notes.hidden = m.notes.length === 0;
    this.writeRoute(m);
    this.writeFights(m);
    this.writeStats(m);
    this.writeMedals(m);
    q('fix').dataset.kind = m.fix.kind;
    q('fixTitle').textContent = m.fix.title;
    q('fixEvidence').textContent = m.fix.evidence;
    q('fixAction').textContent = m.fix.action;
    // What the next run leans toward (design §8.3, #210): plain words, only when a card the run can deal practises it.
    const lean = q('fixLean');
    lean.textContent = m.fix.lean?.line ?? '';
    lean.hidden = m.fix.lean === null;

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

  /** The route strip: pooled tiles, one per sector; the section is hidden for a run without sectors. */
  private writeRoute(m: CardModel): void {
    const route = m.route;
    this.q('routeSec').hidden = route.length === 0;
    const tiles = this.tiles;
    while (tiles.length < route.length) tiles.push(this.makeTile());
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i]!;
      const v = route[i];
      t.li.hidden = v === undefined;
      if (v) this.fillTile(t, v);
    }
    // Wrap evenly: nine tiles are two rows of five and four, never eight and a lonely one.
    const rowsNeeded = Math.max(1, Math.ceil(route.length / this.cfg.run.tilesPerRow));
    this.routeList.style.setProperty('--rc-cols', String(Math.max(1, Math.ceil(route.length / rowsNeeded))));
  }

  private makeTile(): TileEls {
    const li = h('li', { class: 'rc-tile' });
    const num = h('span', { class: 'rc-tnum' });
    const role = h('span', { class: 'rc-trole' });
    const tags = h('span', { class: 'rc-ttags' });
    const fights = h('span', { class: 'rc-tfights' });
    const hp = h('span', { class: 'rc-thp' });
    const mark = h('span', { class: 'rc-tmark', text: '★ Flawless', attrs: { title: 'Flawless: no miss and no moving shot' } });
    li.append(h('span', { class: 'rc-thead' }, [num, role]), tags, fights, hp, mark);
    this.routeList.appendChild(li);
    return { li, num, role, tags, fights, hp, mark };
  }

  private fillTile(t: TileEls, v: RouteTileView): void {
    t.num.textContent = String(v.number);
    t.role.textContent = v.role;
    t.tags.textContent = [v.stake, v.condition].filter((x) => x !== '').join(' · ');
    t.fights.textContent = v.fights;
    t.hp.textContent = `HP ${v.hp}`;
    t.hp.dataset.tone = v.hpTone;
    t.mark.hidden = !v.flawless;
    t.li.dataset.role = v.roleId;
    t.li.dataset.overtime = v.overtime ? '1' : '0';
    t.li.dataset.flawless = v.flawless ? '1' : '0';
    t.li.dataset.outcome = v.outcome;
    t.li.setAttribute('aria-label', v.label);
  }

  /** Fights by situation: pooled rows, one per scenario card fought. */
  private writeFights(m: CardModel): void {
    const sit = m.situations;
    this.q('fightsSec').hidden = sit.length === 0;
    this.q('mid').classList.toggle('solo', sit.length === 0);
    const rows = this.rows;
    while (rows.length < sit.length) rows.push(this.makeRow());
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]!;
      const v = sit[i];
      r.li.hidden = v === undefined;
      if (v) this.fillRow(r, v);
    }
  }

  private makeRow(): RowEls {
    const li = h('li', { class: 'rc-row' });
    const label = h('span', { class: 'rc-rlabel' });
    const bar = h('span', { class: 'rc-rbar' }, [h('i')]);
    const summary = h('span', { class: 'rc-rsum' });
    const recent = h('span', { class: 'rc-rrecent' });
    li.append(label, bar, summary, recent);
    this.fightsList.appendChild(li);
    return { li, label, bar, summary, recent };
  }

  private fillRow(r: RowEls, v: SituationView): void {
    r.label.textContent = v.label;
    r.summary.textContent = v.summary;
    r.recent.textContent = v.recent;
    r.recent.hidden = v.recent === '';
    r.li.dataset.tone = v.tone;
    (r.bar.firstElementChild as HTMLElement).style.width = `${((v.rate ?? 0) * 100).toFixed(0)}%`;
    r.li.setAttribute('aria-label', `${v.label}: ${v.summary}${v.recent ? `, ${v.recent}` : ''}`);
  }

  private writeStats(m: CardModel): void {
    const cells = this.statCells;
    // Built once for the first card; later cards only rewrite text (the stat set has a fixed size per mode).
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
    this.statsEl.style.setProperty('--rc-stat-cols', String(m.stats.length > 6 ? Math.ceil(m.stats.length / 2) : m.stats.length));
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i]!;
      const s = m.stats[i];
      (c.dt.parentElement as HTMLElement).hidden = s === undefined;
      if (!s) continue;
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
