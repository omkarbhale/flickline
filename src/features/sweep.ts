import { defineFeature } from '../app/feature';
import { MAPS } from '../sim/mapLoader';
import { SWEEP_MODE, sweepPlan, type SweepState } from '../modes/sweep';
import { navRoute } from '../modes/sweepCatalog';
import { ExitMarker } from '../render/exitMarker';
import { yawOf } from '../sim/aim';

/** One move between sectors, measured: ms from the exit to the next sector set up, and to its first drawn frame. */
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
     * measured sector switch. `plan(seed)`: the plan a seed gives. `toExit()`: stand the player on the
     * current sector's exit and step one tick (the next sector loads). `walk(maxTicks, stopAtM)`: walk
     * the sector's route towards its exit, looking where it goes, until an Echo comes into sight, the
     * player is within `stopAtM` metres of the exit (default 0: walk out), or the ticks run out;
     * returns the ticks walked and the id of the Echo seen (-1: none).
     */
    readonly sweep: {
      state(): unknown;
      plan(seed?: number): unknown;
      toExit(): boolean;
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

    const switches: SectorSwitch[] = [];
    let pending: SectorSwitch | null = null;
    let exitAt = 0;
    let lastSector = '';
    let lastMap = '';
    let awaitFrame = false;

    const state = (): SweepState | null => (game.modes.modeId === SWEEP_MODE ? (game.modes.runner.state as SweepState) : null);

    game.bus.on('sectorEnded', (e) => {
      marker.hide();
      if (e.reason !== 'exit') return;
      // The cut to black is instant; the next sector fades in once it is drawn.
      exitAt = performance.now();
      fade.style.transition = 'none';
      fade.style.opacity = '1';
      pending = { from: e.sectorId, to: '', mapChanged: false, setupMs: 0, firstFrameMs: 0 };
    });
    game.bus.on('sectorEntered', (e) => {
      const st = state();
      const sp = st?.plan.sectors[e.index];
      if (sp) marker.place(sp.exit.x, sp.exit.y, sp.exit.z);
      label.textContent = `Sector ${e.sector + 1} / ${e.of}`;
      label.style.opacity = '0.9';
      if (pending) {
        pending.to = e.sectorId;
        pending.mapChanged = e.mapId !== lastMap;
        pending.setupMs = performance.now() - exitAt;
        awaitFrame = true;
      }
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
      marker.hide();
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
      marker.hide();
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
      const sp = st.plan.sectors[st.sector];
      return `sweep sector ${(sp?.depth ?? 0) + 1}/${st.plan.depthCount}${sp?.opener ? ' opener' : ''} ${lastSector} dial ${st.dial.dial.toFixed(1)}` + (last ? ` | switch ${last.setupMs.toFixed(1)} ms, frame ${last.firstFrameMs.toFixed(1)} ms` : '');
    });

    game.addDebug({
      sweep: {
        state() {
          const st = state();
          if (!st) return null;
          return {
            seed: st.plan.seed,
            sector: st.sector,
            of: st.plan.sectors.length,
            sectorId: st.plan.sectors[st.sector]?.sectorId,
            mapId: game.modes.currentMap.id,
            won: st.won,
            lost: st.lost,
            contacts: st.contacts.map((c) => ({ card: c.plan.card, open: c.open, alive: c.alive, echoes: c.echoIds.slice(), engaged: c.engaged, trials: c.trials })),
            // Skill matching (#203): the sector's dial, the matched dial behind it, and the placing Opener's staircase.
            dial: {
              sector: st.dial.dial, matched: st.dial.matched, placing: st.dial.placing, openerFought: st.openerFought,
              staircase: st.dial.staircase ? { dial: st.dial.staircase.dial, step: st.dial.staircase.step, reversals: st.dial.staircase.reversals } : null,
              target: game.modes.skills.targetDial('line', game.tunables.dial.modes.sweep!.targetSuccess),
              line: game.modes.skills.rating('line'),
              match: game.modes.skills.matchRating(),
            },
            depth: st.plan.sectors[st.sector]?.depth,
            opener: st.plan.sectors[st.sector]?.opener,
            route: st.plan.sectors.map((s) => `${s.mapId}/${s.sectorId}: ${s.contacts.map((c) => c.card).join(', ')}`),
            switches: switches.slice(),
            hp: game.world.health.hp,
            shield: game.world.health.shield,
          };
        },
        plan: (seed) => sweepPlan(seed ?? game.world.seed, game.tunables),
        toExit() {
          const st = state();
          if (!st) return false;
          const sp = st.plan.sectors[st.sector]!;
          game.world.placePlayer(sp.exit.x, sp.exit.y, sp.exit.z, game.world.player.yaw);
          game.step(1);
          return true;
        },
        timeMapSwitch(mapId) {
          const before = game.modes.currentMap.id;
          if (!MAPS[mapId] || mapId === before) return null;
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
          const sp = st.plan.sectors[st.sector]!;
          const route = navRoute(MAPS[sp.mapId]!, game.world.player.pos, sp.exit);
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
