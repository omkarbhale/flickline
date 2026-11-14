# Cue design research: hit, headshot, kill and tell cues that players learn in a minute

Research deliverable for issue #52. Scope: audio and visual cue design for `docs/design.md` §7 (feedback), §11 (look: palette, effects) and §12 (sound). This document does **not** edit the design; its proposed changes are listed in section 8 and posted as a comment on #52 for the owners of #20, #24, #40, #41, #42 and #44 to adopt. Nothing here is implemented.

Method and honesty note: this is a desk review of established psychophysics, accessibility standards and game-audio practice, plus **computations done for Flickline's own numbers** (reproducible with `python3 -I docs/research/cvd_check.py`, and the arithmetic is shown inline). Sources are cited from the literature by name (section 9); they were not re-fetched while writing, so figures tagged COMMON are the widely published ranges and should be treated as ranges, not precise constants. Tags: **COMMON** (textbook/standard), **DERIVED** (arithmetic on tagged inputs, shown), **ESTIMATE** (judgement; the measure that would settle it is given), **PLACEHOLDER** (tune by ear/eye).

Identity rule restated: every cue is synthesised or drawn by us. Only cue *roles* (a distinct headshot cue, a kill cue, an incoming-fire tell) match convention, because skill transfers on role, not timbre.

---

## 1. Summary of findings

1. **Headshot vs body is robust; leg vs body is not.** Body "thock" (220 → 110 Hz) vs headshot "tink" (1.9 kHz) are 14.5 ERB apart, far past any confusion; but "leg = thock a semitone lower, 6 dB quieter" is only 0.25 ERB apart: it is heard only by direct comparison, not by identification. Make the leg cue differ in two dimensions (3.1).
2. **The low thock is the weakest cue.** Its 110 Hz end is inaudible on laptop speakers and it shares the 100 to 250 Hz band with the weapon's pitched body at only about 3 dB signal-to-masker. Give it a short 3 kHz click and a higher start frequency (3.2, 3.3).
3. **The tink collides with the top of the kill ladder** if the ladder root is near 1 kHz (8 pentatonic steps reach 2.5x the root). Fix the families into separate bands: ladder 440 to 1100 Hz, tink 3 kHz (3.4).
4. **A pitch ladder does help streak awareness, as direction and rough level, not as an exact count.** Keep the number on screen; cap tonal steps at 8 with at least 2 semitones between steps (4).
5. **"3-frame" pulses are frame-rate dependent**: 3 frames is 21 ms at 144 fps and 50 ms at 60 fps. Specify every pulse in milliseconds, and rate-limit full-width pulses to 3 per second with a luminance cap (6).
6. **Design §11 claims that fail the computed check:** "Echoes meet at least 7:1 against any environment surface" (default Ember reaches 4.22:1 vs steel, 3.01:1 protan), "all pairs at least 4.5:1" (alert on ink is 3.89:1 protan), and gold (headshot) vs warn (moving shot) are not separable under deuteranopia (delta E 7.9). Concrete replacements in 7 and 8.
7. **The enemy-tell fairness floor of 0.15 s is below human simple reaction time** (auditory about 0.15 to 0.16 s mean, visual about 0.19 s). It cannot be "react and act"; recommend 0.25 s as the default floor (5.3).

---

## 2. Perception budget (inputs for everything below)

