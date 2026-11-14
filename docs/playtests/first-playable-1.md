# First-playable playtest 1 (issue #29)

The first looked-at and listened-to pass over the first playable (design §15), build `1590520`. The three quality tracks get three separate verdicts (design §14.7, vision principle 4), and none of them stands in for another. Defects are filed as separate issues. Nothing in the game was changed by this pass.

| Track | Verdict | In one line |
|---|---|---|
| Numbers | **FAIL** | Weapons, damage, spread, recoil data, FOV, sensitivity and tick all match. The movement block (spec §2) is still the scaffold placeholder: 24 deviations, 1 of them unexplained. |
| Feel | **FAIL** | 39 of 58 points (67 %). Hit and kill sounds, timing and view are strong. Movement scores 33 % with critical zeros (stop and counter-strafe snap), caused entirely by the numbers above. |
| Fun | **FAIL** | Pacing, restart and feedback clarity pass. The first minute fails: the first click never starts the Placement run. Cold Start also fails its success band and reward cadence. |

**Recommendation: not ready** to call this the first playable. See [Recommendation](#recommendation) for the top five follow-ups.

## How this pass was run

- **Dependency gap (decision recorded on #29).** The three yardsticks are not on `main`: the conformance suite and `docs/conformance.md` (#64), `docs/feel-checklist.md` (#65) and `docs/fun-criteria.md` (#66). Each section below therefore uses an interim yardstick built from the acceptance criteria of those issues, and says so. A re-score against the real documents belongs to the next pass (#56) once they land.
- **Build and checks.** `npm run typecheck`, `npm test` (66 files, 939 tests passed, 1 skipped) and `npm run build` all pass on the tested commit.
- **Browser.** Production build served by `vite preview`, driven through Chromium and `window.__flickline` at 1280×720. The browser is headless and software-rendered (SwiftShader, no GPU), so frame rates here are for correctness and relative cost only.
- **Bot.** `npm run bot -- --suite` passed (19 of 19 checks). A bus-tapping driver over the same headless game ran 755 runs: Cold Start, Orbit and Placement at bot skills 10, 30, 50, 70 and 90, in fresh runs, ten-run sessions and placement-then-drill sessions.
- **Evidence.** Screenshots are in `docs/screenshots/playtest-1/` and the full conformance table is in [`first-playable-1-conformance.md`](first-playable-1-conformance.md).

## Product promises

| Promise | Result | Evidence |
|---|---|---|
| Cold load → first shot ≤ 10 s | **Pass, with a caveat** | `__flickline.timeline()` on a fresh profile: `firstRunPanelShown` at 474 ms after navigation, and pointer lock 420 ms after the click (software GL). The machine needs under 1 s, which leaves about 9 s for a person to read one panel, click and shoot an orb already on screen. Caveat: that first shot lands in free play, not in a run (#146). |
| Restart ≤ 250 ms | **Pass** | Backspace during a Cold Start run, 5 presses: key to next drawn frame was 96.6 ms on the first press (cold JIT), then 17.1, 21.4, 8.0 and 11.9 ms. The results card is built in 9.6 ms, and Enter on it restarts at once. |
| Each §7.1 event produces its sight and its sound | **Pass** for every first-playable event | See the table below. Every cue was drawn on the frame of its event (`fx().latencyMax 0`, `late 0`). |
| Placement converges: New and Competitive self-reports give different dials over three runs | **Fail as shipped. The model passes when driven directly.** | No click in the game starts the Placement run, and the self-report chip never reaches the skill model (#146). Driven directly with the bot (New = skill 15, Competitive = skill 75, seeds 1–3), the flick posterior ends at 43.1, 37.7 and 47.9 for New against 54.7, 60.0 and 53.8 for Competitive. That is clearly different, and each group agrees within about 10 points. Over 10 seeds the gap is 13.7 points and the ranges do not overlap. |
| Results card correct | **Pass, with two notes** | A Cold Start run (seed 11) matches the run's stats exactly: 43 % (32 of 74), 81 % HS (26 of 32), 680 ms median time to shot, 26 kills (24 clean), first-shot kills 55 % (22 of 40), pre-aim 19.3°. Notes: on the run that sets a first personal best the card says "Personal best: —", and in one-bullet modes it shows "Time to kill 0 ms" (#175). |
| Frame time at Low and High (perf harness, #28) | **Recorded, but on software GL only** | Renderer `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)`, so there is no GPU on this machine. 20 s scene at 1920×1080: **Low** averages 196 ms per frame (p99 317, worst 350), CPU in the frame callback 3.54 ms (p99 10.8). **High** averages 216 ms (p99 400, worst 400), CPU 3.89 ms (p99 15.5). Both have 12 draw calls and 2,168 triangles, and both pass the smoke thresholds. Allocation is about 78 KiB per frame and 248 B per sim tick (#152). Real-GPU numbers belong to #55. |

### §7.1 events: sight and sound

The events were scripted in the browser by spawning Posts and firing through the debug hook. Sound was read from the audio engine's scheduled-play log (`__flickline.audio()`), and sight from frame captures (`shot-feedback-sequence.png`).

| Event | Sound scheduled | Sight captured |
|---|---|---|
| Shot fired | `shotKestrel` / `shotPace`, ±3 % pitch jitter (rates 0.97–1.03 seen) | white tracer, muzzle flash, ammo count drops |
| Moving shot | `movingShot` layered under the shot | amber dashed tracer (panel 5) |
| Miss | `miss` at the impact point | ghost ring on the nearest head, plus an offset line to it (panel 6) |
| Body hit | `hitBody` | white four-tick hitmarker, target flashes white (panel 1) |
| Leg hit | `hitLeg` | dimmer tick |
| Headshot | `hitHead` (the 1.9 kHz tink) | gold hitmarker |
| Kill | `kill` with its ladder step, plus `killSparkle` on a head kill | gold burst, `+150`, `RT · TTK` readout (panel 2); shatter at 150 ms (panel 3); gone by 350 ms (panel 4) |
| Chain | `chain` layers, up to 3 per kill | `SURGE CHAIN ×n` counter |
| Clean streak and ladder | `kill` pitch step rises with the streak and caps at 8 (Orbit bot run: step 8 by kill 9) | multiplier ×1.0 → ×3.0, streak ring |
| Taking damage | `damageThud`, plus the master low-pass dip (900 Hz, 300 ms) | red directional arc on the shooter's side (canvas readback: 6,389 red pixels, centroid upper-right for a bearing of 60°), desaturation. Two HP bars, one covering the stat strip (#140) |
| Run end | `resultsFanfare` on the timer, `runEnd` on quit | card over the frozen last frame |

## Numbers

**Yardstick (interim).** Every value in spec §7 that the build implements, plus every behaviour #64 lists. Each was measured through the real sim where measurable, and statused match / deviation / not implemented / placeholder-match. Pass rule from design §14.7: every in-scope value has a row, and there are zero unexplained mismatches.

**Counts (118 rows):** 45 match · 36 placeholder-match · **24 deviation** · 13 not implemented.

- **Matches:** tick 128 Hz; hFOV 103° and the 70.53° vertical; 0.07°/count and the cm/360 formula; fire rate (Kestrel 110 shots in 10 s, Pace 6.748/s with an ideal clicker); magazines, reload and equip to the tick; every damage band; the armour rule; all 36 bullets-to-kill cells; first-shot spread; max spread; recovery; Kestrel and Pace movement errors at their own speeds; landing inaccuracy; the recoil data; the tag cap value.
- **Not implemented**, as expected for the first playable: the other archetypes, ADS and scopes, wall penetration, moving targets.

**Deviations, each with its reason:**

| # | Deviation | Reason on record |
|---|---|---|
| D1, D16, D19 | Player speed ignores the equipped weapon: Pace runs 5.4 instead of 5.7375 m/s, so its tag cap and observed movement error are off | #73 (equipped run speed) |
| D2, D19 | Crouch-walk 2.2 m/s (0.407 of run) instead of 1.84 m/s (0.34): Kestrel crouch-walk error is +1.33° instead of +0.8° | #73 |
| D3–D6 | Acceleration 0.078 s instead of 0.20 s; one 70 m/s² brake instead of two bands; stop 0.078 s instead of 0.160 s; first zero-error shot 0.0625 s after release instead of 0.100 ± 0.01 s | #73; `config/movement.ts` header ("placeholder") |
| D7–D10, D12 | Gravity 22 (spec 20), takeoff 6.0 (spec 6.32), apex 0.795 m (spec 1.0), airtime 0.539 s (spec 0.63), air acceleration 12 (spec about 6.8) | #73 |
| **D11** | **Horizontal speed is not kept in the air: with keys released the player brakes to 0 before landing** | **none (unexplained).** Added to #73 by comment |
| D13–D15 | Crouched hull 1.40 m (spec 1.30), eye 1.22 m (spec 1.17), transition 0.094 s (spec 0.15 s) | #73 |
| D17 | Tag release is 0.1 s ramp + 0.5 s release (0.6 s after one hit) | code comment and test, but not in the spec. #177 |
| D18 | Flinch recovers at one angular rate: body kick 0.075 s, leg 0.0375 s | config comment, not in the spec. #177 |
| D20 | Tracer 80 ms instead of the spec's 60 ms placeholder | design §7.1. #177 |

None of the 939 tests fails on these, because the movement tests read their expected values back from the tunables. That gap goes to #64 (comment posted there).

Mitigation for this build: Orbit and Placement lock movement, and Cold Start is played standing, so the drills of the first playable exercise only rows that match. That does not change the verdict: free play and every first-release mode run on this movement, and stop-to-shoot is spec §8's second-ranked transfer mechanic.

**Numbers verdict: FAIL.** One deviation (D11) has no written reason, and 20 more are known placeholders waiting on #73.

**Follow-ups (numbers):** #73 (movement model; comment posted with the measured values), #177 (record the spec readings), #64 (absolute-value tests; comment posted).

## Feel

**Yardstick (interim).** The areas and items listed in #65's acceptance criteria, each scored 0/1/2 (different / close / indistinguishable in the intended way). The example pass rule from #65: at least 80 % of points, no area below 60 %, no zero on a critical item.

Judgements are made against written descriptions only. No reference-game audio, video or image was used (design §16). A **2** needs a measured relationship that matches. An item that can only be fully judged side by side with the reference game is capped at **1** and marked †.

| Area | Item | Score | Evidence |
|---|---|---|---|
| Recoil | Visual kick and recovery shape | 1† | The viewmodel animates the sim's recoil (#141). View recovers at 8°/s after 0.35 s. |
| | Spray rhythm | 2 | 20-bullet spray: intervals of 0.086–0.094 s (11 rps), no stutter |
| | Pitch-up, then sideways break | 1† | Measured: +0.30° per bullet for bullets 1–11 (to 3.3°), then the climb flattens (+0.07) and yaw drifts 0.15° per bullet. The shape is right. No side switch within 20 bullets (10 % chance per bullet after 0.6 s). |
| | First-bullet crispness | 2 | First shot: spread 0.20°, recoil 0 |
| | Tap versus spray difference | 1† | Taps 0.26 s apart still stack 0.3° each, because Kestrel recovery is 0.35 s. That matches the spec, but feel is unconfirmed. |
| Movement | Acceleration and stop snap (**critical**) | **0** | Stop takes 0.078 s against 0.16 s, so it is twice as snappy (D3–D6) |
| | Counter-strafe responsiveness (**critical**) | **0** | Same root cause: accurate 37 ms early |
| | Strafe direction change | 0 | Same 70 m/s² model |
| | Jump and landing | 1 | Apex 0.8 m, airtime 0.54 s, air speed not kept (D7–D11). Landing sound and +7° landing error are present. |
| | Camera and eye height | 2 | Eye at 1.62 m standing, matching the spec |
| | Crouch | 1 | Eye 1.22 m (spec 1.17), transition 0.094 s (spec 0.15 s) |
| Shot sounds | Cadence readability | 1† | 2 ms transient on each shot. Kestrel's 152 ms body overlaps the next shot (91 ms apart) without smearing the attack. |
| | Body/tail balance per weapon class | 1† | Pace is high and dry (82 ms, centroid 920 Hz). Kestrel is mid and punchy (152 ms, centroid 270 Hz). The classes are distinct, but the rifle tail is short. |
| | Repetition | 2 | ±3 % pitch and gain jitter per play, seen in the play log |
| | Loudness relationships | 2 | Weapons peak at −15 dBFS and hits at −12. Ducking keeps hits at least 6 dB over the weapons bus (docs/audio.md). |
| Hit and kill sounds | Headshot clearly distinct from body | 2 | `hitHead` has 89.8 % of its energy above 1.5 kHz; `hitBody` has 0 % |
| | Confirmation latency | 2 | Hit cue scheduled in the same tick as the shot; visual cue drawn in the same frame (0 late) |
| | Kill confirmation without looking | 2 | Kill chime, plus a sparkle on head kills, plus chain layers: three distinct layers |
| | Pitch and streak behaviour | 2 | The ladder steps with the clean streak and caps at step 8. `streakBreak` plays on a break. |
| Hit response | Hit-marker timing and size relationships | 2 | Body hit gives a small white marker (90 ms), a head hit a larger gold one, a kill the largest gold burst (frames 1–2). The kill `+150` covers the crosshair for the first frames (#176). |
| | Flinch | 1 | 0.6° body kick measured. Recovery differs from the spec's (D18). |
| | Tagging feel when shot | 1 | The cap matches. Release takes 0.6 s (D17). |
| | Damage cue | 1 | The arc, desaturation and low-pass dip all present. Two HP bars, one over the stat strip (#140). |
| Timing | Input latency | 2 | Look applies in the `mousemove` handler and the camera renders live angles. Every feedback cue lands on the event frame. |
| | Fire cadence | 2 | 11.0 and 6.75 rps, matching the spec |
| | Reload and equip rhythm | 1 | Timings match to the tick, and the reload out/in cues play. The animation was not judged frame by frame. |
| View | FOV | 2 | 103° horizontal, 70.53° vertical, locked |
| | Viewmodel | 1† | Procedural, right-handed, recoil, equip and reload animation (#141) |
| | Crosshair behaviour | 2 | Static by default, no movement bloom. A gap pulse on headshots. Editor and share codes are present. |

| Area | Points | % |
|---|---|---|
| Recoil | 7 / 10 | 70 % |
| Movement | 4 / 12 | **33 %**, two critical zeros |
| Shot sounds | 6 / 8 | 75 % |
| Hit and kill sounds | 8 / 8 | 100 % |
| Hit response | 5 / 8 | 63 % |
| Timing | 5 / 6 | 83 % |
| View | 5 / 6 | 83 % |
| **Total** | **40 / 58** | **69 %** |

**Feel verdict: FAIL.** The total is under 80 %, movement is under the 60 % floor, and two critical items score zero. Every movement point is lost to numbers (#73). Per design §14.7 feel tuning may not touch those values, so the movement fix belongs to the numbers track. Away from movement, the feedback layer (sounds, markers, timing) is already at or near the bar.

**Follow-ups (feel):** #73 (movement, the root cause of the movement zeros), #176 (kill text over the crosshair), #140 (two HP bars). Items marked † need the side-by-side judging that #65 will define (#67).

## Fun

**Yardstick (interim).** The criteria and proxies listed in #66's acceptance criteria. There was no human tester in this pass. The question set was answered by the playtester running the build, through the looked-at browser session plus 755 bot runs. Human answers remain open for #56.

### Measured proxies

| Proxy | Cold Start | Orbit | Placement | Pass rule used |
|---|---|---|---|---|
| Restart friction | 8–97 ms from key to frame; card skippable at once; no timer between `result` and `ready` | same | same | ≤ 250 ms, no forced wait |
| Success-rate band (settled, bot skills 10–90) | **51.4–55.5 %** | 68.6–71.0 % | 67.7–74.5 % | 60–80 % at every skill |
| Within-run swing (per 10 s beat, settled) | 97–100 % → 10–39 % | 96–100 % → 27–39 % | flat (staircase) | not set. Reported for #68 |
| Dead air (longest gap with no live target) | 0.90 s | 0.20 s | 0.90 s | ≤ 1.5 s |
| Reward cadence (median of each run's longest stretch with no reward) | **11.6–13.8 s** (worst 25.9 s) | 5.8–7.0 s (worst 22.2 s) | 3.0–6.1 s (worst 9.6 s) | no 10 s drought in a matched run (judgement) |
| Variety | 16 anchors; 34.6 % of spawns return to the spot two before | every position fresh | every position fresh | no memorisable pattern |
| Dial follows skill | after 10 runs: 38.6 → 65.8 | 30.7 → 53.1 | final staircase 30.0 → 56.4 | low skill ends lower |

### Criteria

| Criterion | Pass/fail | Notes |
|---|---|---|
| Restart friction | **Pass** | Backspace and Enter restart in milliseconds, with nothing to dismiss |
| Flow (edge of ability, 60–80 %) | **Fail** (Cold Start) / Pass (Orbit, Placement) | Cold Start's 0.55 target sits below the band, and 94–99 % of its failures at skill 50+ are exposure timeouts, not precision misses (#170). Both drills swing hard within a run, and run 2 overshoots after an easy run 1 (#171). |
| Clarity of feedback | **Pass** | Every event answers with its own sight and sound in the same frame. The miss ghost ring and offset line show where the shot went. Only the damage HUD duplicates (#140), and that is outside the first-playable modes. |
| Reward cadence | **Fail** (Cold Start) / Warn (Orbit) | Long kill droughts cluster in the hard wave beats (#172) |
| Variety | **Warn** (Cold Start) / Pass (Orbit, Placement) | Cold Start ping-pongs between Posts (#173) |
| Pacing (no dead air over 1.5 s) | **Pass** | Longest gap 0.90 s. Caveat: an off-screen Orbit or Placement spawn can sit unseen while its clock runs (#143). |
| Moments of delight | **Pass** | The kill shatter, the rising chime ladder, chain layers and the floating `RT · TTK` all read as a reward. Orbit with a good streak feels fast and musical. |
| Frustration points | **Fail** | (1) The first click drops a new player into free play: no timer, no run, no card, no rating (#146). (2) In Cold Start a "failed" trial can still play the full kill reward when a follow-up bullet lands within 0.25 s, which teaches spray-after-miss in a first-bullet drill (#174). (3) A Beacon expires before it can be seen (#143). |
| "One more run" pull | **Warn** | Enter restarts at once and Today's session suggests the next drill. The first personal best is not celebrated (#175), and the one-thing-to-fix stub said "Nothing stood out" on a 43 % / 680 ms run (the ranked engine is #39). |
| First-minute experience | **Fail** | The designed minute (§2: click → 45 s Placement → first rating card) does not happen (#146). The skill model is also not persisted (#38). |
| Flagship game-ness (Sweep) | n/a | Sweep is first-release scope (#51) |

### Question set (interim, answered by the playtester, 1–5)

- How quickly were you shooting? **5.** The orbs are already on screen behind the panel.
- Did you always know what just happened to your shot? **5.** The marker, the colour of the tracer, the ghost ring and the sound always agree.
- Did difficulty feel matched? **3.** Orbit's runs feel matched. Cold Start alternates trivially easy and impossible stretches.
- Did kills feel rewarding? **5.** The ladder and shatter carry it.
- Did you want another run right away? **4** for Orbit, **3** for Cold Start.
- What made you stop? Cold Start's 10–25 s stretches of Posts leaving before a shot, and after the first click, not knowing what I was meant to be doing in free play.

**Fun verdict: FAIL.** The core loop (restart, pacing, feedback, kill reward) is in place and Orbit plays well. But the first-minute experience fails outright, and the precision drill misses its success band and reward cadence.

**Follow-ups (fun):** #146, #170, #171, #172, #173, #174, #175, plus #143 and #38.

## Recommendation

**Not ready** to call this build the first playable. The loop that the first playable is meant to prove is mostly there: instant restart, same-frame sight and sound for every event, a rewarding kill, and Orbit at the edge of ability. But the first minute does not happen, the movement model is still the scaffold placeholder, and Cold Start does not hold players at the edge.

Top 5 follow-ups across the three tracks:

1. **#146: start the Placement run on the first click with the self-report prior** (fun, and the placement promise), together with persisting the skill model (#38).
2. **#73: apply spec §2 movement** (numbers, and through it every feel zero). Include D11, air speed kept from takeoff.
3. **#170 with #172: Cold Start's success band and reward droughts** (fun). One tuning pass in #68 should take both.
4. **#171: damp the in-run wave swing and the run-2 overshoot** (fun).
5. **#64, #65, #66: land the three yardsticks** so the next pass (#56) scores against real documents instead of this pass's interim ones.
