import { defineFeature } from '../app/feature';
import { Rng } from '../core/rng';
import { streamSeed } from '../core/rngStreams';
import { TICK_DT, TICK_RATE } from '../core/time';
import { CalloutTimer, planCallout, type CalloutPlan } from '../feedback/callout';
import { currentSector, SWEEP_MODE, type SweepState } from '../modes/sweep';

declare module '../debug/hook' {
  interface FlicklineDebug {
    /**
     * The callout stand-in (#99). `state()`: whether one is waiting, how many were issued and in which sector the
     * last was. `issue(yawDeg)`: issue one now towards the world yaw `yawDeg` (0 = -Z, + = left), as the producer would.
     */
    readonly callout: {
      state(): { pending: boolean; issued: number; lastIssuedIndex: number; enabled: boolean };
      issue(yawDeg: number, errorDeg?: number): void;
    };
  }
}

/** The stream the callout draws from: its own, so it never shifts a sector plan or an Echo's draws. */
const STREAM_CALLOUT = 0xca11;

/**
 * The callout stand-in's producer (engagement-information §4.2, #99; pure rules in `feedback/callout.ts`).
 * When the player enters a take sector whose first contact gives an area and no sound (a holder or a
 * peeker waiting silently), it may schedule one chirp-and-glow towards where its Echoes are, coarse and
 * delayed, then emits `calloutIssued` when the delay is up. The sim is untouched: the cue only tells the
 * player what a teammate would have, from facts the player could not otherwise hear. Off by the
 * `calloutStandIn` setting, and never in the first sector (the cold opener is the cue-free benchmark,
 * design §7.4) nor in a clean (reference-like) run.
 */
export const feature = defineFeature({
  id: 'callout',
  stage: 'producer',
  setup(game) {
    const timer = new CalloutTimer();
    let lastIssued = -Infinity;
    let issued = 0;
    const payload = { tick: 0, t: 0, dirX: 0, dirZ: -1, errorDeg: 0, sectorIndex: 0 };

    const emit = (dirX: number, dirZ: number, errorDeg: number, sectorIndex: number): void => {
      payload.tick = game.world.tick;
      payload.t = game.world.tick * TICK_DT;
      payload.dirX = dirX;
      payload.dirZ = dirZ;
      payload.errorDeg = errorDeg;
      payload.sectorIndex = sectorIndex;
      issued++;
      game.bus.emit('calloutIssued', payload);
    };
    const fire = (p: CalloutPlan, sectorIndex: number): void => {
      lastIssued = sectorIndex;
      emit(p.dirX, p.dirZ, p.errorDeg, sectorIndex);
    };

    game.bus.on('sectorEntered', (e) => {
      timer.cancel();
      if (e.index <= lastIssued) lastIssued = -Infinity; // a new run starts again from sector 0
      if (e.index === 0 || e.role !== 'take' || !game.settings.get().calloutStandIn) return;
      if (game.hud.root.classList.contains('hud-clean')) return;
      if (game.modes.modeId !== SWEEP_MODE) return;
      const st = game.modes.runner.state as SweepState;
      const sp = currentSector(st);
      const first = sp.contacts[0];
      if (!first) return;
      const echoes = first.echoes.map((x) => x.feet);
      const anyRunning = first.echoes.some((x) => x.gait === 'run' || x.arrive !== undefined);
      const p = game.world.player.pos;
      const rng = new Rng(streamSeed(st.plan.seed, e.index, STREAM_CALLOUT));
      const plan = planCallout(rng, game.tunables.callout, {
        card: first.card, echoes, anyRunning, player: { x: p.x, z: p.z }, sectorIndex: e.index, lastIssuedIndex: lastIssued,
      });
      if (plan) timer.schedule(plan, game.world.tick, TICK_RATE, e.index);
    });
    game.onTick(() => timer.step(game.world.tick, fire));
    game.onReset(() => {
      timer.cancel();
      lastIssued = -Infinity;
    });

    game.addDebug({
      callout: {
        state: () => ({ pending: timer.pending, issued, lastIssuedIndex: lastIssued, enabled: game.settings.get().calloutStandIn }),
        issue(yawDeg, errorDeg = 0) {
          const a = (yawDeg * Math.PI) / 180;
          emit(-Math.sin(a), -Math.cos(a), errorDeg, -1);
        },
      },
    });
  },
});
