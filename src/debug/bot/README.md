# Bot playtest harness and perf harness (#28)

Two tools for playtests and regression checks, both on the debug side of the layering (`debug/`,
`scripts/`, `features/harness.ts`), neither used by the game itself.

| Tool | Where it runs | Command |
|---|---|---|
| **Bot**: a synthetic player at a chosen skill | Node, no rendering, no browser | `npm run bot -- --mode test --skill 40` |
| **Bot suite**: regression checks over every mode | Node (and `npm test`, so CI) | `npm run bot -- --suite` |
| **Allocation audit** of the sim tick | Node | `npm run bot -- --alloc` |
| **Perf harness**: 20 s scripted scene, frame times and heap | Real browser, through chrome-devtools-axi | `npm run perf` |
| Both, by hand | The running page | `__flickline.botPlay(...)`, `__flickline.perfRun()` / `?perf=1` |
| **Human-check measurements**: recoil sprays and reset, movement, tagging, input/tick alignment, sound metrics (#180) | Node, no browser | `npm run human-check [-- --json]` |
| **Latency probe**: input → tick/frame → drawn → vsync, and sight/sound timing per shot, hit and kill | The running page (any hardware) | `__flickline.latency.start()`, play, `__flickline.latency.report()` |

The last two back `docs/reviews/human-check-1.md`; both are described there.

## The bot

```
npm run bot -- --mode <id> --skill <0..100> [--seed N] [--runs N] [--dial D] [--param k=v] [--json]
npm run bot -- --list
```

`--mode` is any registered mode (`__flickline.mode.list()`: `test`, `coldStart`, `orbit`, `placement`) or `freeplay` (a 30 s
timed run on the map's own targets). Ids ignore case and dashes: `cold-start`, `coldStart` and
`COLDSTART` are one mode, so `--mode cold-start` works. The run is synchronous and headless: a 60 s drill takes well under a second.

It prints the run (simulated time, wall time, a state hash) and the numbers a person would care
about: shots, accuracy, headshot rate, kills, median time to shot and to kill, pre-aim error, time
on target, signed flick error (the overshoot diagnostic), and for mode runs score and trials.
`--json` prints the same as one JSON object (`--runs N` plays seeds `seed .. seed+N-1`).

**Deterministic:** the world, the mode and the bot draw only from seeded streams, so
`(mode, skill, seed, params, build)` gives the same `hash` and the same numbers every time
(`bot.test.ts` checks it). `--bot-seed` separates the bot's stream from the world's.

### How it plays

`Bot` (`bot.ts`) reads the world the way a person sees it (which targets are up and visible,
where the crosshair is, what the recoil is doing) and writes a `TickInput`: view and trigger. It
never touches sim state. One engagement is the two-submovement model of aimed movement:

1. **react**: wait the reaction time (from the target becoming visible, or from the bot being free);
2. **flick**: a minimum-jerk movement lasting a Fitts time, `log2(angle / width + 1) / throughput`,
   landing `overshootBias x angle` past the head (plus a random share of the angle);
3. **correct**: if the flick landed more than half a head radius off, a short correction onto the
   head with the final aim error (a 2-D Gaussian, `aimSigmaDeg`), keeping 15 % of the overshoot;
4. **engage**: the crosshair follows the head with a 30 ms lag, clicks after `clickDelaySec`, fires
   a burst (one shot for a semi-auto weapon, `burstBullets` for an automatic one), pulls the
   recoil back out of its view in proportion to `sprayControl`, lets go and re-aims when a bullet
   takes no HP off the target, and moves on when the target is gone.

A target that is not in view yet (behind the player in Orbit) is turned to at `searchDegPerSec`.

**Not modelled** (so a mode that needs them is not playable by this bot yet): leading moving
targets (it trails them with its follow lag), movement of any kind except Stop & Pop's footwork and Sweep's walk (below; elsewhere it stands still), crouching outside Stop & Pop,
jumping, weapon swaps and reloads (the sim reloads an empty magazine by itself), taking cover,
and enemies shooting back.

### Stop & Pop footwork (`footwork.ts`)

Stop & Pop is the one mode with movement, and it is played on its own map (`mapForMode`: Lane). `FootworkBot` wraps the aiming `Bot`: it strafes along the Lane (arming it), and when a target appears waits its reaction time, taps the opposite key until its speed is under the accuracy threshold, lets go, takes the ring's stance (crouch for a blue ring) and only then lets the aimer fire. A weak bot reacts late and runs out of exposure; a strong one does not.

### Sweep (`sweepBot.ts`, `sweepReport.ts`)

Sweep (#201) is a run with no clock: `SweepBot` walks each sector from its entry to its exit along the map's nav graph (`navRoute` in `modes/sweepCatalog.ts`), looking where it walks with the crosshair at head height. When the aimer engages an Echo it has actually seen (`Bot.visibleOnly`, and only while that Echo is in plain sight, so it never aims through walls), it counter-strafes to a stop and fires only along an open line. When a fight pulls it off its route, or it is stuck on a corner for 3 s, it plans a new route from where it stands. It does not clear angles one at a time, pre-aim, use cover, crouch or back off a fight it is losing, so its numbers are a floor for a balance pass (#53), not a target.

`npm run bot -- --sweep-report [--runs 50] [--skills 30,50,70] [--dial D]` plays seeded runs at each skill and prints the balance table posted on #201: contact win rate (cleared ÷ fights; a contact the player left unhurt is not a fight), fights per run, depth reached, the share of runs that made it out, mean health+shield at each sector exit, run length and score.

`npm run bot -- --meet-report [--runs 100] [--skills 30,50,70] [--stop-delay 2.5]` is the meet-sector report (#212). Each run is forced to the Opener and then one meet sector (`sweep.roleMix` set to meets only, two sectors), and every settled meet contact is tallied by who first dropped to counter-strafe speed (`contactSettled.stopFirst`) against whether the player won it (every Echo dead). `SweepBot` normally stops the moment it engages an Echo, which would leave only one side of the comparison; `--stop-delay S` lets it keep running its route for a uniform 0..S seconds after it first engages (aim on the Echo, no shot while moving), so both orders occur. A bigger S makes the Echoes stop first more often and the player's run-through costlier. The bot's skill changes its aim, not its stopping, so the rows differ little.

`npm run bot -- --lean-report [--runs 20] [--players 5] [--skill 50] [--weakness 0.7] [--practice 0.04] [--engine planted|stub]` is the lean's A/B (#210, `docs/research/replay-not-drills.md` R4). A bot with a planted moving-shot weakness (`SweepBot`'s `movingFireShare`: that share of its fights it never stops in and fires on the move) plays `--runs` consecutive Sweep runs on fixed seeds, twice: lean off, and lean on (each run leans as the previous run's finding says; `--engine planted` assumes the fix engine finds the planted weakness after the first run, `--engine stub` asks today's `pickFix`, which needs 8 shots and a bot run fires fewer). A bot does not learn, so the practice model is an **assumption**: each fight in a card that exercises the weakness removes `--practice` of what is left of it, in both arms. The arms therefore differ only in how many such fights they get. The table reports fights in those cards per run, the moving-shot share over the first and last five runs, and the weakness left.

### The skill model (`skill.ts`)

One number, `skill` 0..100, on the same scale as the difficulty dial and the latent ability of
design §9.1, expands into these parameters (linear between the ends unless marked geometric). Any of them can be overridden
(`--param aimSigmaDeg=0.2`, or `params` in code), which is how the suite isolates one effect.

| Parameter | Skill 0 | Skill 100 | Meaning | Source |
|---|---|---|---|---|
| `aimSigmaDeg` (geometric) | 0.5 | 0.03 | aim error σ per axis at the shot, degrees. A head is about 0.5 deg across its radius at 15 m | ESTIMATE |
| `reactionMeanSec` / `reactionSdSec` | 0.40 / 0.050 | 0.20 / 0.025 | visible (or free) to first movement | research §1: simple RT 0.218 s, SD 0.039 |
| `overshootBias` / `overshootSpread` | +0.10 / 0.10 | +0.005 / 0.015 | flick endpoint error as a fraction of the angle; + overshoots, - undershoots (set a negative bias to model an under-flicker) | ESTIMATE |
| `throughputBitsPerSec` | 4.5 | 7 | Fitts throughput of the flick | research §2 |
| `clickDelaySec` | 0.09 | 0.03 | settle to trigger | ESTIMATE |
| `sprayControl` | 0.15 | 0.95 | share of the weapon's recoil offset pulled back out of the view | ESTIMATE |
| `burstBullets` | 6 | 3 | bullets per pull on an automatic weapon | ESTIMATE |
| `recoverySec` | 0.30 | 0.12 | pause between bursts and after a kill | ESTIMATE |
| `searchDegPerSec` | 420 | 900 | turn rate towards a target not in view | ESTIMATE |

The ESTIMATE rows have no published source; they are ordered sensibly, not calibrated.
**Calibrating skill against the dial (does a skill-50 bot succeed about 70 % of the time at dial
42, design §9.1?) is the job of the difficulty balance pass (#53)**, which now has this harness to
run it with: `--runs 20 --dial D --json` gives the success rates per skill and dial.

Where the curve stands today (free play, seeds 1..5, accuracy of the kestrel's bullets): skill 0
16 %, 20 19 %, 40 41 %, 60 61 %, 80 82 %, 100 90 %.

## The suite

`npm run bot -- --suite` (and `bot.test.ts`, inside `npm test`, which is what CI runs; about 1.5 s):

- every mode, at skill 20 and 90, three seeds: the run ends by itself, in under 5 s wall;
- the same seed twice gives the identical state hash and stats;
- skill 90 out-kills and out-aims skill 20 in every mode;
- one parameter at a time: a longer reaction raises the median time to shot, a larger σ lowers
  accuracy, a positive overshoot bias gives a positive signed flick error (a negative one, negative),
  and spray control raises spray accuracy.

A new mode is covered by registering it in `MODES`: the suite iterates the registry.

## Allocation audit (`npm run bot -- --alloc`)

The architecture forbids allocation in hot paths. The audit plays a free-play run with the bot,
recording the view angles and trigger it produces, then replays that recording on a fresh game with
a scripted movement overlaid (strafing, walking, jumping, crouching) and **the bot out of the
process**: the bot's once-per-engagement code is cold, runs in V8's interpreter and boxes every
double there, which is the test tool's cost and not the game's. After 20 000 warm-up ticks to let the JIT
settle, it records every allocation of the next 100 000 ticks with V8's sampling heap profiler
(including objects the scavenger already freed) and prints the total, the bytes per tick, and the
functions responsible. `allocAudit.test.ts` enforces a **regression ceiling** of 8 B/tick (today
about 3; the target is 0) so a new per-tick closure, array, object literal, or double passed to a
function V8 does not inline fails the build the day it lands. What is left is the run's event log
(`feedback/eventLog.ts`, which copies each event once, by design) and per-event handlers.

Why "double passed to a function V8 does not inline" is a leak: V8 passes arguments to such a
function as boxed heap numbers, so every call with a freshly computed or loaded `number` allocates
16 bytes per number; so does a number returned from one, stored in a module-level `let`, or written
through a computed key (`pos[axis] += d`). `Math.hypot` boxes its result as well. The sim's per-tick
paths therefore take objects (`Ray`, the player, the tunables) and write results into scratch typed
arrays or fields, use `Math.sqrt(x * x + z * z)`, and inline tiny helpers. To check that a path stays
free of it whatever V8 decides to inline, run
`node --no-turbo-inlining --no-maglev-inlining scripts/bot.mjs --alloc`: what remains there is
per-event (a target becoming visible, a lead sample), not per tick.

## The perf harness

```
npm run perf [-- --sec 20] [--quality low|medium|high] [--width 1280 --height 720] [--url <page>] [--json]
```

Builds the game into `node_modules/.cache/flickline-perf`, serves it on a free port, opens it with
`chrome-devtools-axi` at `?perf=1`, polls until the scene is done and prints the report. Browser
settings come from the usual `CHROME_DEVTOOLS_AXI_*` variables; the script adds
`--enable-precise-memory-info` for exact heap numbers and uses its own session. `?perf=1` also
works in any browser by hand (`&perfSec=N`, `&quality=...`; the quality setting is saved like any
other setting); the result is `__flickline.perfStatus()`.

The **scene** (`src/debug/perfHarness.ts`), a pure function of time so two runs do the same: free
play on the Range with an infinite magazine; the view sweeps ±28° across the targets every 4 s;
automatic fire is held (tracers, impacts, decals, kill shatters, respawns); the player strafes
every 1.5 s, jumps every 2.5 s (footsteps, landings) and takes 6 HP every 2 s (damage arcs,
vignette, HP bar). Before the scene, 30 000 sim ticks of it run undrawn (the sim's JIT), then 14 s
are drawn on a 64x36 canvas (the frame loop's JIT: a software renderer draws a handful of 1280x720
frames a second, and code V8 has not yet compiled boxes every double); after the canvas is restored
three frames settle, and none of this is measured. Every frame's time and CPU time go into
preallocated buffers, so the harness adds no allocation of its own while it measures.

The **report**: frames and ticks; average, p50, p99 and worst frame; the 1 % and 0.1 % low (the
average fps over the slowest 1 % / 0.1 % of frames); the share of frames over the 6.94 ms budget;
CPU time inside the frame callback; draw calls and triangles; and the JS heap: start and end, the
growth of its floor (the minimum of each second, least-squares slope: a leak shows here, a
sawtooth does not), bytes allocated per second (the sum of the rises, and the typical second:
the median sample interval, which ignores the spikes of V8 compiling and of the browser's own
work) and per frame, and the collections seen.

**Smoke thresholds** (`SMOKE` in `perfHarness.ts`): average frame ≤ 500 ms, worst frame ≤ 5 s,
heap floor growth ≤ 16 MB, at least 20 frames. Only a broken build fails them; the headless
browsers this runs in render in software (a 1280x720 frame costs 90-260 ms on this project's
CI-like machine), so **read the numbers for correctness, relative cost and heap behaviour, never
for absolute frame rate**; judge 144 fps on real hardware (design §14.1, the release pass #55).

**Zero allocation in the browser:** the page cannot tell its sim's allocation from the renderer's,
so the report gives the total (bytes/s and bytes/frame) and the floor growth, and the sim's share
and sources come from the Node audit above. To see where the page's allocation comes from, load the
dev server in a browser with remote debugging, start `HeapProfiler.startSampling` (with
`includeObjectsCollectedByMinorGC`) after the scene has warmed up and read the call tree: what is
left after #152 is three.js's own per-frame work (uniform upload caches, the render-list sort and
push, the frustum matrix; about 2 KiB per frame) and the per-shot / per-event handlers.

## CI

The bot suite and the allocation ceiling run inside `npm test` (about 6 s for the whole
`src/debug/bot` folder) and `npm run bot -- --suite` runs as its own CI step so the table is in
the log. The perf harness stays a **local script**: it needs a real browser driven through
chrome-devtools-axi, builds the game and plays 20 s of a software-rendered scene, which does not
fit the 2-minute CI budget alongside the other checks and, on a CI software GPU, measures nothing
that decides a release.

## Programming interface

```ts
import { HeadlessGame } from './headless';
import { playMode } from './play';
const report = playMode(new HeadlessGame({ seed: 1 }), { mode: 'test', skill: 60, seed: 1 });
```

`HeadlessGame` wires the world, bus, mode host and run controller exactly as `app/game.ts` does,
minus rendering, audio, HUD and input. `BotGame` (`headless.ts`) is the small interface the bot
needs, which the page also provides, so `__flickline.botPlay({ mode, skill, seed })` plays the
same code on the page's real game and draws the final frame. Later suites (#93 humanness, #122
attribution fault injection) build on `HeadlessGame` and `Bot`.

`__flickline.bot(modeId, opts)` (`features/modeBot.ts`, `debug/modeBot.ts`, from #23) is an older, simpler
scripted aimer with a single noise parameter that the drill tests use; it is left as it is. Moving it
onto `Bot` is a follow-up.