| Quantity | Value | Tag | Used for |
|---|---|---|---|
| Simple reaction time, auditory | about 0.15 to 0.16 s mean, trained gamers about 0.13 to 0.15 s | COMMON [S1] | tell floor, cue latency |
| Simple reaction time, visual | about 0.18 to 0.20 s mean | COMMON [S1] | tell floor |
| AV sync detectability | sound may lag picture by up to about 125 ms and lead by up to about 45 ms before detection; acceptable up to +90 / -185 ms | COMMON [S2] | marker vs sound |
| Pitch resolution, successive tones | about 0.5 to 1% for 0.5 to 4 kHz; a semitone is 5.9% | COMMON [S5] | leg vs body, ladder step size |
| Frequency resolution of simultaneous tones | 1 ERB; ERB-number scale `21.4*log10(4.37 f/1000 + 1)` | COMMON [S3] | cue families in separate bands |
| Level discrimination | about 1 dB; a clear categorical step is about 6 dB; 10 dB is roughly "twice as loud" | COMMON [S5] | loudness separations |
| Loudness of short sounds | rises with duration up to about 200 ms; a 50 to 100 ms burst is perceived roughly 3 to 6 dB quieter than a longer one at the same level | COMMON [S5] | minimum durations, relative levels |
| Critical ratio (tone vs noise masker) | tone detectable at about 17 to 20 dB above the noise spectral density near 1 to 2 kHz | COMMON [S5][S14] | masking by gunfire |
| Absolute pitch identification, untrained | about 5 to 7 categories | COMMON [S6] | pitch ladder |
| Equal loudness | ear is most sensitive about 2 to 5 kHz; at 40 phon a 100 to 200 Hz tone needs roughly 5 to 10 dB more level than 1 kHz | COMMON [S4] | band allocation |
| Colour vision deficiency | about 8% of men, 0.5% of women | COMMON [S11] | palette |
| Web Audio output latency | `baseLatency + outputLatency`: about 10 to 30 ms desktop, more with Bluetooth | COMMON [S13] | latency target |

Tick and frame facts from the architecture: sim tick 7.8 ms, frame 6.9 ms at 144 fps; a cue emitted in the frame of the tick that produced it is within one frame of the event.

---

## 3. Distinguishing hit cues under load

Design §12 today: body = 60 ms thock, 220 → 110 Hz sine drop with a click; leg = thock a semitone lower and 6 dB quieter; headshot = thock plus 1.9 kHz "tink" (two detuned triangles, 120 ms); kill = pentatonic chime ladder; hits peak about -12 dBFS, weapons about -15 dBFS.

### 3.1 Body vs leg (finding: too close)

ERB-numbers (DERIVED from [S3]): 220 Hz = 6.26, a semitone lower (208 Hz) = 6.01. Separation 0.25 ERB, far below the 1 ERB needed to resolve two sounds heard together, and the pitch difference is 5.9% against a 0.5 to 1% successive-tone JND: audible if you hear both in a row, **not identifiable on its own**, and a 6 dB level cut is read as "farther or weaker", not "different". Under a spray (13 hits/s for the SMG) the player never hears two in comparison.

- Recommendation R1: leg cue = **3 semitones lower (minor third, 18%)**, **-6 dB**, **shorter (35 ms vs 60 ms)**, and **no click**. Three dimensions (pitch, level, duration/attack) all say "weaker". Measure: ERB separation >= 1.5 and a human 2-alternative identification of body vs leg at >= 90% after 20 exposures (test in section 10).

### 3.2 Body thock on real speakers (finding: low band is not reliable)

110 to 220 Hz is below the useful range of laptop speakers and many earbuds (roll-off below about 150 to 250 Hz, COMMON). Equal loudness (ISO 226 [S4]) also makes a 110 Hz tone about 10 dB less loud than the same level at 1 to 3 kHz. A cue whose identity lives in its fundamental can vanish.

- R2: thock = **start 260 Hz, end 150 Hz** (ERB-number 7.05 to 4.69, still clearly "low"), add a **second harmonic at -6 dB** so the pitch is carried at 300 to 520 Hz, and add a **3 ms click band-passed at 3 kHz at -8 dB re the thock**. Measure: OfflineAudioContext render, spectral centroid ordering leg < body < head < kill (section 10), and >= 10 dB of the cue's energy above 250 Hz.

### 3.3 Masking by the weapon (finding: thock vs weapon body is only about 3 dB)

Weapon noise at -15 dBFS spread over about 500 to 6000 Hz (5.5 kHz wide): spectral density = -15 - 10*log10(5500) = about -52 dBFS/Hz (DERIVED). With a critical ratio of about 20 dB near 2 kHz (COMMON [S14]), a tone is masked below about -32 dBFS in that region.

