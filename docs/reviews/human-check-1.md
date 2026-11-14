# Human check 1: what an agent can and cannot settle about the first playable

Tracking issue: [#180](https://github.com/omkarbhale/flickline/issues/180), "Questions for a human player (first playable)", is long-lived and stays open. Date: 2026-11-14. Build: `main` at `dbaabef` plus the measurement tooling added with this review.

At the first-playable checkpoint the owner chose to keep building rather than pause for a ten-minute feel check. This review takes each question that check would have asked (#180 Q1–Q19). For each one it collects the strongest evidence an agent can get and says how far that evidence goes. The questions stay open for a person.

Each verdict uses one of three fixed labels:

- **holds on the evidence available**: an agent can test the claim, and it passed;
- **does not hold**: the evidence shows a defect, and an issue is filed;
- **cannot be judged without a person**: the claim is about a hand, an ear or a real display.

The third label is the honest answer for most feel questions. Where part of a question can be measured, the measured part is reported, but the verdict still covers the whole question.

## How the evidence was gathered

- **`npm run human-check`** (new, `scripts/human-check.mjs` → `src/debug/humanCheck/`). It drives the real `World` through the headless game and the real sound-set renderer, and takes about 4 s with no browser. It measures:
  - 200 seeded full-magazine sprays per weapon, bullet by bullet;
  - burst → pause → tap reset tables;
  - movement curves, tagging and flinch;
  - the frame and tick alignment of input, modelled with the game's own `FixedStepper`;
  - onset, duration, level and spectrum of the hit, headshot, kill and shot sounds;
  - restart flow timings.

  `--json` prints everything.
- **`__flickline.latency`** (new debug command, `src/features/latencyProbe.ts`; costs nothing until started). In the page it records, for each mouse move, click and key:
  - the event's timestamp;
  - the sim tick or frame that used it;
  - the end of the frame that drew it;
  - the next vsync.

  For each shot, hit and kill it also records when the sound was scheduled against when its frame was drawn, along with the browser's reported audio output latency. A person can run it on real hardware: open the console, run `__flickline.latency.start()`, play for a minute, then run `__flickline.latency.report()`.
- **Backtick overlay**: it now also shows the audio device latency (`audio out N ms`), so a person can read their own sight/sound offset.
- **Browser runs**: headless Chromium 157, **software-rendered: this machine has no GPU** (Intel i5-9300H CPU, WSL2). Frame rates from it are not real-hardware frame rates. It is used for correctness, relative cost and pipeline timing only. Perf scene: `npm run perf -- --url … --quality low|high --sec 10`.
- **Sources** for thresholds are cited inline. One limit applies throughout: no public source gives per-bullet recoil coordinates or says whether the reference game's camera climbs with recoil (spec §3.5 says so too).

## Summary

| # | Question | Verdict | Issue |
|---|---|---|---|
| Q1 | Sensitivity: same cm/360 | cannot be judged without a person | – |
| Q2 | Kestrel recoil in the hand | **does not hold** | [#191](https://github.com/omkarbhale/flickline/issues/191) |
| Q3 | Vane and Pace recoil | **does not hold** (Vane); Pace cannot be judged | [#191](https://github.com/omkarbhale/flickline/issues/191) |
| Q4 | Movement feel | **does not hold** | [#73](https://github.com/omkarbhale/flickline/issues/73) |
| Q5 | Moving-shot cue agrees with the hand | cannot be judged without a person | (#73) |
| Q6 | Slow-on-hit and flinch | cannot be judged without a person | (#177) |
| Q7 | Hit / headshot / kill satisfying, sight and sound together | cannot be judged without a person | – |
| Q8 | Hit sounds by ear alone | cannot be judged without a person | – |
| Q9 | Shot sounds | cannot be judged without a person | (#168) |
| Q10 | Kill burst over the crosshair | **does not hold** | [#176](https://github.com/omkarbhale/flickline/issues/176) |
| Q11 | Input latency | cannot be judged without a person | – |
| Q12 | 144+ fps on real hardware | cannot be judged without a person | (#152, #55) |
| Q13 | Is one more run tempting | cannot be judged without a person | (#170, #172, #175) |
| Q14 | Spotting effortless | cannot be judged without a person | (#134) |
| Q15 | Cues off | cannot be judged without a person | (#164) |
| Q16 | Viewmodel hides anything | cannot be judged without a person | – |
| Q17 | Orbit at a high dial | cannot be judged without a person | (#136) |
| Q18 | FOV and camera height | holds on the evidence available (16:9) | (#73 for crouch) |
| Q19 | Reload and equip rhythm | holds on the evidence available (timings) | – |

Totals: 4 do not hold, 2 hold, 13 cannot be judged without a person.

The verdict "holds" covers only measured numbers, and only for Q18 and Q19. Nothing about how the game feels is called "holds".

---

## Feel in the hand

### Q1. Sensitivity

**Claim.** A player's reference-game sensitivity, typed in unchanged, gives the same cm/360 and the same 90° flick distance.

**Evidence.**
- `core/sensitivity.ts` uses 0.07° per raw count × sensitivity on both axes. That matches spec §1.2, whose four community sources agree, and it is unit-tested (`core/sensitivity.test.ts`).
- Mouse deltas are applied to the view in the `mousemove` handler. Pointer lock asks for `unadjustedMovement` (raw input), and the game reports when it is refused.
- Physical distance therefore depends on things an agent cannot see from here:
  - whether the browser actually delivers raw counts (with the option refused, OS acceleration applies);
  - whether `movementX` is scaled by OS display scaling on the player's platform;
  - the player's DPI.

**Verdict: cannot be judged without a person.** The formula is right. Whether it reaches the hand unchanged is a property of the player's browser and OS.

**A person should confirm:** the 360° swipe lands on the same edge as in the reference game, with Windows display scaling at 100 % and at 125–150 %. Also note whether the first-run panel says raw input is on.

### Q2. Recoil in the hand (Kestrel spray)

**Claim.** The Kestrel's spray (straight climb, then a sideways break) and its tap reset feel like the reference game's controllable full-auto rifle.

**Evidence** (200 seeded sprays, standing, no compensation):

| Bullet | 1 | 5 | 9 | 10 | 12 | 20 | 30 |
|---|---|---|---|---|---|---|---|
| Mean climb (°) | 0 | 1.20 | 2.40 | 2.70 | 3.30 | 3.86 | 4.56 |
| Mean sideways (°) | 0 | 0 | 0 | 0.15 | 0.43 | 1.17 | 1.84 |
| Spread (°) | 0.20 | 0.48 | 0.83 | 0.90 | 0.90 | 0.90 | 0.90 |

- **Cadence.** Bullets are 91.1 ms apart (11 rounds/s).
- **Climb.** The first 9 bullets go straight up at 0.30° each, and the climb flattens to 0.07° per bullet after bullet 12.
- **Sideways break.** It starts at bullet 10, which follows from the 8 protected bullets.
- **Switches.** The sideways kick changes direction 0.99 times per spray on average, and 65 % of sprays switch at least once.
- These values match the spec §3.5 placeholder table exactly (tagged PLACEHOLDER, 20 % confidence).
- The switch rules (8 protected bullets, 10 % chance per bullet, 0.6 s switch time) match patch 11.08 for the reference spray rifle. Source: [patch 11.08](https://playvalorant.com/en-us/news/game-updates/valorant-patch-notes-11-08/).
- Public descriptions of the reference pattern are qualitative and disagree:
  - "straight down, then flick to the left at the ninth or tenth shot" ([PCGamesN](https://www.pcgamesn.com/valorant/spray-patterns-recoil-control));
  - the Vandal's "first 5 bullets nearly straight up, bullet 6 drifting up-right" ([valoranttracker](https://www.valoranttracker.net/guides/beg-4)).

  No source gives degrees.

**Two measured problems:**

1. **The tap reset is not a reset.** Spread resets at the gun recovery time (0.35 s), but the recoil aim offset only *starts* returning then, at 8°/s.

   | Shot after a pause | 350 ms | 400 ms | 500 ms | 750 ms | 1000 ms |
   |---|---|---|---|---|---|
   | after 10 bullets: offset (°) | 2.88 | 2.50 | 1.69 | 0 | 0 |
   | after 30 bullets: offset (°) | 4.51 | 4.15 | 3.38 | 1.48 | 0 |

   Every one of these shots has the fresh first-shot spread (0.20°), so it is "accurate" but 30–50 cm high at 10 m.

   The reference game defines the reset as the gun recovery time ([patch 0.50](https://playvalorant.com/en-us/news/game-updates/valorant-patch-notes-0-50): inaccuracy accrues when the gun is "re-fired prior to a complete duration of … Gun Recovery Time"). Filed as **#191**.
2. **The offset is invisible.**
   - Recoil only offsets the bullet from a still crosshair. The camera never climbs; only the viewmodel animates.
   - We found no public source that settles whether the reference game's view climbs with recoil.
     - Guides say "pull your mouse down to keep your crosshair on the target" ([ludo.guide](https://www.ludo.guide/guide/valorant/the-ultimate-tactical-fps-guide/weapons-and-equipment/4-2-weapon-recoil-patterns-and-spray-control)), which suggests the aim point the player sees moves.
     - Riot's hit-registration post says shots go "where you're aiming (ignoring spread or movement error)" without mentioning recoil ([Riot](https://playvalorant.com/en-us/news/dev/the-state-of-hit-registration/)).

     Neither statement is conclusive.
   - It matters for transfer, because it decides where the player learns to hold the crosshair during a spray: on the head, or below it.

The sideways break also always starts to the **right** (100 % of sprays at bullets 10–16). Whether the reference game's first break has a fixed direction is unknown.

**Verdict: does not hold.** The reset defect (#191) is measured and contradicts the official definition of the reset. The shape is a placeholder that no public measurement can confirm or reject.

**A person should confirm (Q2 on #180):**
- whether the reference game's view climbs while spraying (the single most useful answer);
- whether the climb rate and the bullet of the sideways break feel right;
- which direction the reference's first break goes, and whether that direction is always the same.

### Q3. Recoil on the Vane and the Pace

**Evidence.**
- **Vane** (25 bullets, 102.9 ms apart):
  - climbs 0.35° per bullet for 9 bullets, then 0.08°;
  - breaks sideways at bullet 8 (6 protected bullets, as patch 11.08 gives the precise rifle);
  - reaches 4.35° and 1.86° at the end of the magazine.
  - It has the same reset defect: after 10 bullets and the 0.375 s recovery time, the next shot is still 3.11° high, 2.13° at 500 ms.
- **Pace**:
  - kicks 0.6° per shot and returns at 2.4°/s from the first tick;
  - at its full semi-auto rate (one shot per 148–156 ms) the climb accumulates about 0.23° per shot, reaching 2.7° by the 13th shot;
  - spread reaches its 1.65° maximum by the 6th shot.

  All of this is spec §3.5 placeholder data.
- The Vane plays the Kestrel's shot sound (no sound of its own yet, #168).

**Verdict: does not hold** for the Vane (#191). The Pace has no measured defect, and its feel **cannot be judged without a person**.

**A person should confirm:** whether spam-tapping the Pace climbs as fast as the reference's accurate pistol, and whether the Vane's first-bullet tap feels crisp.

### Q4. Movement

**Claim.** Acceleration, stopping, counter-strafing, direction changes, jumping and crouching feel like the reference game.

**Evidence** (`npm run human-check`, the real `World` at 128 Hz):

| Item | Spec (§2) | Build |
|---|---|---|
| Rest to full speed | 200 ms | **78 ms** (90 % at 70 ms) |
| Release to the accuracy deadzone (first accurate shot) | ≈ 100 ms | **62.5 ms** (Pace 54.7 ms) |
| Release to a full stop | 160 ms (Riot's own test) | **78 ms** |
| Counter-strafe | same as release | same as release (62.5 / 78 ms) |
| Full A→D reversal to full speed the other way | (accel + stop ≈ 360 ms) | 156 ms |
| Pace run speed | 5.74 m/s | **5.40 m/s** (equipped weapon ignored) |

This confirms the #29 measurements on #73: acceleration and braking are about twice the reference rate. The spec's 160 ms stop comes from a Riot designer's test and is the best-sourced movement number there is.

**Verdict: does not hold.** It is already tracked as #73; the new measurements are commented there.

**A person should confirm:** whether the difference is noticeable in the hand ("the stop is snappier than the reference"). Report that as a symptom, even after #73 lands.

### Q5. Do the moving-shot cues agree with the hand?

**Evidence.**
- The amber tracer is driven by the shot's own `moving` flag (speed above the 27.5 % deadzone) through `movingCueShown`, so the cue agrees with the sim by construction.
- Because the sim stops in about 62 ms instead of about 100 ms (Q4), the cue currently rewards a stop rhythm about 40 ms faster than the reference allows.

**Verdict: cannot be judged without a person.** Whether a person perceives the cue at the moment their hand feels stopped is a perception question. The cue's timing will be right once #73 is fixed.

**A person should confirm:** whether amber shows on shots they felt were stopped, or white on shots they felt were still moving.

### Q6. Slow-on-hit and flinch

**Evidence** (one 20 HP hit while running at full speed; tagging is flat per bullet):
- **Tagging.** Speed falls to **27.7 %** of run speed (spec 27.5 %, from patch 3.0) at **102 ms** (the spec's 0.10 s ramp-in) and is back to 95 % at **570 ms** (the spec's 0.5 s release after the hit). It matches §4.3, whose ramp and release values are estimates (30 %).
- **Flinch.**
  - Head: 1.94° peak, recovered in 250 ms (spec 2.0° / 0.25 s).
  - Body: 0.54° peak, recovered in 70 ms.
  - Leg: 0.24° peak, recovered in 31 ms.
  - Body and leg recover at the same angular rate rather than in 0.25 s. That is a known reading of the spec, tracked in #177.
- No mode shoots the player in the first playable. A person can only check this through the console (`__flickline.hitBy`), and enemy fire arrives with #32.

**Verdict: cannot be judged without a person.** The numbers match the spec, but the spec's magnitudes for slow ramp, release and flinch are estimates or placeholders.

**A person should confirm:** whether the slow lasts and recovers like the reference's tagging, and whether body-hit flinch is noticeable at all.

## Hits, kills and sound

### Q7. Is a hit, a headshot and a kill satisfying, and do sight and sound land together?

**Evidence.**
- **Same tick, same frame.** In the page probe (headless, 61 shots, 33 hits, 33 kills), every shot, hit and kill sound was **scheduled at the audio clock's "now" in the same sim tick** as the event (scheduling offset 0 ms in all samples). Its visuals (hitmarker, shatter, `+score`) were **drawn at the end of that same frame** (p50 3–5 ms after the tick).

  This meets design §7's rule that every event is answered in the same frame with a sight and a sound.
- **What is left is the device and the display.**
  - The sound is heard `baseLatency + outputLatency` after it is scheduled. Chrome reports this per device. The headless machine's dummy sink reported between 20 and 120 ms, which is meaningless for real hardware. The cue research expects about 10–30 ms on wired desktop audio (`docs/research/cues.md` [S13]); Bluetooth adds far more.
  - The frame reaches the eye about one to two display frames after drawing: about 7–14 ms at 144 Hz, through the browser compositor (see Q11).
  - The likely offset on a wired desktop is therefore within about ±25 ms, with sound slightly late.
- **Perceptual threshold.** ITU-R BT.1359 puts detectability at audio 45 ms early or 125 ms late ([summary of BT.1359-1](https://www.forasoft.com/learn/audio-for-video/articles-audio/lip-sync-itu-r-bt-1359-tolerance-windows)). That is a broadcast threshold; no public threshold for brief impact events was found, so it is used here only as a bound.
- **Reference comparison.** In the reference game, hit confirmation waits for the server: at 40 ms ping there is an 80 ms gap between the tracer and the hit effect ([Riot](https://playvalorant.com/en-us/news/dev/the-state-of-hit-registration/)). Flickline confirms locally and is *faster* than the reference by design.
- **Satisfaction.** The kill cue is the loudest and longest of the set (132 ms, −19 dBFS over its first 50 ms) and rises one step per streak (#20). The visuals are the shatter and `+score`, but the burst covers the crosshair (Q10).

**Verdict: cannot be judged without a person.** The sync part holds on the evidence available for wired audio. Whether a kill *satisfies* is the question itself.

**A person should confirm:** what the overlay's `audio out` line reads on their own setup (headphones, speakers, Bluetooth). Then whether the kill sound feels early or late against the shatter, and whether it tires after many kills.

### Q8. Hit sounds without looking

**Evidence** (offline render at 48 kHz):

| Cue | Duration | Peak | Centroid | Dominant |
|---|---|---|---|---|
| Body hit | 37 ms | −12 dB | 263 Hz | 211 Hz |
| Leg hit | 23 ms | −18 dB | 221 Hz | 176 Hz |
| Headshot | 61 ms | −12 dB | 2.83 kHz | 3.0 kHz |
| Kill | 132 ms | −12 dB | 441 Hz | 439 Hz |

- Spectral distance between cues (dB RMS over third-octave bands, peak-normalised):
  - body–leg 13.7, the closest pair;
  - body–head 17.1;
  - leg–head 19.8;
  - head–kill 25.0.
- **The headshot** is clearly separated: a 3 kHz "tink", where the body and leg hits are "thocks" around 200 Hz.
- **Body versus leg** differ by:
  - a 3-semitone drop;
  - 6 dB less level;
  - 14 ms less length;
  - the leg hit lacks the 3 kHz click.

  That makes them the most confusable pair, as #52 predicted. Small laptop speakers roll off below a few hundred hertz and keep mainly the second harmonics and the click.
- The reference game's own headshot cue is described as a low, resonant metallic thump ([Kotaku](https://kotaku.com/players-disliked-valorants-new-headshot-sound-so-much-t-1843183562)). Flickline's high tink is its own identity. The cue only needs to be learnable, not identical.

**Verdict: cannot be judged without a person.** The numbers show the cues differ. Whether a person can tell body from leg by ear, on headphones and on laptop speakers, can only be heard.

**A person should confirm:** an eyes-closed body/leg/head identification on both outputs.

### Q9. Shot sounds

**Evidence.**
- The Kestrel shot is 69 ms long against a 91 ms fire interval, so consecutive shots do not overlap and the cadence stays countable. The Pace shot is 43 ms.
- Shots get ±3 % random pitch and gain each.
- Both peak at −15 dBFS. Over the first 50 ms the Kestrel is about 2 dB louder (−26.8 vs −28.8 dBFS).
- Hit and kill cues peak 3 dB above the shots and duck the weapons bus.
- The Vane and the Rill have no shot sound of their own yet. The Vane uses the Kestrel's (#168).

**Verdict: cannot be judged without a person.** Repetition and fatigue are listening questions.

**A person should confirm:** whether a 30-round spray reads as a countable rhythm or a smear, whether it fatigues, and how loud the guns are against each other.

### Q10. Kill burst over the crosshair

**Evidence.**
- The #29 frame capture (`docs/screenshots/playtest-1/shot-feedback-sequence.png`) shows the gold burst and a large `+150` centred on the crosshair for about the first 100 ms after a kill.
- In Orbit the next Beacon appears 0.1 s after a kill, so the overlay covers exactly the frames in which the player looks for the next target.

**Verdict: does not hold** (#176).

**A person should confirm:** whether they lose the crosshair for a moment in Orbit.

## Timing and performance

### Q11. Input latency

**Claim.** The crosshair feels attached to the mouse, and a click fires at once, as in the reference game at the same frame rate.

**Evidence.**

1. **The game's own loop** (the real `FixedStepper` at ideal display rates; 20 000 inputs at random times; ms):

   | Display | Mouse move → frame that renders it (p50 / max) | Click → frame that fires it (p50 / p90 / max) | Frames with no sim tick |
   |---|---|---|---|
   | 60 Hz | 8.3 / 16.7 | 8.3 / 15.0 / 16.7 | 0 % |
   | 144 Hz | 3.5 / 6.9 | 3.9 / 7.8 / 13.9 | 11 % |
   | 165 Hz | 3.0 / 6.1 | 3.9 / 9.4 / 12.1 | 22 % |
   | 240 Hz | 2.1 / 4.2 | 3.9 / 7.5 / 8.3 | 47 % |

   - Mouse look is applied per frame, not per tick. Chrome aligns `mousemove` dispatch with the frame, so the look wait is usually even shorter than the model's.
   - A click must wait for a frame that runs a tick: with 128 Hz ticks and a 144 Hz display, 11 % of frames run none. That bounds the click wait at one frame plus one tick, about one tick of quantisation, as in any 128 Hz game.
   - The shot uses the view angles the frame showed, so it goes where the crosshair was drawn.
2. **The page probe** (headless; frames are slow, so these show the pipeline is correct, not real-hardware numbers):
   - mouse move → consumed p50 3.3 ms, → drawn p50 5.6 ms;
   - click → firing tick p50 2.7 ms, → drawn p50 7.6 ms;
   - no click was dropped at a normal click rate. (A click during the gun's fire interval is ignored rather than buffered, and the probe counts such clicks separately.)
3. **What the page cannot see.**
   - The canvas is a normal (synchronised) WebGL canvas under DOM HUD elements, so the browser compositor queues it with the page. `desynchronized: true` would skip that queue, but not with DOM elements on top ([Chrome](https://developer.chrome.com/blog/desynchronized)).
   - No public measurement of browser versus native input-to-photon was found.
   - **Estimate (assumptions named):** at 144 Hz, game loop about 4 ms + draw 1–2 ms + GPU 1–3 ms + compositor about one frame (7 ms) + scan-out half a frame (3.5 ms) ≈ **17–20 ms of PC-side latency**.
   - NVIDIA quotes "less than 10 ms" PC latency for the reference game with Reflex at very high frame rates ([NVIDIA](https://www.nvidia.com/en-us/geforce/news/reflex-low-latency-apex-legends-valorant-fortnite-cs2/)), a vendor figure.
   - Flickline is plausibly about 8–12 ms behind at equal refresh rate.
4. **Is that enough to notice?**
   - Mean detection thresholds for mouse-cursor latency are around 65 ms (range 34–137 ms, Forch et al. 2017, via [Ink & Switch](https://www.inkandswitch.com/slow-software)).
   - Aiming *performance* drops measurably at 41 ms ([Ivkovic et al., CHI 2015](https://bibtex.github.io/CHI-2015-IvkovicSGS.html)).
   - An 8 ms difference changed aim-trainer completion time in NVIDIA's study at 240 Hz ([NVIDIA](https://developer.nvidia.com/blog/aiming-faster-in-games-with-low-computer-system-latency)).
   - So the gap is below most people's detection threshold but not below what affects performance.

**Verdict: cannot be judged without a person.** The loop adds no more than about a tick, and the browser's share can only be measured on real hardware.

**A person should confirm:** the subjective "attached or floaty" against the reference at the same refresh rate. Optionally, run `__flickline.latency.start()`, play a minute and post `__flickline.latency.report()`.

### Q12. Real frame rate

**Claim.** It holds 144+ fps on real hardware (design §14.1: 144 fps at 1080p High on a mid-range discrete GPU; 120+ at Low on a 2020 integrated GPU).

**Evidence.** Software-rendered headless Chromium (this machine has **no GPU**), 1280×720, 10 s of the perf scene:

| Quality | Draw calls | Triangles | Main-thread frame work (avg / p99) | Software fps | JS allocation |
|---|---|---|---|---|---|
| Low | 12 | 2,168 | 5.2 / 27.6 ms | 7 | 760 KB/s |
| High | 12 | 2,168 | 6.2 / 27.6 ms | 4.5 | 544 KB/s |

The geometry load (12 draws, about 2 k triangles) is trivial for any GPU made in the last decade. The real-hardware question is whether three costs fit a 6.94 ms frame:

- **Main-thread time.** The 5–6 ms above includes the software GL client, which a real GPU driver would not pay, but this machine cannot separate the two.
- **Fragment cost at High.** High uses 4× MSAA, a post pass and a pixel ratio up to 2. At 1440p on an integrated GPU this is the likeliest bottleneck.
- **Garbage collection.** At about 0.5–0.8 MB/s of allocation (#152), minor collections land every few seconds. Each takes a millisecond or two, a visible share of a 6.94 ms budget.

Estimate (assumptions named): on a mid-range discrete GPU at 1080p High the GPU side should take well under 3 ms. On real hardware, main-thread JS for a 12-draw scene plus the HUD should take 1–2 ms. That leaves headroom for 144 fps, but GC spikes may show as occasional over-budget frames until #152 is fixed. None of this is measured.

**Verdict: cannot be judged without a person.**

**A person should confirm:** the overlay's fps and frame-time graph (red bars are over the 144 Hz budget) while spraying in Orbit. Report it with the GPU, monitor refresh rate, browser and quality level, at Low and at High.

## The loop

### Q13. Is one more run tempting?

**Evidence.**
- **Restart cost.** Key press to the first `ready` frame took 20–36 ms in the software browser over four restarts (budget 250 ms, design §2). The sim side of a mode start is 0.2 ms (p50).
- **Wait before play.** The `ready` beat then lasts 0.8 s before targets go live (797 ms to the first target in both Cold Start and Orbit, sim time).
- **Results card.** It appeared 12–38 ms after the run ended, except the first card of the session at 138 ms, above the 100 ms appear budget in software rendering.
- **Against the design's own "one more" triggers** (design §2):
  - "Restart cost is zero": holds, apart from the deliberate 0.8 s beat.
  - "Ghost pace ahead/behind your PB": needs personal bests, which are not persisted yet (#38). The results card says "Personal best: —" even on a PB run (#175).
- **Fun-track findings from #29** that work against the pull:
  - Cold Start settles at 51–56 % success, below the flow band (#170);
  - reward droughts with a median longest gap of 12–14 s per run (#172);
  - follow-up bullets pay a kill in a "failed" trial (#174).

**Verdict: cannot be judged without a person.** The mechanics of restarting hold. The pull of another run is the question itself, and several measured fun issues work against it.

**A person should confirm:** after five runs, whether they wanted a sixth, and why or why not. Also whether the 0.8 s beat reads as "get ready" or as a wait.

### Q14. Spotting

**Evidence.** Targets are lit, high-contrast shapes on a calm environment. The vision review's finding 10 and #134 argue that spotting is a pop-out task here, unlike in a cluttered match. Nothing an agent can measure says how fast a person finds them.

**Verdict: cannot be judged without a person.**

**A person should confirm:** how much faster their time to shot feels here than in a real match.

### Q15. Cues off

**Evidence.**
- Cues fade with rating (#129, #166), and the session includes one clean run.
- The retention question is #164's experiment.

**Verdict: cannot be judged without a person.**

**A person should confirm:** whether they felt lost without the amber cue.

### Q16. Viewmodel

**Evidence.** The procedural viewmodel sits bottom-right (#45). Whether it hides anything a player would look at depends on where their eyes go.

**Verdict: cannot be judged without a person.**

**A person should confirm:** whether targets low on the right ever disappear behind the gun.

### Q17. Orbit at a high dial

**Evidence.** #136 (open) proposes keeping 120–180° flicks rare: only above dial 85, and on 15 % or fewer of trials. Whether a behind-the-back flick reads as skill or as noise depends on the player having time to know where the target is.

**Verdict: cannot be judged without a person.**

**A person should confirm:** "felt fair" or "felt random", at `__flickline.mode.start('orbit', {pinDial: 90})`.

### Q18. FOV and camera height

**Evidence.**
- Horizontal FOV is 103° at 16:9, stored as vertical 70.53° and Hor+ (`core/view.ts`), exactly spec §1.1 (four community sources).
- Standing eye height is 1.62 m, the spec's estimate.
- Crouched eye is 1.22 m against the spec's 1.17 m placeholder, and the crouch hull flips in one tick (#73).

**Verdict: holds on the evidence available,** for the 16:9 FOV and standing eye height. Other aspect ratios follow an unconfirmed spec estimate.

**A person should confirm:** whether the view feels the same width and height as the reference beside a wall and a Post. On 16:10 or ultrawide, whether it feels wider than the reference.

### Q19. Reload and equip rhythm

**Evidence.**
- Reload and equip times equal spec §7.2 for every weapon: Kestrel 2.5 s / 1.0 s, Vane 2.5 / 1.0, Pace 1.5 / 0.75. Those spec values come from the reference game's published weapon data.
- Swap keys `1`/`2` and the reload and equip sounds exist (#30, #41).

**Verdict: holds on the evidence available,** for the timings only. The rhythm, meaning the sounds and the viewmodel motion during a reload, needs a person.

**A person should confirm:** whether a reload "sounds and looks" as long as it is, and whether a swap mid-reload feels like the reference.

---

## What this review added

- `npm run human-check` (`scripts/human-check.mjs`, `src/debug/humanCheck/`): every offline measurement above. It takes about 4 s and is not part of the game bundle. A smoke test runs in the suite and takes about 1 s.
- `__flickline.latency.start / stop / clear / report` (`src/features/latencyProbe.ts`, `src/debug/latencyProbe.ts`):
  - the input → tick or frame → drawn → vsync probe;
  - per-event sight and sound timing.

  It attaches its listeners only while started.
- `Game.onFrameEnd` (a frame hook that runs after drawing, used by the probe), and `AudioEngine.clock()` (audio clock and device latencies).
- The backtick overlay shows `audio out N ms`.

Issues filed or updated:
- **#191**: new; recoil offset outlives the gun recovery time (Q2, Q3).
- **#73**: comment with the movement measurements (Q4).
- **#176**: already filed by #29 (Q10).

Every verdict is posted on #180.
