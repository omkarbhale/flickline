# Flickline feel checklist

How the **Feel similarity** quality track is judged (design §14.7). The question: **independent of the numbers, do recoil, movement, shot sounds, hit and kill sounds, hit response and timing feel like the reference game?** Tracking issue: [#62](https://github.com/omkarbhale/flickline/issues/62). Written by [#65](https://github.com/omkarbhale/flickline/issues/65). Filled in by the playtest passes ([#29](https://github.com/omkarbhale/flickline/issues/29), [#56](https://github.com/omkarbhale/flickline/issues/56)) and used as the to-do list of the feel tuning pass ([#67](https://github.com/omkarbhale/flickline/issues/67)).

Numbers can match while recoil, movement snap, shot and kill sounds, hit response and timing still feel different. This page describes those things in Flickline's own words so a reviewer can look and listen and score them. It describes behaviours, relationships and timings. **No reference audio, video or image is stored in the repo, copied, recorded, ripped or embedded, and none is described as a sample to reproduce** (design §16). Sounds stay synthesised from code and are tuned until the items pass; they are never tuned *toward* a recording.

## 0. Contents

1. What this page judges, and what it does not · 2. How to score · 3. Ways to capture evidence (C1 to C8) · 4. Recoil (RC) · 5. Movement (MV) · 6. Shot sounds (SS) · 7. Hit and kill sounds (HK) · 8. Hit response (HR) · 9. Timing (TM) · 10. View (VW) · 11. Scoring sheet template and pass rule · 12. Open questions and their default answers · 13. Sources

---

## 1. What this page judges, and what it does not

- **Judged here:** shape, rhythm, relationships and timing of what the player sees, hears and feels, against a *description* of the reference game's behaviour built from public sources (patch notes, Riot posts, the Riot wiki, public analyses, community measurements).
- **Not judged here (other tracks, never merged with this one):**
  - A value that has a row in `docs/conformance.md` (speeds, damage, spread, fire rate, FOV, sensitivity scale, reload times): **numbers track** ([#61](https://github.com/omkarbhale/flickline/issues/61), [#64](https://github.com/omkarbhale/flickline/issues/64)). Items below cite the spec section but never restate its numbers. If feel can only be reached by changing such a value, file an issue on the numbers track.
  - Whether it is fun, whether rewards pace well: **fun track** ([#66](https://github.com/omkarbhale/flickline/issues/66)).
  - Whether a mode builds a habit that fails in the reference game: **transfer track** (`docs/transfer-checklist.md`).
- **Flickline's own feedback is product, not a copy of anything** (vision principle 8). The kill chime ladder, the gold headshot marker, the kill shatter, the moving-shot tock and the damage arc exist only in Flickline. Each item says whether it is judged against the reference (**Ref**) or against Flickline's own design intent (**Own**), and what "indistinguishable in the intended way" then means:
  - **Ref** items: does the behaviour match the described reference behaviour? Each cites the public source that describes it, or says plainly that none exists and flags the item **R** (section 2.3).
  - **Own** items: does the cue do the job design §7 / §12 gives it, *without* damaging a reference-like feel (no extra camera shake, no covered crosshair, no delayed shot)? These are the guard rails that keep Flickline's feedback from costing transfer.
- **Conflicts are filed, not silently resolved.** Polish never costs gameplay (vision principle 8). If a checklist item and a fun or design decision pull apart, write it on the issue and file it with the `quality:feel` label.

## 2. How to score

### 2.1 The 0 / 1 / 2 scale

| Score | Meaning |
|---|---|
| **0** | **Different.** The reviewer can tell at once, or the item is missing or broken. Each item states its own 0. |
| **1** | **Close.** A reviewer who is looking for it finds a difference; a player who is not looking would not name it. |
| **2** | **Indistinguishable in the intended way.** For **Ref** items: equal to the described reference behaviour. For **Own** items: the cue does exactly its designed job and costs nothing elsewhere. |

Item text defines 0, 1 and 2 for that item. Where an item says "per weapon", score every weapon in the build's scope (Pace, Kestrel, Vane, Rill; Longnail is later) and record the **lowest** as the item score, naming that weapon in the notes. A critical zero on any weapon is a critical zero.

### 2.2 Critical items

An item marked **critical** fails its whole area if it scores 0. Critical items are the ones where a different feel would change what a player learns or break the core promise of fast, trustworthy answers: where the shot goes, how it stops, whether a hit registers and is heard, whether anything hides the crosshair, whether input is delayed.

### 2.3 Who can judge what

| Tag | Meaning | Who |
|---|---|---|
| **M** | Measurable with tooling in this repo (a command, a script, a capture). | An agent can score it alone. |
| **H** | Needs a person's hand, ear or eye on real hardware (a real mouse, headphones, a real display). | A person, or an agent says it cannot and leaves the item **unscored**. |
| **R** | Needs the reference game **side by side** with Flickline: the description is not precise enough to score a 2 without feeling both. Flagged so the judge knows. | A person with the reference game, see C8. |

An item can carry several tags; it is scored with the strongest evidence available and the tags it could not satisfy are listed in the sheet. **An agent never scores an `H` item from measurements alone and never scores an `R` item 2 from description alone**; it records what it measured and leaves the item `unscored (needs H)` or `provisional`. Provisional means: scored from the description and measurements, awaiting a side-by-side. Provisional scores count in the percentages but stop the verdict from being "confirmed" (section 11).

---

## 3. Ways to capture evidence

Every item names the methods it needs. Evidence goes in the sheet's notes column: a number, a link to a screenshot in the PR or the playtest report, or a short written observation. Never put reference-game footage, screenshots or recordings in the repo or on an issue.

**C1 · Stepped frame capture (sim-time exact).** Deterministic, independent of the machine's frame rate. In the page, `const f = __flickline; f.pause(); f.hideMenu(true); f.look(0, 0); f.reset(seed)`, then alternate `f.step(1, { fire: true })` (or any scripted input) with a screenshot. One image per tick, 1/128 s = 7.8125 ms apart. Use it to compare *which frame* the muzzle flash, tracer, marker, kick and sound-scheduling tick land on, and the shape of any curve over time. It does not include the browser compositor or a real display, so it cannot answer latency questions (use C6).

**C2 · Real-time capture at a known rate.** Screen-record at 60 fps or more, or point a phone in 240 fps slow motion at the screen. Write the capture rate on the sheet: timing resolution is one capture frame. Use it for "does this look right in motion" items, and (with an input event visible, such as a mouse button LED) for end-to-end latency. Your own footage is evidence for the sheet; keep it out of the repo unless a still frame is needed in a PR, and keep it of Flickline only.

**C3 · Spray and recoil measurement.** `npm run human-check` (about 4 s, no browser): 200 seeded full-magazine sprays per weapon with the per-bullet climb, sideways kick, yaw switch rate, a burst-pause-tap reset table, and the movement, tagging and flinch curves. In the page: `__flickline.spray(weapon, n)` returns each bullet's shot and impact; the Spray Wall mode draws the spray trace on the wall.

**C4 · Movement trace.** `f.runScript([{ ticks: 64, input: { moveX: 1 } }, { ticks: 1, input: { moveX: -1 } }, ...])` with `f.state().player` (position, velocity, grounded, crouching, view angles) read after each step; or the `movement` block of `npm run human-check`. Identical scripts give identical `f.hash()`, so a trace can be re-run after a tuning change.

**C5 · Audio render and measurement.** `npm run audio:snapshot` writes a waveform and spectrogram PNG per cue to `docs/audio/` and prints length, peak, centroid, dominant frequency and the share of energy above 1.5 kHz. The `sounds` block of `npm run human-check` adds onset time, time of peak, level over the first 50 ms and spectral distance between cues. In a browser, `await __flickline.audioProbe('mix' | 'spatial' | 'dip' | 'synth')` measures the real graph (ducking, HRTF direction, the damage low-pass dip, synthesis time). `__flickline.audio(n).plays` lists the last `n` scheduled voices with cue, bus, audio-clock time and gain, which is how to count that every hit got its sound.

**C6 · Latency and sight/sound timing.** `__flickline.latency.start()`, play for a minute, `__flickline.latency.report()`: for mouse move, click and key it gives the tick or frame that used it, the end of the frame that drew it and the next vsync; for each shot, hit and kill it gives when the sound was scheduled against when its frame was drawn, and the browser's reported audio output latency (also on the backtick overlay as `audio out`). Run it on real hardware; headless numbers show only that the pipeline is correct. An optional end-to-end check is a high-speed camera on a mouse button and the screen (C2).

**C7 · Blind protocol.** For ears and hands. A second person, or a randomised script (`__flickline.playCue(cue, opts)` with the screen hidden or turned away), plays cues and the scorer names them; or the scorer does a fixed drill without being told which setting is live. Record the trial count, the number correct, and the output device (headphones, laptop speakers, Bluetooth). For hand feel, play the same drill for five minutes at three separate times of day and report each, since one session proves little.

**C8 · Reference side by side (`R` items only).** The scorer has the reference game's practice range open in the same session, plays the same drill (same weapon class, same movement script), and writes the difference **in their own words** in the sheet: "Flickline stops harder", "first bullet lands lower". No clip, screenshot, recording or transcription of the reference is saved anywhere in the repo. The sheet stores the scorer's words, the score and the date. If nobody with the reference game is available, the item is scored **provisional**.

---

## 4. Recoil (RC)

Weapons in scope: Pace, Kestrel, Vane, Rill. Spec §3.3 to §3.5 owns the numbers. These items ask whether the *shape and rhythm* feel right.

Public descriptions are qualitative: the spray rifles climb almost straight up for the first several bullets, then break sideways with a sharp turn, and the yaw direction can switch under three published rules (a protected bullet count, a switch chance, a switch time) ([patch 11.08][p11.08], [a 100-spray test][win-spray], [PCGamesN][pcgamesn], [valoranttracker][vtracker]). No public source gives per-bullet degrees, and none settles whether the reference *camera* climbs with recoil (spec §3.5, [open question 1](#12-open-questions-and-their-default-answers)).

#### RC1 · First bullet is crisp · critical · Ref · M H
- **Look / listen for:** From rest, the first shot lands inside the first-shot cone around the drawn crosshair; the gun kicks, flashes and sounds on the same frame; there is no delay, drift or pre-offset. A single shot at a head-sized target at 10 m is a clean hit for a still, centred crosshair on every weapon.
- **Evidence:** C3 (bullet 1 climb and sideways = 0; first-shot spread); C1 (shot tick, flash frame, tracer frame equal); then 50 stationary first-shot taps at a head-sized target in a real browser (H), counting hits.
- **0 / 1 / 2:** **0** the first bullet is offset from the crosshair, or kick or flash lands on a different frame than the shot. **1** correct position, but kick starts one frame late or the first shot feels softer than later ones. **2** exactly at the crosshair within the cone, all signals on one frame, and the tap feels instant.
- **Sources:** the reference defines a first-shot accuracy cone per weapon and resets it only after the weapon's recovery time ([Riot wiki, Vandal][wiki-vandal], [Phantom][wiki-phantom]; spec §3.3). Riot says shots go "where you're aiming (ignoring spread or movement error)" ([hit registration post][hitreg]).

#### RC2 · Visual kick and recovery shape · Ref · M H R
- **Look / listen for:** Each shot kicks the viewmodel with a fast rise and a smooth, curved recovery (not linear, no wobble, no overshoot below rest). At rifle cadence the kicks stack: the gun rides higher during a spray and settles after. At pistol cadence it clears between shots. The kick belongs to the gun, not to a camera shake (RC9).
- **Evidence:** C1 or C2 on the viewmodel for 1 shot, a tap rhythm and a 15-bullet spray; plot gun pitch against time.
- **0 / 1 / 2:** **0** no visible kick, or kick snaps back instantly, or the gun overshoots and rings. **1** right direction and stacking but the curve feels too stiff or too slow. **2** the stacking, peak and recovery read as the reference's with them side by side (R) or, provisionally, as a smooth stacked kick with a clear decay.
- **Sources:** no public description of the visual kick; spec §3.5 treats it as presentation (the spec's recoil is the aim offset, which RC4 scores). Flagged **R**.

#### RC3 · Spray rhythm is even and in sync · Ref · M
- **Look / listen for:** In a held spray every bullet has the same spacing, and the flash, tracer, kick and sound of each bullet land together. At 60, 144 and 240 Hz displays no bullet is shown twice, skipped or lumped with its neighbour.
- **Evidence:** C1 over 30 bullets: the frame index of each muzzle flash and tracer; C2 at 60 fps and at the display's rate, counting flashes per second.
- **0 / 1 / 2:** **0** bullets visibly lump or skip, or signals of one bullet land on different frames. **1** spacing varies by a display frame at one refresh rate only. **2** even at all three rates, within sim-tick quantisation, and one frame per bullet for every signal.
- **Sources:** the reference fixes its weapons to a 128 Hz tick, so fire rates quantise the same way ([128-tick post][128tick]; spec §1.4).

#### RC4 · Pitch-up, then the sideways break · critical · Ref · M R
- **Look / listen for:** A held spray rises almost straight for the first several bullets, then breaks sideways, then the climb flattens. The break is readable on the wall: you can point at the bullet where the pattern turns. On Spray Wall the trace shows a recognisable shape, not a scribble.
- **Evidence:** C3 (mean climb and sideways per bullet; first sideways bullet; yaw switches), the Spray Wall trace, and `spray(weapon, 30)` impacts plotted at 10 m.
- **0 / 1 / 2:** **0** no straight-up phase or no sideways break, or the pattern is noise. **1** both phases exist but the turn is soft, too early or too late by more than two bullets against the public descriptions. **2** the turn lands where the public descriptions put it (within one to two bullets) and a person with the reference says it reads the same (R).
- **Sources:** [a 100-spray test][win-spray] ("hard snap" after bullet 6 or 7 for the precise rifle), [PCGamesN][pcgamesn] ("straight down, then flick to the left at the ninth or tenth shot" for the spray rifle), [valoranttracker][vtracker], [patch 11.08][p11.08] for the switch rules. The sources disagree on shape and none gives degrees, so this item is **R** for a 2.

#### RC5 · The break is neither a coin flip nor a copy · Ref · M R
- **Look / listen for:** The yaw direction can switch after the protected bullets, so two sprays are not identical, but the early part of every spray is the same and learnable. A player can predict roughly where bullet 15 goes after practice and still be surprised sometimes.
- **Evidence:** C3 (switches per spray, share of sprays that switch, share of right breaks, per bullet index).
- **0 / 1 / 2:** **0** every spray is identical, or the pattern is unpredictable from bullet 2. **1** variation exists but its rate or its first-break side feels fixed or wrong. **2** protected bullets, switch chance and switch time behave as published and the first break side is not hard-wired (a person confirms with R).
- **Sources:** [patch 11.08][p11.08] (protected count, chance and time). Whether the reference's first break always goes one way is not public, [open question 2](#12-open-questions-and-their-default-answers).

#### RC6 · Tap, burst and spray differ, and the reset is real · critical · Ref · M H
- **Look / listen for:** Spaced taps and short bursts stay accurate and return to the first-shot state only after the weapon's recovery time. A tap after a pause lands where the crosshair is, not above it. A spray accumulates spread and climb. Stopping fire and waiting gives the crosshair back at once; no hidden offset remains that the player cannot see.
- **Evidence:** C3 reset table (burst length × pause → offset of the next shot, spread of the next shot); in a real browser, burst-pause-tap at three pauses on Kestrel and Vane (H).
- **0 / 1 / 2:** **0** a tap after the recovery time still lands above or beside the crosshair, or spread never recovers (the state of the reset today is [#191](https://github.com/omkarbhale/flickline/issues/191)). **1** the offset is gone within one more recovery time. **2** the next shot after the recovery time is exactly a first shot.
- **Sources:** [patch 0.50][p0.50] defines the reset as the gun recovery time: inaccuracy accrues when the gun is "re-fired prior to a complete duration of … Gun Recovery Time". Spec §3.3.

#### RC7 · Each weapon recoils in its own character · Ref · M H
- **Look / listen for:** The accurate pistol kicks per shot and clears between taps; the precise rifle is crisp per bullet and punishes spraying; the spray rifle is smoother and controllable; the SMG is fast, light and flatter. Switching weapons, you know which one is in your hand with the sound off.
- **Evidence:** C3 per weapon (climb, spread ramp); C1 viewmodel kick of each, side by side in one picture.
- **0 / 1 / 2:** **0** two weapons are visually and measurably the same recoil. **1** differences exist in the numbers but are not visible in the viewmodel. **2** the four are recognisable by kick alone.
- **Sources:** the archetype table in spec §3.1 and §3.5; [Vandal][wiki-vandal] and [Phantom][wiki-phantom] wiki pages for the roles.

#### RC8 · Shooting while moving or jumping is visibly worse · Ref · M
- **Look / listen for:** Fire a spray standing, crouched, walking, running and in the air. The impact cloud widens in that order, recoil is stronger when running or jumping, and a crouched spray is a little tighter. The *reticle does not change* (spec §9 Q15); the player reads the state from where bullets land.
- **Evidence:** `spray(weapon, 30)` per stance, with the impact scatter at 10 m; C3.
- **0 / 1 / 2:** **0** moving and standing sprays cannot be told apart. **1** ordered correctly but one pair (walk versus run, standing versus crouched) cannot be told apart. **2** ordered as in the spec on every weapon, the reticle unchanged.
- **Sources:** [patch 4.0][p4.0] and [6.11][p6.11] (moving multiplies recoil), [0.50][p0.50] (crouched yaw recoil); spec §3.4.

#### RC9 · No added camera shake, no moving reticle · critical · Own (guard rail) · M
- **Look / listen for:** Firing does not shake, roll or zoom the camera. The only visible recoil is the viewmodel kick and where the bullets go. No muzzle flash, tracer or bloom covers the crosshair or the head-height area just above it.
- **Evidence:** C1 over a 10-bullet spray from a still view: the crosshair's screen region is the same pixels on every frame apart from the flash and tracer the design allows.
- **0 / 1 / 2:** **0** any camera shake or FOV kick on shots, or a flash that covers the crosshair. **1** a flash or tracer touches the aim area for one frame. **2** the aim area is clear on every frame.
- **Sources:** design §7.1 ("no extra camera shake"); vision principle 8.

---

## 5. Movement (MV)

Spec §2 owns the numbers (equipped run speeds, the two-band braking, acceleration time, deadzone, jump, eye heights). These items ask whether starting, stopping, reversing and jumping *feel* like the reference game's. Note that [#73](https://github.com/omkarbhale/flickline/issues/73) already tracks that the first-playable movement is much snappier than the spec; the checklist judges the feel; #73 fixes the numbers.

The best public evidence is a Riot designer's stop test, not a feel description: a counter-strafe stops a running rifle in about the time the spec records, and letting go of the keys or counter-strafing is faster than holding a walk key ([Riot developer reply][devtrack]). Acceleration, friction and air control are not public (spec §2.3, §2.6), so several items are **R**.

#### MV1 · Acceleration ramp · Ref · M R
- **Look / listen for:** Pressing a direction builds speed over a short visible ramp in every one of the eight directions: not instant, not floaty. An ex-pro coach describes players in the reference as accelerating "much slower than in any CS game" ([Sportskeeda][sk-twix]), so a very fast ramp is a likely mismatch.
- **Evidence:** C4: speed per tick after pressing a direction from rest, all eight directions (or `human-check` movement block: rest to 90%, rest to 100%).
- **0 / 1 / 2:** **0** speed jumps to maximum within a few ticks. **1** a ramp exists but a person feels it as "faster than the reference" side by side. **2** the ramp reads the same side by side (R), and diagonals ramp like straights.
- **Sources:** spec §2.3 (acceleration time is an ESTIMATE, 35% confidence); [Sportskeeda][sk-twix]. Flagged **R**.

#### MV2 · Stop snap · critical · Ref · M R
- **Look / listen for:** Releasing the keys, or tapping the opposite key, brings the player to a stop in a short, decisive slide: not a hard stick, not a long glide. The first accurate shot becomes possible at a rhythm players feel in their fingers ("tap, then click").
- **Evidence:** C4 (release to the accuracy gate, release to rest); compare the *relationship* to the acceleration ramp as well as the absolute time. C8 for the rhythm.
- **0 / 1 / 2:** **0** the stop is instant, or glides noticeably long, or the stopping time depends on which key was pressed. **1** the stop is clearly the right type but a person notices the rhythm is early or late. **2** the stop reads the same side by side.
- **Sources:** [Riot developer reply][devtrack] (0.16 s stop from run, the only first-party stop timing); [patch 3.0][p3.0] (deadzone); spec §2.3, §2.5. The numbers belong to the conformance table; the feel is this item.

#### MV3 · Counter-strafe is responsive · critical · Ref · M H
- **Look / listen for:** Tapping the opposite key stops at least as fast as releasing, and begins moving the other way only if the key is held. A player can do "tap A, shoot" at their practised rhythm and the shot is accurate; the `moving` state of the shot agrees with what the hand felt.
- **Evidence:** C4 scripts: run, then a counter-strafe tap of n ticks, then `fire`; read `shotFired.moving` for n from 1 to 20 ticks. Then H: twenty counter-strafe shots in a real browser, noting any shot that felt still but fired as moving.
- **0 / 1 / 2:** **0** counter-strafing is slower than releasing, or a felt-still shot is often flagged moving. **1** the rhythm is right but needs a different timing than the reference. **2** counter-strafe is not worse than release, the opposite key adds no delay, and the hand and the moving flag agree.
- **Sources:** [Riot developer reply][devtrack] (counter-strafe versus walk key); the community disagrees on whether counter-strafe beats plain release ([The Spike][spike-cs], [Wooting][wooting]); spec §2.3 (equal by default, tunable).

#### MV4 · Strafe reversal and diagonals · Ref · M
- **Look / listen for:** Holding A then switching to D slows through zero and speeds up the other way: no instant flip, no overshoot, no speed gain. Moving diagonally is never faster than straight. Releasing one of two held keys eases into the remaining direction.
- **Evidence:** C4 script: 64 ticks of `moveX: 1`, then `moveX: -1`; and `moveX: 1, moveZ: 1`.
- **0 / 1 / 2:** **0** diagonal faster than straight, or the reversal flips instantly. **1** shapes right but the reversal time feels too short or too long. **2** reversal passes through the stop band and the other direction accelerates like a start from rest.
- **Sources:** spec §2.3 ("an opposite key additionally starts accelerating the other way at the normal rate").

#### MV5 · Walk and crouch-walk feel like deliberate slow · Ref · M H
- **Look / listen for:** Holding walk makes you clearly slower, with no accuracy penalty beyond the spec's, and with no footsteps (design §12). Crouch-walk is slower still. Entering and leaving walk does not jolt the view.
- **Evidence:** C4 speeds; a footstep-count check from the event log over 10 s of walking; H for the felt "slow".
- **0 / 1 / 2:** **0** walk is not visibly slower, or makes footsteps. **1** slower and quiet, but the transition jolts. **2** smooth, quiet, slower.
- **Sources:** Riot publishes no walk or crouch-walk multiplier ([Riot support][riot-walk]; spec §2.2, ESTIMATE). The *feel* is described, not measured, so a 2 is provisional.

#### MV6 · Jump · Ref · M H R
- **Look / listen for:** Jump starts on the first tick after the key press; a clean arc with a symmetric rise and fall and a brief hang at the apex; horizontal speed is kept, never increased; air control is weak. Repeated jumping gains no speed.
- **Evidence:** C4 jump scripts: height against time, speed before and after; C1 side-on capture of the arc.
- **0 / 1 / 2:** **0** speed gain from jumping, or the key press is lost between frames. **1** arc plausible but takeoff, apex or fall feels off against the reference. **2** matches side by side (R).
- **Sources:** no public jump height, airtime or gravity (spec §2.6); [bunny hopping gives no gain][bhop] in qualitative sources. Flagged **R**.

#### MV7 · Landing · Ref · M H
- **Look / listen for:** Landing costs no speed. The landing cue plays on the contact tick, heavier for a longer fall. A shot fired in the landing window is visibly inaccurate; the player is not stunned or slowed.
- **Evidence:** C4 (speed through landing); C5 (`land` onset); `spray` or `fire` in the 0.2 s after landing.
- **0 / 1 / 2:** **0** landing slows or freezes the player, or the sound is late. **1** correct, but the sound is quiet or the inaccuracy invisible. **2** instant, audible, inaccurate shots.
- **Sources:** [patch 1.09][p1.09] (landing inaccuracy); spec §2.6, §9 Q14.

#### MV8 · Camera height is steady and smooth · critical · Ref · M H
- **Look / listen for:** The eye height does not bob, snap or step while running, strafing or stopping. It changes only on crouch and jump. At 144 Hz and above, stepping up a ledge and landing show no stair-stepping, even when the display rate is not a multiple of the tick.
- **Evidence:** C1 or C2 capture of a run along a wall: horizon height per frame; step up a ledge; read `state().player` eye height each tick.
- **0 / 1 / 2:** **0** a visible bob, snap or one-frame jump of the horizon. **1** a tiny step on ledges or landing at some display rates. **2** a flat horizon in every case.
- **Sources:** no public eye height (spec §2.7, estimates); spec §1.4 (render at the display rate with interpolation); architecture #54 §4 (every moving thing keeps `prev*` copies).

#### MV9 · Crouch · Ref · M H
- **Look / listen for:** Crouching lowers the view over a short smooth transition, not a one-frame pop (the first-playable pop is tracked in [#73](https://github.com/omkarbhale/flickline/issues/73)). Crouched, you are slower, a little more accurate and have a lower hitbox; standing up under a low ceiling is blocked without a jolt.
- **Evidence:** C1 horizon per tick through a crouch down and up; C4 speed.
- **0 / 1 / 2:** **0** the eye moves in one tick, or standing up under a ceiling clips. **1** smooth, but the duration reads too fast or slow. **2** smooth and correct.
- **Sources:** spec §2.7 (0.15 s transition is a PLACEHOLDER); [Riot hit registration post][hitreg] (hitboxes follow the pose).

#### MV10 · Walls and ledges do not snag · Ref · M H
- **Look / listen for:** Running into a wall at an angle slides along it at the speed along the wall. Corners do not catch. Small ledges are stepped over without a jump and without a hitch. Peeking around a corner, which is the core movement of the reference, is never interrupted by the geometry.
- **Evidence:** C4 scripts: run into a wall at 45° and at 10°; run along a wall past a doorframe; step onto a 0.3 m riser; 20 repetitions of a peek past a pillar in a real browser (H).
- **0 / 1 / 2:** **0** speed drops to near zero on a wall, or the player catches on a corner. **1** a slight hitch at a seam. **2** no hitch anywhere.
- **Sources:** none public; standard expectation of movement in any shooter, and spec §2.7 (step height).

---

## 6. Shot sounds (SS)

Design §12 and `docs/audio.md` own the recipes and mix levels. Sounds are synthesised, so these are Flickline's own sounds; the items judge the *relationships* a gun sound needs to have, not likeness to any recording. **Never use a recording of the reference as a target.**

#### SS1 · Cadence is readable · critical · Own · M H
- **Look / listen for:** In a held spray, each shot is its own event: you can count the rate by ear. The tail of one shot never covers the attack of the next. A 30-round spray reads as a rhythm, not a smear.
- **Evidence:** C5: level 30 dB under each shot's peak is reached before the next shot starts (human-check measured this for the Kestrel); onset of every shot in the `plays` log. C7: hide the screen, play 5, 8, 11 and 13 shots per second, name the rate.
- **0 / 1 / 2:** **0** shots blur into a wash, or the rate cannot be told. **1** countable but fatiguing, or a weapon with a long tail blurs at full rate. **2** the rate is identified correctly in at least 90% of blind trials.
- **Sources:** the reference's fire rates are in spec §3.1. no public source on gun-sound legibility; the minimum durations and separations that keep short sounds distinct are in [cue research][cues] §3.5.

#### SS2 · Body and tail balance per weapon class · Own · M H
- **Look / listen for:** Pistol: high, dry, short. Rifles: a punchy body with a short tail. SMG: tight and fast. Sniper: deep with a long tail. Order by tail length and low-end weight is sniper over rifle over pistol and SMG; by brightness, the opposite.
- **Evidence:** C5 table (length, centroid, dominant, energy above 1.5 kHz per weapon); spectrogram images.
- **0 / 1 / 2:** **0** two classes are indistinguishable in spectrum and length, or the order is wrong. **1** the order is right but a class is generic. **2** the order is right on tail, brightness and weight, and a class has a clear character.
- **Sources:** design §12 (per-weapon descriptions). The classes follow the archetype roles in spec §3.1.

#### SS3 · Sharp onset, with the flash · Own · M
- **Look / listen for:** Each shot has an immediate attack with no leading silence, and its onset is scheduled in the same tick as the muzzle flash.
- **Evidence:** C5 (`onsetMs` from the `sounds` block: the time to the first sample above 1% of the peak); C6 (shot sound scheduled offset against the draw).
- **0 / 1 / 2:** **0** a pre-roll of more than 5 ms, or the sound scheduled in a later tick than the flash. **1** onset under 5 ms but the scheduling offset is a frame. **2** onset under 5 ms and scheduled with the shot's tick.
- **Sources:** [ITU-R BT.1359][itu] (sound early or late detectability); [cue research][cues] §3.6.

#### SS4 · Repetition without a machine gun · Own · M H
- **Look / listen for:** Successive shots differ slightly so a spray is not one sample on repeat, but not so much that the weapon changes identity or the rate blurs.
- **Evidence:** the `plays` log (rate and gain per shot for a 30-round spray); C7 listening.
- **0 / 1 / 2:** **0** shots are identical, or jitter is wide enough to change the weapon's identity. **1** jitter is audible as a flutter. **2** a few percent of variation, perceived as natural.
- **Sources:** design §12 (±3% pitch and gain per shot); [cue research][cues] §2 (pitch resolution about 0.5 to 1%).

#### SS5 · Loudness relationships between weapons · Own and Ref · M R
- **Look / listen for:** No weapon is accidentally dominant. The relationships between weapons are the ones the design intends (equal peaks, so a sniper reads as bigger by its tail rather than its level), and the hit cues sit above them in every case (HK6).
- **Evidence:** C5 (peak and level over the first 50 ms per weapon); C7 level-matching test: two weapons in sequence, is one clearly louder?
- **0 / 1 / 2:** **0** one weapon is more than 6 dB louder than another in the first 50 ms without a design reason. **1** a difference of 3 to 6 dB. **2** within 3 dB, or the differences match the design.
- **Sources:** relative loudness of the reference's weapons is not public; flagged **R**. A 6 dB step is a clear categorical level change ([cue research][cues] §2).

#### SS6 · Weapons are told apart by ear · Own · H
- **Look / listen for:** With eyes shut, a single shot names the weapon.
- **Evidence:** C7, 4-way blind identification, n of at least 20.
- **0 / 1 / 2:** **0** under 60% correct, or a weapon has no sound of its own (a shared shot sound counts as 0 for that weapon). **1** 60% to 89%. **2** at least 90%.
- **Sources:** [auditory icons][cues] (cue research §9, S10). The Vane has no sound of its own yet ([#168](https://github.com/omkarbhale/flickline/issues/168)).

#### SS7 · Sound does not fatigue · Own · H
- **Look / listen for:** After 60 seconds of full-magazine fire at the default volume nothing grates: no hiss, no high-frequency spike, no clipping.
- **Evidence:** C7 listening log (headphones and laptop speakers); C5 peak at the master limiter ("mix" probe).
- **0 / 1 / 2:** **0** the listener wants the volume down within a minute, or the limiter clips. **1** mild fatigue at one speaker type. **2** none.
- **Sources:** design §12 mix targets; `docs/audio.md` mix measurement.

#### SS8 · Enemy shots are not your shots · Own · M
- **Look / listen for:** An enemy's shot is dull and positioned; yours is bright and centred. You never take one for the other and you can hear which side it came from.
- **Evidence:** C5 centroid difference and `audioProbe('spatial')`.
- **0 / 1 / 2:** **0** the same timbre, or no left/right difference. **1** differs in timbre only. **2** differs in timbre and direction.
- **Sources:** design §12; `docs/audio.md` ("Direction (HRTF)").

---

## 7. Hit and kill sounds (HK)

Public descriptions of the reference's cues are thin. One report describes its own headshot cue as a low, resonant metallic thump ([Kotaku][kotaku]). Flickline's cues are its own: a high "tink" for a headshot, a pitched ladder for kills. **The cues only need to be learnable and never confusable, not identical.** The checks below hold that line.

#### HK1 · Headshot is clearly distinct from body · critical · Own · M H
- **Look / listen for:** A headshot and a body hit are different families you can tell without looking: different band, different length. This is learned in under a minute and never confused afterwards.
- **Evidence:** C5 (spectral distance; the headshot's energy above 1.5 kHz against the body's; the cues in separate bands); C7 blind trials of 20 hits (mixed body, head), on headphones and on laptop speakers.
- **0 / 1 / 2:** **0** under 90% correct on headphones, or the spectra overlap. **1** at least 95% on headphones and under 90% on laptop speakers. **2** at least 95% on headphones and 90% on laptop speakers.
- **Sources:** [cue research][cues] §3 (bands apart by at least 3 ERB; leg versus body is the closest pair); [Kotaku][kotaku] (the reference's own cue is different by design).

#### HK2 · Body and leg are told apart · Own · M H
- **Look / listen for:** A leg hit is clearly weaker than a body hit by pitch, level, length and attack together, and it is identified alone, not only by comparison.
- **Evidence:** C5 spectral distance (body to leg is the closest pair in the set); C7 blind 20 trials of body and leg only.
- **0 / 1 / 2:** **0** under 80% correct. **1** 80% to 94%. **2** at least 95% on headphones; under laptop speakers at least 85%.
- **Sources:** [cue research][cues] §3.1 and §3.2 (small speakers roll off the low band).

#### HK3 · Confirmation latency · critical · Own · M
- **Look / listen for:** The hit sound starts in the same sim tick as the hit, and the player sees the marker and hears the sound as one event. Flickline confirms locally; the reference waits for the server, so Flickline must not be slower than it. At 40 ms ping the reference's hit effect arrives about 80 ms after its tracer ([Riot][hitreg]).
- **Evidence:** C6: per shot, hit and kill, `soundScheduledInMs` (the audio clock offset against the tick) and the difference between the sound's expected time and the frame's draw; the `audio out` figure on the overlay.
- **0 / 1 / 2:** **0** sound scheduled a tick or more late, or beyond the detection window (sound early by more than 45 ms or late by more than 125 ms; [ITU][itu]). **1** scheduled in the same tick, but on this device the heard offset is outside ±25 ms and inside the detection window. **2** same tick, and the heard offset within ±25 ms on a wired output.
- **Sources:** [Riot hit registration post][hitreg]; [ITU-R BT.1359][itu]; [cue research][cues] §3.6; `docs/reviews/human-check-1.md` Q7.

#### HK4 · Kill confirmed without looking · critical · Own · H
- **Look / listen for:** With the screen turned away, every kill sounds like a kill and no hit sounds like one. A headshot kill is identifiable as one.
- **Evidence:** C7: 30 events mixed (hit, kill, headshot kill), the scorer names each.
- **0 / 1 / 2:** **0** a kill and a hit are confused in more than one trial in ten. **1** at most one in ten is confused. **2** none is confused, and headshot kills are named correctly at least 90%.
- **Sources:** design §12 (the kill chime is "kill, and streak height, without looking"); [cue research][cues] §4.

#### HK5 · Every hit sounds · critical · Own · M
- **Look / listen for:** In a full-rate spray of hits, every bullet that hits has its cue: none dropped by a voice limit, a throttle or a duck.
- **Evidence:** C5 `plays` log in a 30-round spray where every bullet hits: the number of hit cues equals the number of hits. Do it at the busiest mix (kills, chain, enemy fire).
- **0 / 1 / 2:** **0** a hit has no sound in any run. **1** all hits sound in the plain spray, a drop in the busiest mix. **2** all in both.
- **Sources:** `docs/audio.md` (24-voice limit, priority cues never dropped); [cue research][cues] §3.

#### HK6 · Hit cues stay on top of the gun · Own · M
- **Look / listen for:** In a spray the hits are audible over the gunfire, and the gun briefly ducks, not pumps.
- **Evidence:** C5 `audioProbe('mix')`: hits bus over weapons bus at each of the hits; the duck depth and time.
- **0 / 1 / 2:** **0** a hit cue is under the weapon at any hit. **1** over by under 6 dB at any hit. **2** at least 6 dB over at every hit, ducking no longer than the design's 80 ms plus release.
- **Sources:** [cue research][cues] §3.3 (masking by the weapon); `docs/audio.md` ("Mix, busiest Sweep moment").

#### HK7 · The streak ladder behaves · Own · M H
- **Look / listen for:** Each clean kill is a step up the ladder, the steps are individually distinguishable, the ladder stops at the top, falls with a gentle note when the streak breaks, and starts at the bottom each run. The top step never sounds like a headshot.
- **Evidence:** C5 (the ladder image and each step's frequency; the highest step below the headshot band); C7: hear steps 1 to 8 in a shuffled order and order them.
- **0 / 1 / 2:** **0** steps cannot be ordered, or the top step collides with the headshot's band. **1** ordered, but one adjacent pair is confusable. **2** ordered correctly by at least 90%, the break is gentle, never harsh.
- **Sources:** [cue research][cues] §4 (absolute pitch identification is only 5 to 7 categories untrained; the ladder is read relatively). This is Flickline's own mechanism; nothing in the reference to compare with.

#### HK8 · Cues do not fight each other · Own · M H
- **Look / listen for:** A headshot kill sounds as a headshot and a kill and a streak step at once without either hiding the others. A chain adds layers that are not louder than the kill.
- **Evidence:** C5 spectrogram of the combined cue at three streak steps; C7: name what you heard.
- **0 / 1 / 2:** **0** a cue is inaudible in the combination. **1** all audible, but the sum is muddy at the top steps. **2** all three heard clearly at every step.
- **Sources:** [cue research][cues] §3.4 (families in separate bands).

#### HK9 · Level and comfort over a long streak · Own · M H
- **Look / listen for:** The cues are loud enough to act on and never painful; after twenty kills in a row the player is not tired by the chime.
- **Evidence:** C5 peaks against the design mix; C7 a 60-second Orbit run with sound on.
- **0 / 1 / 2:** **0** painful, or the limiter engages. **1** a person would turn it down. **2** comfortable.
- **Sources:** design §12 mix.

#### HK10 · The miss is quiet and unmistakable · Own · M H
- **Look / listen for:** A miss is a short, quiet sound at the impact point, never confusable with a hit.
- **Evidence:** C5 centroid and level; C7: hits and misses interleaved.
- **0 / 1 / 2:** **0** a miss is taken for a hit, or a hit for a miss, in the blind test. **1** correct, but the miss masks under shots. **2** correct and audible.
- **Sources:** design §12, §7.1.

---

## 8. Hit response (HR)

Hit markers, target reactions and being hit. The reference's own markers come from the server ([hit registration post][hitreg]) and Flickline's come from the local sim; the *relationships* are what is judged. The reference game has a camera aim punch when you are hit (officially documented), a tagging slow on hit ([patch 3.0][p3.0]) and a damage indicator toward the shooter.

#### HR1 · The marker appears with the shot · critical · Own · M
- **Look / listen for:** A hit marker is drawn on the same frame as the shot's impact, lasts its designed time, and is gone before the next shot's marker can be mistaken for it.
- **Evidence:** C1 or C2: marker onset frame against the shot frame; duration in frames; at 11 shots per second no marker bridges two shots.
- **0 / 1 / 2:** **0** a marker appears a frame or more late, or never goes away at full rate. **1** on the frame but one duration is off. **2** onset on the frame, durations as designed, no bridging.
- **Sources:** design §7 ("answered in the same frame"); [Riot post][hitreg] for the reference's delay.

#### HR2 · Marker size and weight relationships · Own · M
- **Look / listen for:** In one glance: kill burst larger than headshot, headshot larger than body, leg dimmer and smaller than body. Colour alone does not carry the zone.
- **Evidence:** C1 pixel extents of each marker at 1080p.
- **0 / 1 / 2:** **0** two zones look the same. **1** the order is right but needs colour to tell. **2** the order is readable by size and weight, in greyscale.
- **Sources:** design §7.1; [cue research][cues] §7 (colour-vision-safe palette).

#### HR3 · Nothing covers the crosshair or the target · critical · Own (guard rail) · M
- **Look / listen for:** No marker, burst, number or tracer covers the crosshair or the head-height area above it for more than a single frame, and the head of the target stays visible.
- **Evidence:** C1 over a kill and the next target appearing in Orbit: pixel coverage of the aim area per frame.
- **0 / 1 / 2:** **0** the aim area is covered for more than one frame. **1** a single frame. **2** none.
- **Sources:** vision principle 8; issue [#176](https://github.com/omkarbhale/flickline/issues/176).

#### HR4 · The target reacts where it is hit · critical · Own (guard rail) · M
- **Look / listen for:** A hit target flashes briefly and stays where its hitbox is. What you see is what you hit: no knockback, shake or animation moves the visible target away from its hitbox, and the next shot at the visible head hits.
- **Evidence:** C1 over a hit: target position and hitbox position per frame; 20 shots at a flashing target.
- **0 / 1 / 2:** **0** the visual and the hitbox disagree after a hit. **1** agree, but the flash hides the head. **2** agree and the head stays visible.
- **Sources:** design §7.1, §5.1.

#### HR5 · Kill reaction timing · Own · M
- **Look / listen for:** The shatter begins on the kill frame, ends on its designed time, and does not hold the crosshair. The next target is findable while the shards fade.
- **Evidence:** C1 kill sequence.
- **0 / 1 / 2:** **0** the shatter starts late or holds the aim area. **1** correct, but longer than designed. **2** on time and clear.
- **Sources:** design §7.1.

#### HR6 · Flinch (aim punch when hit) · Ref · M R
- **Look / listen for:** Being hit kicks the view briefly, more for a head hit than a body hit and leg hit least. It recovers smoothly without overshoot and never moves the aim permanently. A strength of 0 turns it off.
- **Evidence:** `__flickline.hitBy(weaponId, opts)` for each zone from a still start; view angles per frame (C1, C4); or the `tagging` block of C3.
- **0 / 1 / 2:** **0** no flinch, or it moves the aim permanently. **1** present, correct order, but the recovery looks mechanical. **2** a small kick in the right order with a smooth recovery, and a side-by-side says it reads the same (R).
- **Sources:** [patch 1.07][p1.07] (shotgun headshots give less aim punch, so aim punch officially exists); a community article on armour and flinch ([GamerIV][gameriv], one forum post). Magnitude and duration are not public (spec §4.4, PLACEHOLDER). Flagged **R**. Body and leg recovery are tracked in [#177](https://github.com/omkarbhale/flickline/issues/177).

#### HR7 · Tagging feels like being hit, not frozen · Ref · M R
- **Look / listen for:** Taking a hit while running slows you quickly into the accurate range, holds while hits continue and eases back after the last. Never a freeze or a stutter, and never a speed boost.
- **Evidence:** `hitBy` while holding a movement key, `state().player` speed per tick; C3 tagging block.
- **0 / 1 / 2:** **0** a freeze, a stutter or a speed-up. **1** a smooth slow whose ramp-in or release feels off. **2** reads the same side by side (R).
- **Sources:** [patch 3.0][p3.0] ("tagging is the slowing effect you feel when hit by bullets"); [1.02][p1.02] (ramp); spec §4.3. The ramp and release are estimates, so a 2 is **R**.

#### HR8 · Damage cue · Own · M H
- **Look / listen for:** When you are hit the direction of the shooter is readable, the screen reacts briefly and no longer than designed, and a low thud sits in the head with a short dip on the other sound. The cue does not blind the next shot.
- **Evidence:** C1 capture of the arc and vignette; C5 `audioProbe('dip')`; H on whether the next shot is playable.
- **0 / 1 / 2:** **0** no direction, or the vignette hides the crosshair. **1** readable, but longer than designed. **2** readable, short, and the next shot is playable.
- **Sources:** design §7.1, §12; `docs/audio.md` ("Damage dip").

#### HR9 · Tracer and impact agree with the shot · Own · M
- **Look / listen for:** The tracer starts at the muzzle on the shot frame and ends at the impact; the impact spark or mark appears there on the same frame and is gone on its designed time. Where the tracer goes is where the bullet went, including the recoil and spread offset.
- **Evidence:** C1: the tracer end against the logged impact point; `shotImpact` point.
- **0 / 1 / 2:** **0** the tracer and impact disagree, or the tracer is hidden. **1** agree but a frame late. **2** agree on the frame.
- **Sources:** spec §3.6 (tracers are cosmetic; hitscan); design §7.1.

---

## 9. Timing (TM)

Input latency, fire cadence, reload and equip rhythm. Flickline is plausibly several milliseconds behind a native game at the same refresh rate because the browser compositor sits between the frame and the eye (`docs/reviews/human-check-1.md` Q11); the question is whether anything else is added.

#### TM1 · Input latency · critical · Ref · M H
- **Look / listen for:** The crosshair feels attached to the hand. Mouse look is applied on every rendered frame (not on the tick), so it is never quantised; a click fires on the next tick that follows it.
- **Evidence:** C6: mouse move to the frame that drew it; click to the firing tick and to the frame that drew it, at the real display rate. Optional C2 high-speed camera for the whole chain.
- **0 / 1 / 2:** **0** the camera is driven from the tick (look quantised), or an extra frame of queue is added by the game. **1** the game's own loop adds no more than one frame plus one tick; the browser adds the rest. **2** the game adds one tick at most to a click and nothing to the look, and a person at the same refresh rate says it is not floaty.
- **Sources:** [Riot's 128-tick post][128tick] and [netcode post][netcode] (the reference runs a 128 Hz tick); [NVIDIA on aim latency][nvidia-aim] (an 8 ms difference changed aim-trainer completion time at 240 Hz); [Ivkovic et al.][ivkovic] (aiming performance drops measurably at about 41 ms); [Ink & Switch][inkandswitch] (mouse-cursor latency detection near 65 ms on average). The browser's compositor share is not measurable from the page ([Chrome on desynchronized canvases][desync]).

#### TM2 · A click becomes a shot · critical · Ref · M
- **Look / listen for:** No click is lost. A click between frames still fires. A click during the weapon's cycle either fires at the first tick the weapon allows, or is ignored consistently; the player is never left unsure whether the shot happened.
- **Evidence:** C6 `droppedClicks` in a minute of normal play; C4 script: `fire` for one tick between frames.
- **0 / 1 / 2:** **0** clicks are lost at a normal click rate. **1** none lost, but a click in the cycle is dropped silently and a person notices on the semi-auto pistol. **2** none lost, and the cycle's edge case matches the reference (R if a pistol spam test is available).
- **Sources:** not public whether the reference buffers a click during a pistol's cycle; flagged in [open question 5](#12-open-questions-and-their-default-answers).

#### TM3 · Fire cadence at the weapon's rate · Ref · M
- **Look / listen for:** A held fire button gives the weapon's rate with steady spacing; spamming a semi-auto pistol never fires faster than its rate; a click that arrives just after the cycle ends fires at the first available tick with no extra delay.
- **Evidence:** C1 over 30 ticks held; C4 script with clicks at every tick.
- **0 / 1 / 2:** **0** the rate drifts, or clicks fire faster than the rate. **1** an extra tick of delay after a cycle in some cases. **2** exact within tick quantisation.
- **Sources:** spec §3.1 (rates), §1.4 (128 Hz); [Vandal][wiki-vandal], [Phantom][wiki-phantom].

#### TM4 · Reload rhythm · Ref · M H
- **Look / listen for:** The reload key starts at once; the viewmodel and the two sounds (magazine out, magazine in) tell the player where in the reload they are, and the last beat arrives when the gun is ready. Firing is blocked until ready. A swap during a reload cancels it without a second sound, as in the reference.
- **Evidence:** C1 or C2 reload sequence with the `reloadStarted` and `reloadCompleted` ticks and the sound times in the `plays` log.
- **0 / 1 / 2:** **0** the sound or the animation ends noticeably before or after the gun is ready. **1** aligned, but the middle beat is not clear. **2** aligned and clearly paced.
- **Sources:** reload times are in spec §3.1 (numbers track); [Riot wiki weapon pages][wiki-vandal] for the reference durations.

#### TM5 · Equip rhythm · Ref · M H
- **Look / listen for:** Swapping shows the old weapon down and the new one up over the equip time, with the equip sound at the moment it is ready, and no fire before.
- **Evidence:** C1 or C2; `weaponSwitched` tick and the `equip` cue time.
- **0 / 1 / 2:** **0** the gun is shootable before it looks ready, or ready long before it can shoot. **1** one off by a frame or two. **2** aligned.
- **Sources:** spec §3.1 (equip times).

#### TM6 · Frame pacing, no first-use hitch · critical · Ref · H
- **Look / listen for:** 144 fps and above, with a flat frame-time graph while spraying and killing. No hitch the first time a shot, a sound, a kill effect or a post effect appears.
- **Evidence:** The backtick overlay's frame average, p99 and max, and the GPU model and refresh rate, at Low and High. Cold load then the first minute. **This can only be judged on real hardware**; headless software rendering measures the machine, not the game.
- **0 / 1 / 2:** **0** under 120 fps on the target hardware, or a hitch above 50 ms on first use. **1** 120 to 143 fps, or hitches under 20 ms. **2** at or above 144 fps with no hitch above one frame.
- **Sources:** design §14.1 and vision principle 9.

#### TM7 · Smooth motion at the display rate · Ref · M H
- **Look / listen for:** Constant-speed motion (the player running, a strafing target) looks smooth at 60, 144, 165 and 240 Hz. The 128 Hz tick against a display rate that is not a multiple of it must not show as a periodic judder.
- **Evidence:** C2 or C1 of a target moving at constant speed: position deltas per rendered frame (variation); look for a periodic pattern.
- **0 / 1 / 2:** **0** a periodic judder visible at any tested rate. **1** a small variation at one rate. **2** none.
- **Sources:** architecture §4 (interpolation); [128-tick post][128tick].

---

## 10. View (VW)

#### VW1 · The field of view feels the same width · critical · Ref · M R
- **Look / listen for:** At 16:9 the view is as wide and as tall as the reference's: a doorway at a given distance takes up the same part of the screen, and a 90° flick lands on the same edge of the room at the player's own sensitivity.
- **Evidence:** the apparent pixel width of a 1 m object at 10 m at 1920 px width (analytic check); a 360° swipe at the player's cm/360.
- **0 / 1 / 2:** **0** visibly narrower or wider. **1** within a difference a person only notices side by side. **2** the same side by side (R).
- **Sources:** four independent sources agree on a 103° horizontal FOV at 16:9 with no slider ([GGRecon][ggr-fov], [trainer developer][s-fov]; spec §1.1). The value is judged by the numbers track; here it is judged by feel.

#### VW2 · Other aspect ratios · Ref · M
- **Look / listen for:** At 4:3, 16:10, 21:9 and a window resize, the vertical view is unchanged, nothing is stretched, no bars appear, the crosshair stays centred and the viewmodel keeps its shape.
- **Evidence:** screenshots at each size.
- **0 / 1 / 2:** **0** a stretched or cropped view. **1** correct view, a HUD item off. **2** all correct.
- **Sources:** [Riot supported resolutions][riot-res]; spec §1.1 (Hor+ is an estimate; behaviour at other ratios is not confirmed, so this item is judged by correctness, not by likeness).

#### VW3 · The viewmodel never covers the aim area · critical · Own (guard rail) · M
- **Look / listen for:** The gun sits low and to the side, never over the crosshair or the screen centre, and never hides a target at normal engagement positions. It does not clip into walls up close.
- **Evidence:** screenshots with the weapon at rest, firing, reloading and equipping; coverage of the centre region per frame; `viewmodel({ preview })` for each weapon.
- **0 / 1 / 2:** **0** the gun covers the crosshair or the centre at any moment. **1** it covers the lower edge of the aim area while reloading. **2** never.
- **Sources:** design §6 ("the viewmodel never covers the crosshair or the screen centre"); spec §9 Q18 (a fixed viewmodel FOV, not researched).

#### VW4 · Viewmodel motion · Ref · M H
- **Look / listen for:** The gun is steady at rest, responds to movement with a small, short motion that never moves the camera or the crosshair, and its reload and equip animations are smooth.
- **Evidence:** C1 or C2 at rest, walking, running; the equip and reload sequence.
- **0 / 1 / 2:** **0** the gun moves the view or jitters at rest. **1** fine at rest, a visible pop in a transition. **2** smooth throughout.
- **Sources:** no public numbers (spec §9 Q18); flagged as a judgement.

#### VW5 · Crosshair behaviour · critical · Ref · M
- **Look / listen for:** The crosshair is a fixed, centred, crisp shape that does not bloom or move on fire or movement. It is exactly centred in the render at every window size and device pixel ratio, with no blur. Nothing is drawn over it.
- **Evidence:** screenshots at devicePixelRatio 1 and 2, at 16:9 and other window sizes; C1 over a spray.
- **0 / 1 / 2:** **0** it moves, blooms, blurs or is hidden. **1** off by a pixel at some size. **2** exact at every size.
- **Sources:** the reference's reticle is player-set and does not show spread (spec §9 Q15, unverified); design §13.2.

#### VW6 · Muzzle flash · Own · M
- **Look / listen for:** A brief flash on the shot frame, offset from the crosshair line, bright enough to read at 144 fps and short enough not to wash the screen. It is visible on every shot of a spray and not on any other frame.
- **Evidence:** C1 over a spray: flash frames and the share of the screen lit.
- **0 / 1 / 2:** **0** a flash that hides the aim area or washes the screen, or none. **1** present, but it lingers a frame too long. **2** one frame per shot, clear of the aim area.
- **Sources:** design §7.1.

#### VW7 · What you see is what you hit · critical · Ref · M
- **Look / listen for:** The shot goes where the crosshair is drawn at that frame (when not displaced by recoil or spread). With mouse look applied every frame, the shot uses the view the player saw.
- **Evidence:** 100 shots at fixed marks with `look()` angles; shots fired during a flick at 60 and 144 Hz.
- **0 / 1 / 2:** **0** shots land away from the drawn crosshair by more than the cone. **1** inside the cone but biased during fast flicks. **2** unbiased at every rate.
- **Sources:** [Riot hit registration post][hitreg]; architecture §4 (late-latched look).

#### VW8 · Mouse look is direct · critical · Ref · M H
- **Look / listen for:** The view turns one to one with the mouse. No smoothing, no acceleration, no filtering, no pitch overshoot, the pitch clamp is firm. The same swipe gives the same turn at 60 and 240 Hz.
- **Evidence:** C4 with scripted `look()` angles for the pitch clamp; H: a 360° swipe at the player's cm/360 with raw input on and, if the browser refuses it, the first-run note. The first-run page says whether raw input was granted.
- **0 / 1 / 2:** **0** a filter or acceleration can be felt. **1** direct, but raw input is refused in the player's browser and the menu tells them. **2** direct, raw input granted.
- **Sources:** four converter sites agree on the 0.07° per count scale ([CSDB][csdb]; spec §1.2); [Chrome desynchronized canvases][desync] on browser input pipelines.

---

## 11. Scoring sheet template and pass rule

### 11.1 Pass rule

A sheet passes only if all of the following hold:

1. **Total:** the points are at least **80%** of the points available (2 per scored item).
2. **Per area:** every area is at least **60%** of its own points.
3. **Critical items:** **no critical item scores 0.** A critical zero fails its area, and a failed area fails the sheet, whatever the percentages.
4. **Coverage:** at most **10%** of the items are `unscored`. Unscored items count as 0 in the percentages. More than 10% makes the sheet **incomplete**: report it, but it has no verdict.

Items that exist only for features outside the build's declared scope (for example the Longnail's scoped items before it ships) are marked `n/a`, count for nothing in either direction, and the sheet header lists the declared scope. An item for a feature that is in scope but not built scores 0.

### 11.2 Verdict values

| Verdict | Meaning |
|---|---|
| **PASS (confirmed)** | The rule holds and every `R` item was scored side by side (C8). |
| **PASS (provisional)** | The rule holds, but at least one `R` item was scored from description. |
| **FAIL** | A percentage, an area floor or a critical item failed. List which. |
| **INCOMPLETE** | More than 10% unscored. |

### 11.3 How the sheet is used

- **#29 and #56** fill the sheet in, one per playtest pass, in the playtest report's Feel section, and post the verdict and the per-area percentages on [#62](https://github.com/omkarbhale/flickline/issues/62). Defects found are filed as issues labelled `quality:feel`.
- **#67** takes every row scoring below 2, **critical items first, then zeros, then 1s**, and turns it into a row of its tuning table: item id, parameter changed, before, after, new score and evidence. Only presentation parameters change (viewmodel kick and recovery, marker timings, synthesis parameters, flinch and tagging presentation, camera behaviour); a value with a row in `docs/conformance.md` never does.
- The sheet names the build (commit), the display refresh rate and capture rate, the audio output device, the browser, and who scored.

### 11.4 Template

Copy this block into the playtest report. `Score` is `0`, `1`, `2`, `n/a` or `-` (unscored); append `p` for provisional (for example `1p`). `Weapon` is the lowest-scoring weapon for per-weapon items.

```markdown
## Feel sheet

Build <commit> · display <Hz> · capture <fps> · audio out <device, ms> · browser <name version> · scorer <name>
Scope: weapons <...>; n/a items <ids and why>

| ID | Critical | Tags | Score | Weapon | Evidence (value, link or note) |
|---|---|---|---|---|---|
| RC1 | yes | M H | | | |
| RC2 | | M H R | | | |
| RC3 | | M | | | |
| RC4 | yes | M R | | | |
| RC5 | | M R | | | |
| RC6 | yes | M H | | | |
| RC7 | | M H | | | |
| RC8 | | M | | | |
| RC9 | yes | M | | | |
| MV1 | | M R | | | |
| MV2 | yes | M R | | | |
| MV3 | yes | M H | | | |
| MV4 | | M | | | |
| MV5 | | M H | | | |
| MV6 | | M H R | | | |
| MV7 | | M H | | | |
| MV8 | yes | M H | | | |
| MV9 | | M H | | | |
| MV10 | | M H | | | |
| SS1 | yes | M H | | | |
| SS2 | | M H | | | |
| SS3 | | M | | | |
| SS4 | | M H | | | |
| SS5 | | M R | | | |
| SS6 | | H | | | |
| SS7 | | H | | | |
| SS8 | | M | | | |
| HK1 | yes | M H | | | |
| HK2 | | M H | | | |
| HK3 | yes | M | | | |
| HK4 | yes | H | | | |
| HK5 | yes | M | | | |
| HK6 | | M | | | |
| HK7 | | M H | | | |
| HK8 | | M H | | | |
| HK9 | | M H | | | |
| HK10 | | M H | | | |
| HR1 | yes | M | | | |
| HR2 | | M | | | |
| HR3 | yes | M | | | |
| HR4 | yes | M | | | |
| HR5 | | M | | | |
| HR6 | | M R | | | |
| HR7 | | M R | | | |
| HR8 | | M H | | | |
| HR9 | | M | | | |
| TM1 | yes | M H | | | |
| TM2 | yes | M | | | |
| TM3 | | M | | | |
| TM4 | | M H | | | |
| TM5 | | M H | | | |
| TM6 | yes | H | | | |
| TM7 | | M H | | | |
| VW1 | yes | M R | | | |
| VW2 | | M | | | |
| VW3 | yes | M | | | |
| VW4 | | M H | | | |
| VW5 | yes | M | | | |
| VW6 | | M | | | |
| VW7 | yes | M | | | |
| VW8 | yes | M H | | | |

| Area | Items scored | Points | Available | % | Floor 60% | Critical zero |
|---|---|---|---|---|---|---|
| Recoil (RC) | | | | | | |
| Movement (MV) | | | | | | |
| Shot sounds (SS) | | | | | | |
| Hit and kill sounds (HK) | | | | | | |
| Hit response (HR) | | | | | | |
| Timing (TM) | | | | | | |
| View (VW) | | | | | | |
| **Total** | | | | | **≥ 80%** | |

Unscored: <n> of <n> (≤ 10%). Provisional (R not yet scored side by side): <ids>.
Verdict: PASS (confirmed) / PASS (provisional) / FAIL (<why>) / INCOMPLETE.
Follow-ups: <issues labelled quality:feel>.
```

---

## 12. Open questions and their default answers

Defaults are what the scorer assumes until someone with the reference game answers. An answer is recorded on [#62](https://github.com/omkarbhale/flickline/issues/62) and this list is updated.

| # | Question | Default answer | Judged without the reference? |
|---|---|---|---|
| 1 | Does the reference *camera* climb with recoil during a spray, or only the bullets? Public guides ("pull your mouse down to keep your crosshair on the target", [ludo.guide][ludo]) suggest the aim point the player sees moves; Riot says shots go "where you're aiming (ignoring spread or movement error)" without mentioning recoil ([post][hitreg]). | Unknown. Score RC2 and RC4 on the viewmodel and the bullet path; the camera is not scored until answered. Whoever has the reference answers it first. | No (**R**) |
| 2 | Does the reference spray's first sideways break always go the same way? | Unknown. RC5 scores that the break is not hard-wired in Flickline; the side is left to the reference check. | No (**R**) |
| 3 | What is the true per-bullet recoil path? | No public data (spec §3.5). RC4 uses the qualitative description and the published switch rules. | No (**R** for a 2) |
| 4 | Does the reference flinch on a body hit and on a leg hit? | Yes for headshots (officially documented); body and leg unconfirmed (one forum post). HR6 scores small, ordered by zone, and recoverable; 1 is the most a description-only score gives for the body and leg. | Partly |
| 5 | Does the reference buffer a click during a semi-auto cycle? | Unknown. TM2 only requires that no click is lost and that the behaviour is consistent. | No (**R**) |
| 6 | Is there a landing camera dip or a landing speed loss? | No speed loss (spec §9 Q14). A camera dip is not documented, so none is required; MV7 only asks for a clean landing cue and the inaccuracy. | Partly |
| 7 | How loud are the reference's weapons relative to each other? | Not public. SS5 judges Flickline's design relationships. | No (**R**) |
| 8 | Are the reference's walk and crouch-walk speeds the spec's estimates? | Spec §2.2 (50% and 34% of run; ESTIMATE). MV5 judges the *feel* of a deliberate slow. | No (**R** for a 2) |
| 9 | Which display and audio output should a pass assume? | Wired headphones or desktop speakers at 144 Hz or above for a confirmed verdict. The sheet header records what was used; a different device is a different pass. | Yes |
| 10 | Who may score? | `M` items: an agent. `H` items: a person; an agent leaves them unscored. `R` items: a person with the reference game. The sheet says who did what. | Yes |
| 11 | Are the scoped (sniper) items judged now? | No. Longnail is later (design §6); scoped FOV, scoped sensitivity and scope in/out timing are added as new items when it ships, so they are `n/a` until then. | Yes |
| 12 | A cue fades with the player's skill (design §7.4). Which state is scored? | The default state (every cue shown). The cue-free clean run is checked once for HR3 and VW5 only. | Yes |

Items that **cannot be judged without the reference game side by side**, collected: RC2, RC4, RC5, MV1, MV2, MV6, SS5, HR6, HR7, VW1 (every `R` tag in the sheet). A scorer without the reference game scores these provisionally.

---

## 13. Sources

All sources are public descriptions: patch notes, Riot posts and the Riot wiki, public analyses and community measurements. The numbers behind them are in `docs/mechanics-spec.md` §11. Nothing here is audio, video or an image from the reference game.

- Patch notes: [0.50][p0.50] (gun recovery time, crouched yaw recoil), [1.02][p1.02] (tagging ramp), [1.07][p1.07] (aim punch), [1.09][p1.09] (landing inaccuracy, scoped speed), [3.0][p3.0] (tagging, deadzone), [4.0][p4.0] and [6.11][p6.11] (moving recoil), [9.10][p9.10] (movement spread), [11.08][p11.08] (recoil switch rules).
- Riot: [hit registration post][hitreg], [netcode post][netcode], [128-tick post][128tick], [designer stop-timing reply][devtrack], [support page on walking, running and crouching][riot-walk], [supported resolutions][riot-res], [Vandal][wiki-vandal] and [Phantom][wiki-phantom] wiki pages.
- Analyses and measurements: [100-spray test][win-spray], [PCGamesN][pcgamesn], [valoranttracker][vtracker], [ludo.guide][ludo], [Sportskeeda on movement][sk-twix], [The Spike on counter-strafing][spike-cs], [Wooting][wooting], [GamerIV][gameriv], [Kotaku on the headshot cue][kotaku], [bunny hopping][bhop].
- Perception and latency: [ITU-R BT.1359][itu], [NVIDIA on aim latency][nvidia-aim], [Ivkovic et al., CHI 2015][ivkovic], [Ink & Switch][inkandswitch], [Chrome on desynchronized canvases][desync]; `docs/research/cues.md` §2 for the perception budget.
- Internal: `docs/mechanics-spec.md`, `docs/design.md` §6, §7, §12, §14.7, `docs/audio.md`, `docs/reviews/human-check-1.md` (the measurements most items reuse), `docs/transfer-checklist.md`.

[p0.50]: https://playvalorant.com/en-us/news/game-updates/valorant-patch-notes-0-50
[p1.02]: https://playvalorant.com/en-us/news/game-updates/valorant-patch-notes-1-02/
[p1.07]: https://playvalorant.com/en-us/news/game-updates/valorant-patch-notes-1-07/
[p1.09]: https://playvalorant.com/en-us/news/game-updates/valorant-patch-notes-1-09/
[p3.0]: https://playvalorant.com/en-us/news/game-updates/valorant-patch-notes-3-0/
[p4.0]: https://playvalorant.com/en-us/news/game-updates/valorant-patch-notes-4-0/
[p6.11]: https://playvalorant.com/en-us/news/game-updates/valorant-patch-notes-6-11/
[p9.10]: https://playvalorant.com/en-us/news/game-updates/valorant-patch-notes-9-10/
[p11.08]: https://playvalorant.com/en-us/news/game-updates/valorant-patch-notes-11-08/
[hitreg]: https://playvalorant.com/en-us/news/dev/the-state-of-hit-registration/
[netcode]: https://www.riotgames.com/en/news/peeking-valorants-netcode
[128tick]: https://www.riotgames.com/en/news/valorants-128-tick-servers
[devtrack]: https://devtrackers.gg/valorant/p/f29d0021-walking-running-accuracy-too-high
[riot-walk]: https://support.riotgames.com/en-us/valorant/gameplay/walking-running-and-crouching
[riot-res]: https://support.riotgames.com/en-us/valorant/support-tools/supported-resolutions-in-valorant
[wiki-vandal]: https://wiki.playvalorant.com/en-us/Vandal
[wiki-phantom]: https://wiki.playvalorant.com/en-us/Phantom
[win-spray]: https://win.gg/news/explaining-valorant-weapon-spray-patterns-and-if-theyre-random/
[pcgamesn]: https://www.pcgamesn.com/valorant/spray-patterns-recoil-control
[vtracker]: https://www.valoranttracker.net/guides/beg-4
[ludo]: https://www.ludo.guide/guide/valorant/the-ultimate-tactical-fps-guide/weapons-and-equipment/4-2-weapon-recoil-patterns-and-spray-control
[sk-twix]: https://sportskeeda.com/esports/valorant-how-player-models-movement-making-operator-balancing-nightmare-riot
[spike-cs]: https://www.thespike.gg/valorant/beginner-guides/is-counter-strafing-in-valorant-slower-than-csgo
[wooting]: https://wooting.io/post/wooting-valorant-guide-in-game-benefits-settings-and-pro-profiles
[gameriv]: https://gameriv.com/valorant-community-demanding-that-shields-should-negate-aimpunch/
[kotaku]: https://kotaku.com/players-disliked-valorants-new-headshot-sound-so-much-t-1843183562
[bhop]: https://www.thegamer.com/valorant-bunny-hop-guide/
[ggr-fov]: https://www.ggrecon.com/guides/how-to-change-your-fov-in-valorant/
[s-fov]: https://steamcommunity.com/app/1421020/discussions/0/3133919455870334349
[csdb]: https://csdb.gg/sensitivity-converter/
[itu]: https://www.forasoft.com/learn/audio-for-video/articles-audio/lip-sync-itu-r-bt-1359-tolerance-windows
[nvidia-aim]: https://developer.nvidia.com/blog/aiming-faster-in-games-with-low-computer-system-latency
[ivkovic]: https://bibtex.github.io/CHI-2015-IvkovicSGS.html
[inkandswitch]: https://www.inkandswitch.com/slow-software
[desync]: https://developer.chrome.com/blog/desynchronized
[cues]: research/cues.md
