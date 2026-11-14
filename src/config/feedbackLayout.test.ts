import { describe, expect, it } from 'vitest';
import { feedback } from './feedback';

/** The head-kill hitmarker ring is 34 px + 2 px border, centred 2 px off the crosshair, so ~20 px reach from it (styles.css `.hm-headkill b`). */
const HEADKILL_RING_REACH_PX = 20;
/** The biggest kill number: `.f-kill.f-head span` font size, drawn centred on its anchor. */
const BIGGEST_KILL_FONT_PX = 28;
const REM_PX = 16;

describe('kill feedback layout (#176)', () => {
  it('lifts the +score clear of the crosshair and the kill hitmarker from its very first frame', () => {
    const liftPx = feedback.floatText.killLiftRem * REM_PX;
    const bottomEdgeAboveCrosshair = liftPx - BIGGEST_KILL_FONT_PX / 2;
    expect(bottomEdgeAboveCrosshair).toBeGreaterThanOrEqual(HEADKILL_RING_REACH_PX);
  });

  it('puts the TTS / TTK readout below the crosshair, clear of the kill hitmarker ring', () => {
    expect(feedback.floatText.rtDropRem * REM_PX).toBeGreaterThanOrEqual(HEADKILL_RING_REACH_PX);
  });
});
