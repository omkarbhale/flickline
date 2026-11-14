import { defineFeature } from '../app/feature';
import { createTickInput } from '../sim/types';

declare module '../debug/hook' {
  interface FlicklineDebug {
    /**
     * Input-layer probe for playtests (the pointer cannot be locked headlessly): `locked` pretends the
     * pointer is (or is not) locked so key and mouse events reach the input layer; returns the lock
     * state, the live view angles in degrees, the raw-input state and the input sample the next tick
     * would get (movement, stance, edges, weapon slot).
     */
    inputProbe(opts?: { locked?: boolean }): {
      locked: boolean;
      yawDeg: number;
      pitchDeg: number;
      rawInput: boolean | null;
      sample: { moveX: number; moveZ: number; crouch: boolean; walk: boolean; jump: boolean; fire: boolean; reload: boolean; switchTo: number };
    };
    /**
     * The frame-rate cap and readout as they stand: the cap, the measured frame rate and 1% low text.
     * `cap` sets the limiter directly to any rate (the setting only offers 60/144/240/uncapped, which a
     * 60 Hz headless display can not tell apart; 30 can) until the next settings change of `fpsCap`.
     */
    fpsProbe(opts?: { cap?: number }): { cap: number; fps: number; p99FrameMs: number; readoutVisible: boolean; readout: string };
  }
}

/** Debug probes for the settings that act on input and frame pacing. */
export const feature = defineFeature({
  id: 'settingsDebug',
  stage: 'tools',
  setup(game) {
    const scratch = createTickInput();
    game.addDebug({
      inputProbe(opts = {}) {
        if (opts.locked !== undefined) game.input.locked = opts.locked;
        game.input.sample(scratch);
        const d = 180 / Math.PI;
        return {
          locked: game.input.locked,
          yawDeg: game.input.yaw * d,
          pitchDeg: game.input.pitch * d,
          rawInput: game.input.rawInput,
          sample: {
            moveX: scratch.moveX, moveZ: scratch.moveZ, crouch: scratch.crouch, walk: scratch.walk,
            jump: scratch.jump, fire: scratch.fire, reload: scratch.reload, switchTo: scratch.switchTo,
          },
        };
      },
      fpsProbe(opts = {}) {
        if (opts.cap !== undefined) game.limiter.setCap(opts.cap);
        return {
          cap: game.limiter.fps,
          fps: game.perf.fps,
          p99FrameMs: game.perf.p99Ms,
          readoutVisible: game.fps.isVisible,
          readout: game.fps.el.textContent ?? '',
        };
      },
    });
  },
});