- Headshot tink (1.9 kHz, -12 dBFS): about **+20 dB above masked threshold**. Robust.
- Body thock fundamental (110 to 220 Hz, -12 dBFS) vs the weapon's pitched sine/triangle body sweep (about the same band, -15 dBFS): about **3 dB** signal-to-masker with tone-on-tone, so thock is partly buried exactly when it matters (the shot and the hit are the same tick).
- R3: carry body identity in the 2.5 to 4 kHz click (R2) at -20 dBFS (about +12 dB above its masked threshold), and keep weapon pitched bodies below 200 Hz where possible so thock sits above them. Measure: render shot + hit together offline and check the hit cue's band energy exceeds the weapon's in the 2.5 to 4 kHz band by >= 10 dB.

### 3.4 Cue families get their own bands (finding: tink collides with the ladder top)

Design §12: kill chime is a pentatonic ladder, 8 steps. Major-pentatonic ratios from the root: 1, 9/8, 5/4, 3/2, 5/3, 2, 9/4, 5/2. With any root above 760 Hz the top step exceeds 1.9 kHz, i.e. a **high kill chime would sound like a headshot tink**. With root 440 Hz the ladder spans 440 to 1100 Hz (ERB 9.97 to 16.35, DERIVED).

- R4: **ladder 440 to 1100 Hz** (sine + one soft harmonic, no click), **headshot tink 3.0 kHz** (ERB 24.6; 8.2 ERB above the ladder top; also near the ear's most sensitive region, so it needs less level), **thock 150 to 260 Hz**. Three non-overlapping bands: body below 300 Hz plus click, kill 440 to 1100 Hz, head above 2.5 kHz. Headshot kill = tink + ladder step (they remain separable). Measure: no cue family's partials within 3 ERB of another's (checked in the pure `cues.test.ts`, section 10).

### 3.5 Minimum useful durations and level separations

Tonal cues need roughly 5 to 10 cycles to carry pitch and a 3 to 5 ms attack to avoid an unintended click (the click is added deliberately where wanted). Short bursts are perceived quieter (3 to 6 dB, COMMON [S5]).

| Cue | Minimum duration | Level re full-scale peak | Why |
|---|---|---|---|
| Body thock | 50 ms (>= 7 cycles at 150 Hz) | -12 dBFS | pitch needs cycles; short sounds read quiet, so keep the peak up |
| Leg | 35 ms | -18 dBFS (-6 dB re body) | one clear 6 dB step weaker |
| Headshot tink | 100 ms, decay to -40 dB | -10 dBFS | the "best" hit cue is the loudest and longest hit cue; still shorter than 130 ms so it ends before the next 13 shots/s hit |
| Kill chime step | 120 ms (+ tail to 250 ms allowed) | -9 dBFS | strongest positive; must end before the next kill window (>= 150 ms between kills is typical) |
| Moving-shot tock | 40 ms | -18 dBFS | clearly subordinate to the shot |
| Streak break | 150 ms | -20 dBFS | informative, not punishing |
| Enemy tell sweep | = tell length (0.25 to 0.5 s) | -12 dBFS at the enemy, never ducked | must be heard first |

Rule of thumb R5: **adjacent importance tiers differ by >= 3 dB**, and the hierarchy (loudest to quietest) is tell >= kill > headshot > body > leg > moving-shot > streak break. Measure: peak and short-term loudness (RMS over 100 ms) of each rendered cue in the offline check, ordering asserted.

### 3.6 Latency and scheduling

- Hit marker and hit sound for one event must be emitted from the same event callback in the same frame; AV sync tolerance (sound lag up to about 125 ms, lead up to about 45 ms [S2]) is large relative to one frame, so the practical risk is **scheduling drift, not frame granularity**.
- The scaffold's `playKill` schedules its second note with `setTimeout`; drift under load can exceed the 45 ms lead tolerance. R6: schedule multi-part cues on the audio clock (`ctx.currentTime + offset`) in one call. Measure: `ctx.baseLatency + ctx.outputLatency` shown in the debug overlay, p95 < 30 ms desktop; offline render verifies onsets within 1 ms of design.
- Per-hit cost: <= 3 nodes created per cue or a pre-rendered `AudioBuffer` (§12 already renders one-shots offline); voice cap 24, drop the oldest body-hit first.

---

## 4. Do pitch ladders aid streak awareness?

Yes, with limits.
- Relative pitch direction ("higher than last time") is processed reliably and effortlessly; rising pitch maps to "more/better" cross-modally ([S10]). Players will hear "the streak went up" within a few kills.
- Absolute identification of a pitch category is poor without training (about 5 to 7 categories [S6]), so an 8-step ladder cannot be read as an exact count by ear alone.
- Therefore the ladder gives **direction, approximate level (low/mid/high thirds) and break detection**, while the exact number stays in the on-screen counter (§7.1 already has both). This matches §7/§12 and needs no structural change.

Parameters (R7): minimum adjacent step **2 semitones** (pentatonic steps are 2 to 3 semitones; at least 3.4x the JND), 8 steps maximum, **extra layered fifth per chain step capped at 2 layers** (a stack above 3 fifths becomes a dense cluster and masks itself), ladder root fixed per run (no jitter on kill/headshot cues; ±3% jitter only on weapon and body hit, §12 already says ±3% on shots). Test: five listeners hear random 8-kill sequences without visuals: report whether the last step was higher or lower (>= 95%) and the third of the ladder (>= 70%).

---

## 5. Enemy tells: fair timing and distinct sound

Design §5.3: tell lasts 0.5 s (dial 0) to 0.18 s (dial 100), "never below 0.15 s, a fairness floor from human reaction times".

DERIVED check. Player needs: perceive (auditory about 0.15 to 0.16 s, visual about 0.19 s [S1]) + decision/aim adjustment + at least one trigger pull. A 0.15 s tell is **shorter than the mean simple reaction time**, so the average player cannot begin to react before the enemy fires; even a fast player (0.13 to 0.15 s) has almost nothing left. For the tell to be a skill test rather than luck the player needs the perception time plus at least one shot interval: 0.16 s + 0.09 s (rifle_spray 11 rps) = about 0.25 s.

- R8: **fairness floor 0.25 s default** (dial 100 end-point 0.25 s instead of 0.18 s); keep the tunable's hard clamp at 0.15 s so a designer can still make a hardcore variant. Everything else in §5.3 (0.5 s at dial 0; reaction 1.2 s to 0.3 s) stays. Measure: bot harness (#28) with a human-calibrated reaction model; the share of tells a 0.18 s reactor can answer should be >= 60% at dial 100.
- The first tell a new player ever meets should be generous (0.8 s; ESTIMATE, to be tuned in the playtest) so the sound and the laser line are learned before they matter.
- Distinctness: tells are **sweeps from the enemy's position** (saw/triangle, 300 to 900 Hz, HRTF panned); rewards are **steady, centred, sine-based**; damage is a **low dry thud centred**. Three different dimensions (pitch motion, spatial anchoring, timbre) so the three can never be confused. Keep this, plus R9: tells are never ducked by hit/kill cues (§12's 3 dB/80 ms duck applies to weapons only) and sit at least 6 dB above the ambient/menu bed.
- Directional redundancy: the damage arc and the tell laser carry direction visually so pan is an enhancement, not the only carrier (also required for mono/one-ear players).

