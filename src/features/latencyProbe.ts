import { defineFeature } from '../app/feature';
import { LatencyProbe, percentiles, type Percentiles, type ProbeSample, type ProbeSummary } from '../debug/latencyProbe';

/** One feedback moment: when the sim emitted it, when its sound was scheduled, when its frame was drawn. */
export interface AvSample {
  event: 'shotFired' | 'targetHit' | 'targetKilled';
  /** Wall time of the tick that emitted the event (ms). */
  tickAt: number;
  /** Wall time the frame that drew it finished drawing (ms). */
  drawnAt: number;
  /** Audio-clock time the matching cue was scheduled for, minus the audio clock at the tick (ms). 0 = "now". */
  soundScheduledInMs: number;
  /** `baseLatency + outputLatency` the browser reported at the tick (ms): the cue is heard about this long after it is scheduled. */
  deviceLatencyMs: number;
}

export interface LatencyReport {
  running: boolean;
  fakeLock: boolean;
  summary: ProbeSummary[];
  /** Clicks the gun ignored because it was still cycling, reloading or equipping (not latency samples). */
  droppedClicks: number;
  /** Per feedback event: draw end minus tick, and sound heard (scheduled + device latency) minus tick, in ms. */
  av: { event: string; n: number; drawnAfterTickMs: Percentiles; soundAfterTickMs: Percentiles; soundMinusDrawnMs: Percentiles }[];
  audio: { baseLatencyMs: number; outputLatencyMs: number; running: boolean };
  samples?: ProbeSample[];
  avSamples?: AvSample[];
}

declare module '../debug/hook' {
  interface FlicklineDebug {
    /**
     * Input-to-frame latency and sight/sound timing probe (`debug/latencyProbe.ts`). `start()` adds
     * capture listeners for mouse moves, the fire button and keys and records, per event, the tick or
     * frame that used it, the end of the frame that drew it and the next vsync; it also records, per
     * shot, hit and kill, when its sound was scheduled against when its frame was drawn. `fakeLock`
     * marks the pointer as locked so synthetic events drive the game in a headless browser (and
     * ticks run in real time). `report(true)` includes the raw samples. Costs nothing until started.
     */
    latency: {
      start(opts?: { fakeLock?: boolean }): void;
      stop(): void;
      clear(): void;
      report(raw?: boolean): LatencyReport;
    };
  }
}

const CUE_FOR: Record<AvSample['event'], string[]> = {
  shotFired: ['shotPace', 'shotKestrel', 'shotRill', 'shotLongnail'],
  targetHit: ['hitBody', 'hitHead', 'hitLeg'],
  targetKilled: ['kill'],
};

export const feature = defineFeature({
  id: 'latencyProbe',
  stage: 'tools',
  setup(game) {
    const probe = new LatencyProbe();
    const av: AvSample[] = [];
    const avPending: AvSample[] = [];
    let on = false;
    let fakeLock = false;
    let ticks = 0;
    let rafId = 0;

    const onMove = (e: MouseEvent): void => probe.event('look', e.timeStamp);
    const onDown = (e: MouseEvent): void => {
      if (e.button === 0) probe.event('fire', e.timeStamp);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (!e.repeat) probe.event('key', e.timeStamp);
    };
    const raf = (ts: number): void => {
      probe.vsync(ts);
      rafId = requestAnimationFrame(raf);
    };

    const recordAv = (event: AvSample['event']): void => {
      if (!on) return;
      const clock = game.audio.clock();
      // The cue is scheduled synchronously by the presentation listener of the same event, which
      // runs before this tools-stage listener, so the newest matching play is this event's sound.
      const plays = game.audio.recentPlays(6); // oldest first
      let scheduled = NaN;
      for (let i = plays.length - 1; i >= 0; i--) {
        const p = plays[i]!;
        if (CUE_FOR[event].includes(p.cue)) {
          scheduled = (p.at - clock.currentTime) * 1000;
          break;
        }
      }
      avPending.push({
        event,
        tickAt: performance.now(),
        drawnAt: -1,
        soundScheduledInMs: scheduled,
        deviceLatencyMs: (clock.baseLatency + clock.outputLatency) * 1000,
      });
    };

    game.bus.on('shotFired', () => {
      if (!on) return;
      probe.shot(performance.now());
      recordAv('shotFired');
    });
    game.bus.on('targetHit', () => recordAv('targetHit'));
    game.bus.on('targetKilled', () => recordAv('targetKilled'));
    game.onTick(() => {
      if (!on) return;
      ticks++;
      probe.tick(performance.now());
    });
    game.onFrame(() => {
      if (!on) return;
      probe.frameSampled(performance.now(), ticks);
      ticks = 0;
    });
    game.onFrameEnd(() => {
      if (!on) return;
      const now = performance.now();
      probe.frameDrawn(now);
      for (const s of avPending) {
        s.drawnAt = now;
        av.push(s);
      }
      avPending.length = 0;
      if (av.length > 4000) av.splice(0, av.length - 4000);
    });

    // What a person needs to judge sight/sound sync on their own machine (overlay only, 4x a second).
    game.addOverlayLines(() => {
      const c = game.audio.clock();
      if (!c.running) return '';
      return `audio out ${((c.baseLatency + c.outputLatency) * 1000).toFixed(0)} ms (base ${(c.baseLatency * 1000).toFixed(0)} + output ${(c.outputLatency * 1000).toFixed(0)})`;
    });

    game.addDebug({
      latency: {
        start(opts = {}) {
          if (on) return;
          on = true;
          document.addEventListener('mousemove', onMove, { capture: true, passive: true });
          document.addEventListener('mousedown', onDown, { capture: true, passive: true });
          window.addEventListener('keydown', onKey, { capture: true, passive: true });
          rafId = requestAnimationFrame(raf);
          if (opts.fakeLock) {
            fakeLock = true;
            game.input.locked = true;
            game.forceRun = true;
            game.hold = false;
          }
        },
        stop() {
          if (!on) return;
          on = false;
          document.removeEventListener('mousemove', onMove, { capture: true });
          document.removeEventListener('mousedown', onDown, { capture: true });
          window.removeEventListener('keydown', onKey, { capture: true });
          cancelAnimationFrame(rafId);
          if (fakeLock) {
            fakeLock = false;
            game.input.locked = document.pointerLockElement !== null;
          }
        },
        clear() {
          probe.clear();
          av.length = 0;
          avPending.length = 0;
        },
        report(raw = false) {
          const clock = game.audio.clock();
          const avOut: LatencyReport['av'] = [];
          for (const event of ['shotFired', 'targetHit', 'targetKilled'] as const) {
            const s = av.filter((x) => x.event === event && Number.isFinite(x.soundScheduledInMs));
            if (s.length === 0) continue;
            const drawn = s.map((x) => x.drawnAt - x.tickAt);
            const sound = s.map((x) => x.soundScheduledInMs + x.deviceLatencyMs);
            avOut.push({
              event,
              n: s.length,
              drawnAfterTickMs: percentiles(drawn),
              soundAfterTickMs: percentiles(sound),
              soundMinusDrawnMs: percentiles(sound.map((v, i) => v - drawn[i]!)),
            });
          }
          return {
            running: on,
            fakeLock,
            summary: probe.summary(),
            droppedClicks: probe.dropped,
            av: avOut,
            audio: { baseLatencyMs: clock.baseLatency * 1000, outputLatencyMs: clock.outputLatency * 1000, running: clock.running },
            ...(raw ? { samples: [...probe.samples], avSamples: [...av] } : {}),
          };
        },
      },
    });
  },
});
