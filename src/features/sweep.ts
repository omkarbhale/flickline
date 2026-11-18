import { defineFeature } from '../app/feature';
import { findMap } from '../sim/mapLoader';
import { atRisk, currentSector, SWEEP_MODE, sweepPlan, type SweepState } from '../modes/sweep';
import { isOvertime, sectorDepth } from '../modes/sweepDirector';
import { navRoute } from '../modes/sweepCatalog';
import { ExitMarker } from '../render/exitMarker';
import { GateView } from '../render/gateView';
import { yawOf } from '../sim/aim';
import { TICK_RATE } from '../core/time';

/** One move between sectors (a sector's exit to its gate, or a door to the sector behind it), measured: ms from the move to the next room set up, and to its first drawn frame. */
export interface SectorSwitch {
  from: string;
  to: string;
  mapChanged: boolean;
  /** Exit tick to the next sector's Echoes placed (sim, level swap, renderer level build), same call stack. */
  setupMs: number;
  /** Exit to the end of the first frame drawn in the next sector (includes the shader warm-up of a new level). */
  firstFrameMs: number;
}

declare module '../debug/hook' {
  interface FlicklineDebug {
    /**
     * Sweep, the run (#201). `state()`: the sector, its contacts and Echoes, the run's cards and every
     * measured sector switch, and the gate the player stands in (its two doors' facts). `plan(seed, lean)`: the
     * plan a seed starts with, with the cards the run leans toward (#210; its opener; the gates are drawn as the run reaches them). `toExit()`: stand the
     * player on the current sector's exit and step one tick (the gate loads). `gate()`: the doors' facts while in a
     * gate. `choose(door)`: in a gate, walk through door 0 (left) or 1 (right) and let the sector behind it load;
     * returns the facts of the door taken. `walk(maxTicks, stopAtM)`: walk
     * the sector's route towards its exit, looking where it goes, until an Echo comes into sight, the
     * player is within `stopAtM` metres of the exit (default 0: walk out), or the ticks run out;
     * returns the ticks walked and the id of the Echo seen (-1: none).
     */
    readonly sweep: {
      state(): unknown;
      plan(seed?: number, lean?: readonly string[]): unknown;
      toExit(): boolean;
      /** Shoot every live Echo dead with a headshot (a stand-in for a perfect player); returns how many fell. A hold sector's exit opens when the last is gone. */
      killAll(): number;
      gate(): unknown;
      choose(door: 0 | 1, ticks?: number): unknown;
      walk(maxTicks?: number, stopAtM?: number): { ticks: number; seen: number };
      /**
       * Measure a map switch on its own (the cost a move between sectors on different maps adds): load
       * `mapId` in place and draw a frame, then load the map that was there back and draw again.
       * Milliseconds to the level being set up and to the end of the drawn frame, both ways.
       */
      timeMapSwitch(mapId: string): { to: { setupMs: number; frameMs: number }; back: { setupMs: number; frameMs: number } } | null;
    };
  }
}

/**
 * Sweep's presentation (#201): the exit marker of the current sector, the dip to black that hides the
 * move to the next sector (and its measured cost), the sector counter, and the debug commands.
 */