---

## 6. Flash, pulse and photosensitivity limits

Standards used: WCAG 2.2 SC 2.3.1 *Three Flashes or Below Threshold* (and 2.3.3-style motion guidance), ITU-R BT.1702 and the Harding flash criteria [S7]; clinical guidance [S9]; the Game Accessibility Guidelines [S12]. A **general flash** is a pair of opposing changes in relative luminance of >= 10% of the maximum (where the darker state is below 0.80), over a combined area of about 0.006 sr (about 25% of a 10 degree field, 341 x 256 px at 1024 x 768 reference). More than 3 per second fails. A **red flash** is a transition to or from saturated red (R/(R+G+B) >= 0.8). Photosensitive seizures are most provocative around 15 to 25 Hz and with high contrast, large area, red [S9].

Computation on our palette (DERIVED, linear relative luminance, `cvd_check.py`): trim #38E8FF L = 0.658, gold L = 0.677, core L = 0.890, alert #FF3D5A L = 0.253, ember L = 0.288. None of alert/ember is "saturated red" by the R/(R+G+B) definition (0.63 and 0.64), so the general-flash rule governs; we still keep to the stricter red guidance below.

At a 27 inch monitor at about 65 cm the 0.006 sr area is only about 5 x 5 cm, so **any full-width edge pulse counts**; a small hit marker (about 2% of the screen) does not, even at 13 Hz.

