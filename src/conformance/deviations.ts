/**
 * Written reasons for every row where the implementation differs from `docs/mechanics-spec.md`.
 *
 * Key: the row id (see `docs/conformance.md`). Value: why it differs and where it is being fixed.
 * The suite fails when a differing row has no entry here, when an entry is empty, and when an entry
 * is left behind for a row that now matches, so a fix PR deletes its entries and re-runs
 * `npm run conformance`. Not-implemented rows need no entry.
 */

const ISSUE_177 = 'issue #177 (record the sim\'s reading in the spec, or change the code to the literal spec)';

const entries: [string[], string][] = [
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
