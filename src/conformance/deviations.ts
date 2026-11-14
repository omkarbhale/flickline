/**
 * Written reasons for every row where the implementation differs from `docs/mechanics-spec.md`.
 *
 * Key: the row id (see `docs/conformance.md`). Value: why it differs and where it is being fixed.
 * The suite fails when a differing row has no entry here, when an entry is empty, and when an entry
 * is left behind for a row that now matches, so a fix PR deletes its entries and re-runs
 * `npm run conformance`. Not-implemented rows need no entry.
 */

const PR_73 = 'issue #73 (PR https://github.com/omkarbhale/flickline/pull/197)';
const ISSUE_177 = 'issue #177 (record the sim\'s reading in the spec, or change the code to the literal spec)';

const entries: [string[], string][] = [
  [
    [
      '7.1/move.accel_time_to_max', '7.1/move.brake_decel_high', '7.1/move.brake_decel_low', '7.1/move.brake_band_split_fraction',
      '7.1/move.stop_time_from_run',
    ],
    `The scaffold's placeholder movement model is still in place: velocity chases the wish velocity at one constant 70 m/s² (\`movement.groundAccel\`), so rest to full speed takes 0.078 s, braking has no band split and is not scaled by the weapon's speed, and a stop takes 0.078 s. Spec §2.3 wants 0.20 s, 39 / 24 m/s² and a 0.16 s stop. Fixed by ${PR_73}.`,
  ],
  [
    ['2.3/rifle_precise/stop-time', '2.3/rifle_spray/stop-time', '2.3/smg/stop-time', '2.3/pistol_accurate/stop-time'],
    `Same cause as \`7.1/move.stop_time_from_run\`: one constant 70 m/s² braking, so every weapon stops in 0.078 s instead of the spec's 0.16 s. Fixed by ${PR_73}.`,
  ],
  [
    ['2.5/rifle_precise/first-accurate-shot', '2.5/rifle_spray/first-accurate-shot'],
    `The shot is already accurate from 0.0625 s after the stopping input (the speed is under the 1.485 m/s deadzone by tick 8), 37% earlier than the spec's 0.100 s, because braking is 70 m/s² instead of the spec's two-band 39 / 24 m/s². The accuracy gate itself is right (\`2.4/*/deadzone-gate\` matches). Fixed by ${PR_73}.`,
  ],
  [
    ['2.5/smg/first-accurate-shot', '2.5/pistol_accurate/first-accurate-shot'],
    `The shot is already accurate from 0.055 s after the stopping input instead of about 0.100 s, because braking is 70 m/s² instead of the spec's two-band 39 / 24 m/s². The accuracy gate itself is right (\`2.4/*/deadzone-gate\` matches). Fixed by ${PR_73}.`,
  ],
  [
    ['2.1/rifle_precise/crouch-speed', '2.1/rifle_spray/crouch-speed'],
    `Crouch-walk is a fixed 2.2 m/s (\`movement.crouchSpeed\`, 0.41 of a 5.4 m/s rifle run) instead of 0.34 × run speed = 1.836 m/s. Fixed by ${PR_73}.`,
  ],
  [
    ['2.1/smg/run-speed', '2.1/pistol_accurate/run-speed'],
    `The player always runs at the fixed \`movement.runSpeed\` 5.4 m/s whatever is in hand; the weapon's own \`runSpeedMps\` (5.7375) only feeds the accuracy gate. Spec §2.1 runs these weapons at 0.85 × 6.75 = 5.7375 m/s. Fixed by ${PR_73}.`,
  ],
  [
    ['2.1/smg/walk-speed', '2.1/pistol_accurate/walk-speed'],
    `Walk is a fixed 2.7 m/s (\`movement.walkSpeed\`), not 0.50 × the equipped run speed (2.869 m/s for this weapon). Fixed by ${PR_73}.`,
  ],
  [
    ['2.1/smg/crouch-speed', '2.1/pistol_accurate/crouch-speed'],
    `Crouch-walk is a fixed 2.2 m/s (\`movement.crouchSpeed\`), not 0.34 × the equipped run speed (1.951 m/s for this weapon). Fixed by ${PR_73}.`,
  ],
  [
    ['3.4/rifle_precise/crouch-walk-error', '3.4/rifle_spray/crouch-walk-error'],
    `The movement error formula is right (\`7.3/*/err_crouchmove_deg\` matches); the crouch-walk speed is not: 2.2 m/s is 0.407 of the 5.4 m/s run, above the 0.34 crouch-walk fraction, so the shot lands on the ramp up to the run error (+1.33° instead of +0.8°). Fixed by ${PR_73}.`,
  ],
  [
    ['3.4/smg/crouch-walk-error', '3.4/pistol_accurate/crouch-walk-error'],
    `The movement error formula is right; the crouch-walk speed is not (fixed 2.2 m/s = 0.38 of this weapon's run speed, above the 0.34 crouch-walk fraction), so the shot reads more than the spec's value. Fixed by ${PR_73}.`,
  ],
  [
    ['3.4/smg/walk-error', '3.4/smg/run-error', '3.4/pistol_accurate/walk-error', '3.4/pistol_accurate/run-error'],
    `The movement error formula is right; the player is slower than the spec's equipped speed (5.4 m/s instead of 5.7375 for this weapon), so the speed fraction is 0.94 instead of 1.0 and the error reads a little under the spec's value. Fixed by ${PR_73}.`,
  ],
  [
    ['7.1/move.jump_apex', '2.6/airtime', '2.6/takeoff-speed', '7.1/move.gravity'],
    `Placeholder jump: \`movement.jumpSpeed\` 6 m/s with \`movement.gravity\` 22 m/s² gives a 0.795 m apex and 0.539 s in the air. Spec §2.6: 1.0 m apex, gravity 20 m/s² (a PLACEHOLDER), 0.63 s airtime, 6.32 m/s takeoff. Fixed by ${PR_73}.`,
  ],
  [
    ['7.1/move.air_accel_fraction'],
    `Air acceleration is 12 m/s² against 70 m/s² on the ground (0.171), not 0.25 × ground. Fixed by ${PR_73}.`,
  ],
  [
    ['2.6/air-speed-kept'],
    `In the air the velocity still chases the (zero) wish velocity at 12 m/s², so a runner who lets go of every key at takeoff stops moving sideways before landing. Spec §2.6: horizontal speed is preserved from takeoff. Fixed by ${PR_73}.`,
  ],
  [
    ['7.1/body.height_crouch'],
    `\`movement.crouchHeight\` is 1.4 m; spec §2.7 says 1.30 m (a PLACEHOLDER). The crouched Echo hit-zone top is already 1.30 m (\`targets.hit\`), so the player hull and the zone it is shot at disagree. Fixed by ${PR_73}.`,
  ],
  [
    ['7.1/body.eye_height_crouch', '7.1/body.crouch_transition'],
    `\`movement.crouchEyeHeight\` is 1.22 m (spec §2.7: 1.17 m, a PLACEHOLDER) and the eye moves at a fixed 4 m/s (\`eyeHeightSpeed\`), so the crouch takes 0.10 s instead of 0.15 s; the hull height flips in one tick. Fixed by ${PR_73}.`,
  ],
  [
    ['4.3/tag-speed-cap-pistol_accurate', '4.3/tag-speed-cap-smg'],
    `The tag cap is \`tag.speedScale\` × the fixed \`movement.runSpeed\` (5.4 m/s), not × the equipped weapon's max speed (5.7375 m/s), so a tagged runner ends up under this weapon's deadzone (0.261 of its max) instead of on it (0.275). Fixed by ${PR_73}.`,
  ],
  [
    ['4.3/tag-release', '4.3/tag-hold-while-hit'],
    `The sim reads spec §4.3 as a 0.1 s ramp-in followed by a 0.5 s release (\`playerHealth.ts\` \`tagTotalSec\`): one hit restores full speed 0.60 s after it, and hits more than 0.1 s apart do not hold the cap. The spec says "0.5 s from the last hit" and "hold while hits continue", which is ambiguous. Tracked in ${ISSUE_177}.`,
  ],
  [
    ['4.4/flinch-body', '4.4/flinch-leg'],
    `Every flinch kick recovers at the head kick's angular rate (2° / 0.25 s = 8°/s, \`config/player.ts\`), so a body kick is gone in 0.075 s and a leg kick in 0.0375 s; the spec states one 0.25 s recovery. The kick sizes match. Tracked in ${ISSUE_177}.`,
  ],
  [
    ['3.6/tracer-life'],
    `\`feedback.tracer.lifeSec\` is 0.08 s because design §7.1 specifies an 80 ms tracer; the spec's 0.06 s is a PLACEHOLDER. Tracers are cosmetic. Tracked in ${ISSUE_177}.`,
  ],
  [
    ['7.1/target.speed_medium'],
    'The Strafer\'s default speed (`enemies.strafer.defaultSpeed` 3.7 m/s) is the dial\'s mid value between the slow (2.0) and fast (5.4) ends; the dial (`dial.strafeSpeed`) replaces the spec\'s three fixed tiers with a continuous range (design §9.4), so 3.5 m/s is just one dial position. The spec value is a PLACEHOLDER.',
  ],
];

export const deviations: Readonly<Record<string, string>> = Object.fromEntries(
  entries.flatMap(([ids, reason]) => ids.map((id) => [id, reason] as const)),
);