| Effect | Design today | Limit (R10, measurable) |
|---|---|---|
| Hit marker at crosshair (<= 2% of screen) | 90 to 140 ms, restarts on each hit | **Allowed at any rate** (area below threshold). Must restart one element, never stack. Must not carry any screen-wide element on each hit. |
| Kill screen-edge pulse | "3-frame" pulse in accent colour | Specify in **ms: 90 ms total (30 up, 60 down)**; peak alpha <= **0.15** for trim (alpha_max = 0.10 / L = 0.152 over black, DERIVED); **max 3 pulses in any 1000 ms**, enforced by a token bucket in ms (a skipped pulse still plays sound and marker, so no information is lost). |
| Chromatic-aberration pulse on kills (High, default off) | 3 frames | **90 ms**, max offset 2 px at the edges, **shares the 3/s bucket** with the edge pulse (one budget for all full-width effects). |
| Damage vignette (alert red) | "brief", 150 ms desaturate | Peak alpha <= **0.30** (below the 0.39 cap that keeps dL <= 0.10 for L = 0.253, DERIVED), **min 333 ms between pulses**, **no repeat in the 15 to 25 Hz band** (guaranteed by the 333 ms gap). |
| Surge glow (frame) | "frame glow, shimmer" | A steady glow, modulation **<= 1 Hz sine and <= 6% luminance amplitude**; never a square or strobe wave; fade in over >= 300 ms; counts as a flash only if modulated faster than 3 Hz, so cap at 1 Hz with margin. |
| Chain/streak counters and toasts | pulse once | Scale/opacity pulses only (<= 20% scale); any full-width flash is forbidden. |
| Camera flinch and shake | spec 4.4 | Default modest; scaled by "Reduce flashing"/"Reduce motion". |

Frame-rate independence (R11): implement every pulse as a **time-based** animation (CSS `animation-duration` in ms or a ms timer in `hud`/`render`), never as "N frames". At 144 fps 3 frames is 21 ms, shorter than the eye integrates a luminance change and below the 90 ms needed to be perceived as a deliberate cue; at 60 fps it is 50 ms.

"Reduce flashing" (R12): turns off edge pulses, chromatic pulse, the damage vignette's pulse (replaced by a steady 0.15 alpha fade over 250 ms) and Surge modulation; **default it to on when the OS reports `prefers-reduced-motion: reduce`**. Measure: a debug-hook script fires 20 kills in 1 s and a counter asserts <= 3 full-width pulses began in any 1000 ms window (pure logic: the token bucket is a small function in `feedback/` with a unit test).

---

## 7. Colour-vision-safe palette check

Method: Machado, Oliveira and Fernandes 2009 simulation, severity 1.0, applied in linear sRGB [S8]; WCAG contrast ratio on relative luminance; CIE76 delta E in CIELAB for distinctness (>= 20 clearly separable, < 10 risky; a coarse but standard screening). Script: `docs/research/cvd_check.py`.

### 7.1 Contrast against `ink` (#0B0D14), WCAG ratio

| Token | Hex | Normal | Protan | Deutan | Tritan | Verdict |
|---|---|---|---|---|---|---|
| trim | #38E8FF | 13.08 | 14.53 | 12.12 | 13.90 | pass |
| core | #FFF1D6 | 17.38 | 16.99 | 17.62 | 17.03 | pass |
| gold | #FFD23F | 13.44 | 12.41 | 14.08 | 12.46 | pass |
| ok | #5BF2A5 | 13.58 | 14.67 | 12.82 | 13.44 | pass |
| warn | #FFB020 | 10.61 | 9.33 | 11.44 | 9.59 | pass |
| **alert** | #FF3D5A | 5.61 | **3.89** | 6.75 | 4.94 | **fails 4.5:1 under protanopia** |
| ember | #FF5A36 | 6.26 | 4.57 | 7.37 | 5.26 | pass (barely) |

### 7.2 Echoes vs environment surfaces (design claims at least 7:1 against any surface)

Minimum over ink, slate #151A26 and steel #26304A (cover):