export const feature = defineFeature({
  id: 'sweep',
  stage: 'presentation',
  setup(game) {
    const cfg = game.tunables.sweep;
    const marker = new ExitMarker(game.renderer.scene, cfg.exitRadiusM);
    game.renderer.addLayer(marker);
    const gateView = new GateView(game.renderer.scene, cfg.gate, { light: cfg.conditionCopy.light.title, eco: cfg.conditionCopy.eco.title });
    game.renderer.addLayer(gateView);

    const fade = document.createElement('div');
    fade.className = 'sweep-fade';
    fade.style.cssText = 'position:fixed;inset:0;background:#05070b;opacity:0;pointer-events:none;z-index:5;';
    document.body.appendChild(fade);
    const label = document.createElement('div');
    label.className = 'sweep-sector';
    label.style.cssText =
      'position:absolute;bottom:18px;left:50%;transform:translateX(-50%);font:600 13px/1 ui-sans-serif,system-ui,sans-serif;letter-spacing:.18em;' +
      'color:#38e8ff;text-shadow:0 0 8px rgba(56,232,255,.45);opacity:0;transition:opacity .25s;pointer-events:none;text-transform:uppercase;';
    game.hud.root.appendChild(label);

    // The announcement of a light or eco sector (design §4.6): shown on entry until the door shows it too (#205).
    const banner = document.createElement('div');
    banner.className = 'sweep-condition';
    banner.hidden = true;
    const bannerTitle = document.createElement('b');
    const bannerLine = document.createElement('span');
    banner.append(bannerTitle, bannerLine);
    game.hud.root.appendChild(banner);
    banner.style.setProperty('--banner-sec', `${cfg.conditionBannerSec}s`);
    let bannerTimer = 0;
    const hideBanner = (): void => {
      window.clearTimeout(bannerTimer);
      banner.hidden = true;
    };

    const switches: SectorSwitch[] = [];
    let pending: SectorSwitch | null = null;
    let exitAt = 0;
    let lastSector = '';
    let lastMap = '';
    let awaitFrame = false;
    let armed = false;

    // The run moved the player (a sector entry, a gate's far side): the view follows, level, facing where the sector looks.
    game.bus.on('playerPlaced', (e) => game.input.setLook(e.yaw, 0));

    const gateState = (st: SweepState): unknown => ({
      index: st.gate!.plan.index,
      chosen: st.gate!.door,
      /** An Overtime gate (#206): the door that leaves (the run ends, everything banked); undefined in an ordinary gate. */
      leave: st.gate!.plan.leave,
      doors: st.gate!.plan.doors.map((d) => (d.door === st.gate!.plan.leave ? { leave: true } : { ...d.facts, map: d.sector.mapId, sector: d.sector.sectorId, contacts: d.sector.contacts.length, echoes: d.sector.contacts.reduce((n, c) => n + c.echoes.length, 0) })),
    });
    const state = (): SweepState | null => (game.modes.modeId === SWEEP_MODE ? (game.modes.runner.state as SweepState) : null);

    /** A move between rooms starts: the cut to black is instant; the next room fades in once it is drawn. */
    const startSwitch = (from: string): void => {
      exitAt = performance.now();
      fade.style.transition = 'none';
      fade.style.opacity = '1';
      pending = { from, to: '', mapChanged: false, setupMs: 0, firstFrameMs: 0 };
    };
    game.bus.on('sectorEnded', (e) => {
      marker.hide();
      if (e.reason !== 'exit') return;
      startSwitch(e.sectorId);
    });
    game.bus.on('gateEntered', (e) => {
      const st = state();
      const gate = st?.gate;
      if (st && gate) {
        const leave = gate.plan.leave;
        if (leave === undefined) {
          gateView.show([gate.plan.doors[0].facts, gate.plan.doors[1].facts]);
          label.textContent = `Gate \u00b7 next: sector ${e.index + 1} / ${cfg.sectors}`;
        } else {
          // The gate after the Finale and after each Overtime sector (design 4.7, #206): Leave banks the score, the other door is the next Overtime sector.
          const score = game.modes.runner.stats.score;
          const risk = atRisk(st, score);
          const k = e.index - cfg.sectors + 1;
          const on = gate.plan.doors[leave === 0 ? 1 : 0].facts;
          const ahead = { ...on, overtime: { k, mult: sectorDepth(cfg, e.index) } };
          gateView.show([ahead, ahead], { door: leave, facts: { score, overtimePoints: risk } });
          label.textContent = k === 1 ? 'Finale cleared \u00b7 leave, or push on into Overtime' : `Overtime ${k - 1} cleared \u00b7 leave and bank, or push on`;
          game.hud.live.setOvertime(st.banked, st.overtime);
        }
        label.style.opacity = '0.9';
      }
      if (pending) {
        pending.to = 'gate';
        pending.mapChanged = true;
        pending.setupMs = performance.now() - exitAt;
        awaitFrame = true;
      }
      lastMap = cfg.gate.mapId;
    });
    game.bus.on('gateChosen', (e) => {
      // The other door closes and the screen goes dark over the beat before the sector loads (the sim waits `commitSec`).
      gateView.choose(e.door);
      fade.style.transition = `opacity ${cfg.gate.commitSec * 0.85}s ease-in`;
      fade.style.opacity = '1';
      pending = { from: 'gate', to: '', mapChanged: true, setupMs: 0, firstFrameMs: 0 };
      armed = true;
    });
    // The sector behind the chosen door is being set up: the clock of its switch starts here, not at the choice.
    game.bus.on('mapLoaded', () => {
      if (!armed) return;
      armed = false;
      exitAt = performance.now();
    });
    /** The label's words: the sector's place in the run, its role and condition (a hold's exit is shut until its Echoes are dead). */
    const sectorLabel = (index: number, of: number, role: string, condition: string, open: boolean): string => {
      const word = game.tunables.results.conditionLabels[condition as 'full' | 'light' | 'eco'] ?? '';
      const head = index >= of ? `Overtime ${index - of + 1}` : `Sector ${index + 1} / ${of}` + (index === of - 1 ? ' \u00b7 Finale' : '');
      return head + ` \u00b7 ${role}` + (word ? ` \u00b7 ${word}` : '') + (open ? ' \u00b7 exit open' : '');
    };
    game.bus.on('sectorEntered', (e) => {
      const st = state();
      const sp = st?.plan.sectors[e.index];
      gateView.hide();
      // A take's or meet's exit is open from the first tick; a hold's opens when its Echoes are dead (`sectorExitOpened`).
      if (sp && e.role !== 'hold') marker.place(sp.exit.x, sp.exit.y, sp.exit.z);
      label.textContent = sectorLabel(e.index, e.of, e.role, e.condition, false);
      label.style.opacity = '0.9';
      if (st && isOvertime(cfg, e.index)) game.hud.live.setOvertime(st.banked, st.overtime);
      hideBanner();
      const copy = cfg.conditionCopy[e.condition as 'full' | 'light' | 'eco'];
      if (copy && copy.title) {
        bannerTitle.textContent = copy.title;
        bannerLine.textContent = copy.line;
        banner.dataset.condition = e.condition;
        banner.hidden = false;
        bannerTimer = window.setTimeout(hideBanner, cfg.conditionBannerSec * 1000);
      }
      if (pending) {
        pending.to = e.sectorId;
        pending.mapChanged = e.mapId !== lastMap;
        pending.setupMs = performance.now() - exitAt;
        awaitFrame = true;
      }
      lastSector = e.sectorId;
      lastMap = e.mapId;
    });
    game.bus.on('sectorExitOpened', (e) => {
      const st = state();
      const sp = st?.plan.sectors[e.index];
      if (!st || !sp) return;
      marker.place(sp.exit.x, sp.exit.y, sp.exit.z);
      label.textContent = sectorLabel(e.index, game.tunables.sweep.sectors, 'hold', sp.condition, true);
    });
    // The run is over: a Leave door banked the Overtime points (the score shows whole), or the end forfeited them (the score is what is left).
    game.bus.on('runBanked', (e) => game.hud.live.setOvertime(-1, 0, e.score));
    game.bus.on('overtimeLost', (e) => game.hud.live.setOvertime(-1, 0, e.score));
    // A cold-opener leg (design §8.5) is a move inside the Opener: the same cut to black, and the marker on the leg's exit.
    game.bus.on('coldLegEntered', (e) => {
      const st = state();
      if (!st) return;
      const sp = currentSector(st);
      marker.place(sp.exit.x, sp.exit.y, sp.exit.z);
      if (e.leg === 0) return; // entered with the sector
      startSwitch(lastSector);
      pending!.to = e.sectorId;
      pending!.mapChanged = e.mapId !== lastMap;
      awaitFrame = true;
      lastSector = e.sectorId;
      lastMap = e.mapId;
    });
    game.onFrameEnd(() => {
      if (!awaitFrame || !pending) return;
      awaitFrame = false;
      pending.firstFrameMs = performance.now() - exitAt;
      switches.push(pending);
      if (switches.length > 32) switches.shift();
      pending = null;
      fade.style.transition = `opacity ${cfg.fadeSec}s ease-out`;
      fade.style.opacity = '0';
    });
    const clear = (): void => {
      hideBanner();
      marker.hide();
      gateView.hide();
      armed = false;
      label.style.opacity = '0';
      fade.style.transition = 'none';
      fade.style.opacity = '0';
      pending = null;
      awaitFrame = false;
    };
    game.bus.on('runReady', (e) => {
      if (e.mode !== SWEEP_MODE) clear();
    });
    game.bus.on('runEnded', () => {
      hideBanner();
      marker.hide();
      gateView.hide();
      fade.style.transition = 'none';
      fade.style.opacity = '0';
    });
    game.onReset(() => {
      if (!state()) clear();
    });

    game.addOverlayLines(() => {
      const st = state();
      if (!st) return '';
      const last = switches[switches.length - 1];
      const opener = !st.gate && st.openerStage >= 0 ? ' opener' : '';
      const ot = st.overtime > 0 || st.banked >= 0 ? ` OT ${st.overtime} banked ${st.banked} risk ${atRisk(st, game.modes.runner.stats.score)}` : '';
      return `sweep ${st.gate ? 'gate before ' : ''}sector ${st.gate ? st.gate.plan.index + 1 : st.sector + 1}/${cfg.sectors}${opener}${ot} ${lastSector} dial ${st.dial.dial.toFixed(1)}` + (last ? ` | switch ${last.setupMs.toFixed(1)} ms, frame ${last.firstFrameMs.toFixed(1)} ms` : '');
    });

    game.addDebug({
      sweep: {
        state() {
          const st = state();
          if (!st) return null;
          return {
            seed: st.plan.seed,
            lean: game.lean.now.slice(),
            nextLean: game.lean.next.slice(),
            sector: st.sector,
            of: cfg.sectors,
            /** Overtime (#206): the score banked for good (-1 before the Finale's exit gate), the points at risk and the Overtime sectors entered. */
            overtime: { banked: st.banked, atRisk: atRisk(st, game.modes.runner.stats.score), sectors: st.overtime },
            gate: st.gate ? gateState(st) : null,
            doors: st.plan.doors.slice(),
            stakes: st.plan.sectors.map((x) => x.stake),
            sectorId: currentSector(st).sectorId,
            role: currentSector(st).role,
            leg: st.leg,
            cold: st.plan.cold
              ? { level: st.plan.cold.level, legs: st.plan.cold.legs.map((l) => ({ slot: l.slot, variant: l.variant, mirrored: l.mirrored, card: l.contact.card, sector: l.contact.sector })) }
              : null,
            mapId: game.modes.currentMap.id,
            won: st.won,
            lost: st.lost,
            contacts: st.contacts.map((c) => ({ card: c.plan.card, open: c.open, alive: c.alive, pending: c.pending, echoes: c.echoIds.slice(), engaged: c.engaged, trials: c.trials })),
            // Skill matching (#203): the sector's dial, the matched dial behind it, the fight track and the placing Opener's staircase.
            dial: {
              sector: st.dial.dial, matched: st.dial.matched, placing: st.dial.placing, openerStage: st.openerStage, openerFought: st.openerFought,
              staircase: st.dial.staircase ? { dial: st.dial.staircase.dial, step: st.dial.staircase.step, reversals: st.dial.staircase.reversals } : null,
              target: game.modes.skills.targetDial('line', game.tunables.dial.modes.sweep!.targetSuccess),
              fight: game.modes.skills.fightRating(),
              line: game.modes.skills.rating('line'),
              match: game.modes.skills.matchRating(),
            },
            route: st.plan.sectors.map((s) => `${s.mapId}/${s.sectorId} [${s.stake}${s.arms ? ' ' + s.arms : ''}]: ${s.contacts.map((c) => c.card).join(', ')}`),
            switches: switches.slice(),
            hp: game.world.health.hp,
            shield: game.world.health.shield,
            maxShield: game.world.health.maxShield,
            /** Per sector: the condition the plan dealt it (the doors of #205 show these). */
            conditions: st.plan.sectors.map((s) => s.condition),
            weapon: game.world.loadout[game.world.weapon.active],
            swapLocked: game.world.swapLocked,
            enemyWeapon: game.world.enemyWeapon,
            enemyShield: game.world.targetField.enemyShield,
          };
        },
        plan: (seed, lean) => sweepPlan(seed ?? game.world.seed, game.tunables, lean ?? []),
        gate() {
          const st = state();
          return st?.gate ? gateState(st) : null;
        },
        choose(door, ticks) {
          const st = state();
          if (!st?.gate || st.gate.door !== -1) return null;
          const g = cfg.gate;
          const facts = st.gate.plan.doors[door].facts;
          game.world.placePlayer(g.doors[door].x, 0, g.doors[door].z - g.commitDepthM - 0.1, 0);
          game.step(ticks ?? Math.ceil(g.commitSec * TICK_RATE) + 3, undefined, ticks === undefined ? false : true);
          return facts;
        },
        toExit() {
          const st = state();
          if (!st) return false;
          const sp = currentSector(st);
          game.world.placePlayer(sp.exit.x, sp.exit.y, sp.exit.z, game.world.player.yaw);
          game.step(1);
          return true;
        },
        killAll() {
          if (!state()) return 0;
          const field = game.world.targetField;
          let n = 0;
          for (let slot = 0; slot < field.slots.length; slot++) {
            const t = field.slots[slot]!;
            if (!t.alive) continue;
            field.applyHit(slot, 'head', t.pos, 10, 1e6, game.world.tick, game.bus);
            n++;
          }
          return n;
        },
        timeMapSwitch(mapId) {
          const before = game.modes.currentMap.id;
          if (!findMap(mapId) || mapId === before) return null;
          const once = (id: string): { setupMs: number; frameMs: number } => {
            const t0 = performance.now();
            game.modes.loadMap(id);
            const t1 = performance.now();
            game.renderNow();
            return { setupMs: t1 - t0, frameMs: performance.now() - t0 };
          };
          const to = once(mapId);
          const back = once(before);
          return { to, back };
        },
        walk(maxTicks = 128 * 20, stopAtM = 0) {
          const st = state();
          if (!st) return { ticks: 0, seen: -1 };
          const sp = currentSector(st);
          const route = navRoute(findMap(sp.mapId)!, game.world.player.pos, sp.exit);
          let seen = -1;
          const off = game.bus.on('targetVisible', (e) => {
            if (seen < 0) seen = e.targetId;
          });
          let wp = 0;
          let ticks = 0;
          while (ticks < maxTicks && seen < 0 && wp < route.length && game.run.state !== 'result') {
            const p = game.world.player.pos;
            const w = route[wp]!;
            if (stopAtM > 0 && Math.hypot(sp.exit.x - p.x, sp.exit.z - p.z) < stopAtM) break;
            const dx = w.x - p.x, dz = w.z - p.z;
            if (Math.hypot(dx, dz) < 0.6) {
              wp++;
              continue;
            }
            game.step(1, { moveZ: 1, yaw: yawOf(dx, dz), pitch: 0 }, false);
            ticks++;
          }
          off();
          // Face the Echo that came into sight, so the frame shows the line that just opened.
          if (seen >= 0) {
            const t = game.world.targetField.byId(seen);
            const p = game.world.player;
            if (t) {
              const dx = t.pos.x - p.pos.x, dz = t.pos.z - p.pos.z;
              const dy = t.pos.y + 1.5 - (p.pos.y + p.eyeHeight);
              game.input.setLook(yawOf(dx, dz), Math.atan2(dy, Math.hypot(dx, dz)));
            }
          }
          game.renderNow();
          return { ticks, seen };
        },
      },
    });
  },
});