| Echo colour | Normal | Protan | Deutan | Tritan |
|---|---|---|---|---|
| ember #FF5A36 (default) | **4.22** | **3.01** | 5.04 | **3.52** |
| magenta (proposed #FF4FD8) | 4.59 | 3.59 | 5.30 | 4.33 |
| lime (proposed #9CFF3A) | 10.46 | 10.38 | 10.29 | 10.18 |
| amber (= warn #FFB020) | 7.16 | 6.14 | 7.83 | 6.42 |
| contrast (#FFFFFF + black outline) | 13.09 | 12.74 | 13.31 | 12.98 |

The 7:1 claim in §11 is **not met** by Ember, the default, against steel cover (4.22 normal, 3.01 protan). WCAG non-text contrast asks for 3:1; for a target that must pop at 50 m we want more. Candidate ember brightness (DERIVED, min over surfaces, normal/protan/deutan/tritan): #FF7A52 = 5.09/3.94/5.86/4.41; **#FF8A5C = 5.64/4.54/6.38/4.97**; #FFA070 = 6.55/5.53/7.24/5.92.

- R13: default Echo body **#FF8A5C** (>= 4.5:1 under all four simulations) with the head node `core` (>= 10:1 against everything) and the fresnel rim doing the rest; **restate the requirement** as "body >= 4.5:1, head node and rim >= 7:1 against any surface, in every CVD simulation". Same for the Magenta preset (raise to about #FF6FE0 and recheck with the script).
- Amber preset **collides with `warn`** (same hex): an amber Echo makes the amber moving-shot tracer unreadable. R14: rename the preset "Sunflower" at a visibly different hue/luminance **or** change `warn` (below).

### 7.3 Pairs that must stay distinguishable (delta E76; luminance ratio is normal vision)

| Pair (meaning) | Normal | Protan | Deutan | Tritan | Lum. ratio | Verdict |
|---|---|---|---|---|---|---|
| gold / core (headshot vs standard head node) | 59.9 | 65.4 | 57.9 | 21.8 | 1.29 | ok |
| **gold / warn** (headshot vs moving shot) | 18.8 | 10.4 | **7.9** | 18.6 | 1.27 | **fails: nearly identical** |
| ok / alert (good RT vs damage) | 133.1 | 46.7 | 26.8 | 142.2 | 2.42 | ok (luminance carries it) |
| ember / alert (Echo vs damage arc) | 26.2 | 29.0 | 20.5 | **5.8** | 1.12 | weak under tritan; arc is a ring shape, not an Echo overlay, so low risk |
| trim / ok (UI accent vs "beat your median") | 53.8 | 50.6 | 49.1 | **8.1** | 1.04 | weak under tritan; ok only as text/number so add a glyph |
| ember / warn | 50.9 | 40.0 | 22.3 | 46.5 | 1.70 | ok |
| core / white (crosshair vs hitmarker) | 15.4 | 15.4 | 15.7 | 8.7 | 1.12 | do not rely on colour; shapes differ |

Candidate replacements for `warn` (moving shot), delta E vs gold [normal/protan/deutan/tritan]: #FF8A1F = 40/24/15/40; #FF7A00 = 48/29/18/49; **#B58CFF (violet) = 132/133/126/34**. R15: **`warn` → #B58CFF** (contrast on ink 7.5 to 7.8 in all simulations; delta E vs alert 69 to 89) and keep the `⇆` glyph, the dashed tracer, and the dull "tock", so the moving shot is told apart by shape and sound, not hue. Amber is then free for the preset, and gold has a unique meaning (headshot) in the whole UI.

R16: **`alert` → #FF5470**: contrast on ink 6.24/4.61/7.33/5.37 (all >= 4.5), delta E vs gold 87/79/49/63.

R17: do not encode meaning by colour alone: "RT turns green if it beats the run median" (§7.1) gets a **▲/▼ glyph**; headshot hit marker differs by **shape (ring + longer ticks)** as well as gold; kill marker by **rotation to a plus**; damage by the **arc position**. Three palettes ship: default (the revised tokens), high-contrast (white, yellow, thicker outlines), and CVD-safe (blue #5AA9FF and orange #FF9A3D only, no red/green pairs); validated by the script (R18: any palette change must keep all rows of 7.1 and 7.2 above 4.5:1 and 7.3 delta E >= 20 in at least three of four simulations, or the PR fails review; CI integration is not proposed because the check is a design-time tool).

---

## 8. Proposed parameter changes (to design §12 table, §7 timings, §11 palette, §5.3)

| ID | Where | Current | Proposed | Evidence | Measurable check |
|---|---|---|---|---|---|
| R1 | §12 Leg hit | thock a semitone lower, -6 dB | 3 semitones lower (18%), -6 dB, 35 ms, no click | 3.1: 0.25 ERB, 5.9% | body/leg 2AFC >= 90%; ERB sep >= 1.5 |
| R2 | §12 Body hit | 220 -> 110 Hz sine + click | 260 -> 150 Hz, 2nd harmonic -6 dB, 3 ms 3 kHz click -8 dB | 3.2: small speakers, equal loudness | >= 10 dB energy above 250 Hz |
| R3 | §12 mix | thock under weapon body, about 3 dB S/M | click carries identity at -20 dBFS; weapon pitched body < 200 Hz | 3.3 masking arithmetic | >= 10 dB over weapon in 2.5 to 4 kHz |
| R4 | §12 Headshot / Kill | tink 1.9 kHz; ladder root unspecified | ladder 440 to 1100 Hz; tink 3.0 kHz; thock 150 to 260 Hz | 3.4 ERB bands | no partials within 3 ERB across families |
| R5 | §12 mix | hits -12, weapons -15 | tiers >= 3 dB apart; order tell >= kill > head > body > leg > moving > break | 3.5 | offline RMS ordering test |
| R6 | §12 / audio | chime second note on `setTimeout` | all multi-part cues scheduled on `ctx.currentTime` | 3.6, AV sync window | onset error <= 1 ms; overlay shows output latency |
| R7 | §12 Chain/ladder | a fifth added per chain step | cap 2 layers; steps >= 2 semitones; 8 steps max | 4 | ladder test (>= 95% direction, >= 70% third) |
| R8 | §5.3 tell | floor 0.15 s, 0.18 s at dial 100 | default floor and dial-100 value 0.25 s; hard clamp 0.15 s; first-ever tell 0.8 s | 5 reaction-time arithmetic | bot sim: >= 60% answerable at dial 100 |
| R9 | §12 mix | weapons ducked 3 dB/80 ms by hits | tells never ducked; >= 6 dB over bed | 5 | mix test |
| R10 | §7/§11 pulses | "3-frame" screen pulse | 90 ms; alpha <= 0.15 (trim); <= 3 full-width pulses per 1000 ms shared bucket; damage vignette alpha <= 0.30, >= 333 ms gap | 6 | scripted 20 kills/s; bucket unit test |
| R11 | §7/§11 | frame-counted | ms-based animations only | 6 | none in code that counts frames for visuals |
| R12 | §13.3 settings | Reduce flashing | also on by default with `prefers-reduced-motion`; replaces pulses with a steady fade | 6 | settings test |
| R13 | §11 palette | Ember #FF5A36; "7:1 vs any surface" | Ember #FF8A5C; claim restated: body >= 4.5:1, head/rim >= 7:1, all CVD sims | 7.2 | `cvd_check.py` |
| R14 | §11 presets | "Amber" = warn | rename or recolour so it differs from warn | 7.2 | script |
| R15 | §11/§7.1 | warn #FFB020 amber | warn #B58CFF violet (keep glyph, dashed tracer, tock) | 7.3 gold/warn delta E 7.9 deutan | script |
| R16 | §11 | alert #FF3D5A | alert #FF5470 | 7.1 (3.89 protan) | script |
| R17 | §7.1 | colour-only RT green | add ▲/▼; markers differ by shape | WCAG 1.4.1 [S7] | review |
| R18 | process | none | palette changes re-run the script; thresholds above | 7 | script output in PR |

---

## 9. Sources

- **[S1]** Kosinski, R. J., "A literature review on reaction time" (Clemson University, 2008/2013) and Brebner and Welford, 1980: simple reaction time about 150 to 160 ms (auditory) and 180 to 200 ms (visual) in healthy adults; trained gamers faster. (COMMON; ranges.)
- **[S2]** ITU-R BT.1359-1 (1998), "Relative timing of sound and vision for broadcasting": detectability about +45 ms (sound early) to -125 ms (sound late); acceptability about +90 to -185 ms.
- **[S3]** Glasberg and Moore (1990), "Derivation of auditory filter shapes from notched-noise data", *Hearing Research* 47: ERB and the ERB-number scale.
- **[S4]** ISO 226:2003, *Acoustics: Normal equal-loudness-level contours*.
- **[S5]** Zwicker and Fastl, *Psychoacoustics: Facts and Models* (temporal integration of loudness, masking, critical bands); Moore, *An Introduction to the Psychology of Hearing* (frequency and level discrimination).
- **[S6]** Pollack (1952), "The information of elementary auditory displays", *JASA*; Miller (1956), "The magical number seven, plus or minus two", *Psychological Review*: absolute identification of about 5 to 7 categories.
- **[S7]** W3C WCAG 2.2: SC 2.3.1 *Three Flashes or Below Threshold* (general flash and red flash definitions), SC 1.4.1 *Use of Color*, SC 1.4.3 and 1.4.11 contrast; ITU-R BT.1702 (guidance for the reduction of photosensitive epileptic seizures caused by television); Harding FPA flash test criteria.
- **[S8]** Machado, Oliveira and Fernandes (2009), "A physiologically-based model for simulation of color vision deficiency", *IEEE TVCG* 15(6): the matrices used in `cvd_check.py`.
- **[S9]** Fisher et al. (2005), "Photic- and pattern-induced seizures: a review for the Epilepsy Foundation of America Working Group", *Epilepsia* 46(9): most provocative about 15 to 25 Hz, high contrast, large area, saturated red.
- **[S10]** Gaver (1986), "Auditory icons", and Blattner, Sumikawa and Greenberg (1989), "Earcons and icons", on learnable non-speech cues; Spence (2011), "Crossmodal correspondences: a tutorial review", *Attention, Perception and Psychophysics* (pitch height to magnitude/brightness).
- **[S11]** Colour vision deficiency prevalence about 8% of men, 0.5% of women (standard epidemiological figure, e.g. Birch 2012).
- **[S12]** Game Accessibility Guidelines (gameaccessibilityguidelines.com): flashing/shake options, do not rely on colour alone, separate volume sliders.
- **[S13]** Web Audio API specification (W3C): `AudioContext.currentTime` scheduling, `baseLatency`, `outputLatency`, `PannerNode`.
- **[S14]** Fletcher (1940) and Hawkins and Stevens (1950), critical bands and critical ratio.
- `docs/mechanics-spec.md` for fire rates (3.1), tagging (4.3) and flinch (4.4); `docs/design.md` (branch `fm/fl-design`) §5.3, §7, §11, §12, §14.3.

---

## 10. How to verify (cheap, in seconds; for the implementing issues)

1. **Pure logic tests** (`feedback/`, run with the suite): `killLadderStep` strictly increasing, 2 semitone minimum, cap at 8; full-width pulse token bucket (<= 3 per 1000 ms, deterministic in ms); tell-length function monotone and clamped at the floor; cue definitions as data: no two families within 3 ERB, tier ordering R5.
2. **Offline render check** (browser, `OfflineAudioContext`, not in the Node suite): render each cue; assert duration, peak, short-term RMS ordering, spectral-centroid ordering leg < body < head < kill, >= 10 dB above 250 Hz for body, and the masking margins in R3.
3. **Palette check:** `python3 -I docs/research/cvd_check.py` after any colour change.
4. **Human check** (recorded in playtest #29, five people, cheap headphones and laptop speakers): after one 60 s run, classify body/leg/head/kill/tell from audio alone >= 90%; ladder test from section 4; no one reports "pulse too strong" with Reduce flashing off.
5. **Latency:** overlay shows `baseLatency + outputLatency` and the p95 cue-to-output estimate; target < 30 ms.

## 11. Out of scope

Implementing any of this (belongs to #20, #24, #40, #41, #42, #44); editing `docs/design.md` (the owner adopts section 8 changes); real-person user studies beyond the playtest in #29.
