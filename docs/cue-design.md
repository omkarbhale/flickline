# Flickline cue design: hit, headshot and tell cues players learn in a minute

Research deliverable for issue #52. It is the spec that the implementation issues build from: per-shot visuals (#24), the feedback sound set (#20), enemy and damage audio (#41), callouts and medals (#40), enemy tells (#32), post effects (#44) and the HUD (#25). Numbers marked PLACEHOLDER are starting values to tune by ear and eye; they are exposed as tunables (`config/audio.ts`, `config/feedback.ts`), never inline.

Confidence tags follow `docs/mechanics-spec.md` 0.1. Perception figures below are standard human-factors values (COMMON); where one was derived for Flickline it is DERIVED, and where it is a guess it is ESTIMATE or PLACEHOLDER. No external web sources were fetched for this document; every COMMON figure is textbook psychophysics or established game-audio practice and is flagged so a reviewer can check it.

Identity rule (hard): every cue is original. Cues are built from synthesis (Web Audio, oscillator, noise, filters) and CSS/three.js shapes. No sample, melody, colour scheme, icon or silhouette is taken from the reference game or any other title. Only the **roles** the cues play (a distinct headshot cue, a kill cue, an incoming-fire cue) match convention, because players' reflexes transfer on role, not on timbre.

---

## 1. What a cue is for

Flickline is a trainer. Cues are not decoration; each one answers a question the player has within about 150 ms of an event, and every answer is also a teaching signal for Valorant-style mechanics.

| Question the player asks | Cue family | What it teaches |
|---|---|---|
| Did that shot connect? Where? | Hit cues (body, leg, head) | Crosshair placement; head height |
| Did that kill? | Kill cue and kill ladder | Burst discipline, not over-shooting |
| Did I miss, and by how much? | Miss and near-miss cues | Spread, recoil, counter-strafe timing |
| Was I accurate when I fired? | Moving-shot cue | Stopping before shooting |
| Is something about to hurt me? | Enemy tells | Reading peeks, reacting, pre-aiming |
| Did I get hurt? From where? | Damage-taken cues | Tagging, trading, repositioning |
| Am I doing well? | Chain, medal, Surge, rank-up | Motivation; the faster-than-the-reference-game reward loop |

Design target ("learned in a minute"): a new player who plays one Cold Start run (about 60 s) can, without any text, tell body from head hit, kill from hit, and "enemy is about to shoot" from ambient. The test is in section 11.

## 2. Principles (the rules every cue obeys)

1. **One meaning per cue, one cue per meaning.** Never reuse a timbre for two events. Players learn arbitrary mappings quickly only when they are consistent (earcon practice, COMMON).
2. **Redundancy across channels, hierarchy within a channel.** Every critical event is carried by sound AND a visual, so a player with sound off, or with one impairment, still gets it (section 9). Within a channel, importance is encoded by the same few dimensions: pitch up, duration longer, layers more, for "better".
3. **Pitch height means "better outcome".** Higher and brighter = more reward (head over body, kill over hit). Lower and duller = worse or harm (leg, damage taken). This is the single most important mapping because it is the same for sound (pitch) and visual (brightness/size), so the two channels reinforce each other (cross-modal correspondence, COMMON).
4. **Distinguish by more than one dimension.** Cues that differ only in pitch are confused under load. Each family differs in pitch AND envelope AND timbre (section 4).
5. **The shot must stay audible and instant.** Hit cues are layered on top of the weapon fire sound, never replacing it, and never delay it. Target end-to-end latency from the sim tick that produced the event to audible output is under 50 ms; see 3.
6. **Fast enough to not mask the next shot.** At 13.3 shots/s (SMG, 75 ms interval; mechanics-spec 3.1) a cue longer than the interval overlaps itself. Hit cues are short (30 to 90 ms tail on the stackable ones) and rate-limited (section 7.3).
7. **Reward is quicker than punishment, and punishment is informative, never noisy.** Kill rewards are the loudest positive event. Damage taken is clear but never louder than a kill, so the trainer does not feel punishing.
8. **No cue is a surprise after the first minute.** Everything is introduced in the first run by being unavoidable (the first body hit, first headshot, first kill all happen in the first seconds of Cold Start) before it is named in text.
9. **Quiet is a design tool.** Ambient bed stays below the cue bands (section 3.3) so a cue never has to be loud to be heard.
10. **Everything has a switch.** Each cue family has a volume or intensity setting (settings UI, #42), and the default is the tested one.

## 3. Perception budget

These constraints decide the numbers in sections 4 to 6.

### 3.1 Latency (COMMON, DERIVED)

- Simple reaction time to an auditory stimulus is about 150 ms and to a visual one about 190 ms in healthy adults; trained players are faster (COMMON). A sound cue that arrives late by 50 ms is a large fraction of a human's decision window, so audio must not be the slow channel.
- Audio and visual are perceived as synchronous when sound lags the picture by up to roughly 45 ms and leads by up to roughly 30 ms (COMMON; the asymmetry is because sound is physically later in nature). Therefore the visual hit marker and the hit sound for the same event must be emitted from the same event callback in the same frame.
- Web Audio `latencyHint: 'interactive'` (already used in `audioEngine.ts`) typically yields 10 to 25 ms on desktop and more on some Bluetooth and mobile devices (COMMON). Budget: event at tick, scheduled the same frame (`ctx.currentTime`, no `setTimeout`; the scaffold's `playKill` uses `setTimeout` for the second note and drifts, so the kill ladder is scheduled on the audio clock instead, see 5.2). At 144 fps a frame is 6.9 ms; the sim tick is 7.8 ms. Cues emitted in the same frame as the tick that produced them satisfy the budget.
- The game must not pay a cost per hit. Prebuild noise and any impulse-response buffers at the first gesture; per-hit work is creating one or two short-lived nodes (as the scaffold does) or, better, starting pre-rendered `AudioBuffer`s. No allocation of new buffers in the hot path (architecture 7).

### 3.2 Frequency (COMMON)

- Human hearing is most sensitive at roughly 2 to 5 kHz (the ear canal resonance), so the cues that must cut through everything live there. Content below about 150 Hz and above 10 kHz is inaudible on laptop speakers and many headsets, so identity must not live there.
- Pitch discrimination: a difference of about 1 to 3% is just noticeable for a pure tone at 1 kHz; an interval of a minor third (about 19%) or more is robustly separated under distraction. Cue pitches in a family that must be told apart differ by at least a minor third.
- Masking: noise at nearby frequencies hides a tone. Gunfire is broadband noise at roughly 500 Hz to 6 kHz, so hit cues must either sit above it (3 to 9 kHz, bright and short) or be distinct in time (a few ms after the shot, which the sim guarantees because the fire event and the hit event are the same tick) or in timbre (tonal against noisy).

### 3.3 The cue bands (design allocation, PLACEHOLDER)

| Band | Content | Why |
|---|---|---|
| 60 to 400 Hz | Weapon body thump, kill bass hit, footsteps, damage thud | Felt, not identified; keeps weight |
| 400 to 2.5 kHz | Ambient bed, weapon noise body | Kept quiet and low-contrast |
| 2.5 to 9 kHz | Hit, headshot, kill tonal cues; enemy tells | Most audible band; reserved for information |
| Above 9 kHz | Air and sparkle on headshot/kill only | Reward texture; never the carrier |

### 3.4 Visual (COMMON)

- Foveal attention is on the crosshair. Hit confirmation therefore goes AT the crosshair (a marker that animates around it), not at the screen edge. Peripheral cues (screen edge flash, damage arc) are for things that are not where the player is looking.
- Motion and sudden onset attract attention more than colour. A cue is first an onset, second a shape, third a colour. Colour is the weakest differentiator (colour vision deficiency affects about 8% of men, COMMON), so every colour-coded cue also differs in shape, size or motion.
- A flash longer than about 150 ms starts to hide the target at 144 fps play; hit markers live 90 to 170 ms (section 4.1) and never use full-screen white.

## 4. Hit cues (body, leg, head)

Events: `targetHit { zone: head|body|leg, damage, distance, ... }`. The zone is part of the payload (hit zones are added with the humanoid enemies; the scaffold's sphere targets are treated as `body`). Visual and sound fire from the same event.

### 4.1 Visual: the hit marker

A four-tick marker around the crosshair (the scaffold has one), animated by CSS class toggle, never per frame.

| Cue | Shape | Colour token | Size and motion | Duration |
|---|---|---|---|---|
| Body hit | 4 short ticks, diagonal (X) arrangement | `--cue-hit` white | Pops from 6 px to 14 px, ease-out | 110 ms |
| Leg hit | Same ticks, bottom two ticks only, half opacity | `--cue-hit` dim | 6 to 10 px, no pop | 90 ms |
| Headshot | Ticks plus a ring that expands from the crosshair centre; ticks longer | `--cue-head` hot amber | 8 to 22 px, ease-out, ring 0.6 to 1.2 of tick length | 170 ms |
| Kill | Ticks rotate 45 degrees to a + form, hold, then fade; for a head kill the ring is kept | `--cue-kill` bright cyan (white core) | 8 to 26 px, slight hold | 220 ms |

Rules:
- The marker spawns on the same frame as the event; it never waits for the tick boundary beyond the event itself.
- Rapid hits restart the animation (class toggle with forced reflow, as in `hud.ts`), they do not stack DOM nodes. The marker is one element with variants, so 13 hits a second cost 13 class toggles.
- Tracers and impacts (render pooled effects, #24) are separate and do not carry the confirm job; they carry "where did it land" in the world.
- Headshot also drives a small world-space accent at the hit point: a 3-spoke burst 0.25 m wide, 120 ms, additive, using the pooled impact effect with a different material (no new allocation).

### 4.2 Sound: hit family

All hit cues are **tonal**, built from two sine/triangle partials with a fast attack (1 to 2 ms) and a clean exponential decay, so they read against the noisy gun sound. They are layered with, not instead of, the fire sound.

| Cue | Partials (Hz) | Envelope | Duration | Level (vs fire = 0 dB) | Character |
|---|---|---|---|---|---|
| Body hit | 1850 + 2300 (a major-third-ish pair) | 1 ms attack, decay to -40 dB in 55 ms | 60 ms | -9 dB | Short tick, "tock" |
| Leg hit | 1100 + 1380 | 1 ms attack, decay 50 ms | 55 ms | -12 dB | Dull, lower, quieter: "worse" |
| Headshot | 3300 + 4400 + 6600, with 10 ms downward pitch bend of -4% | 0.5 ms attack, decay 130 ms, 8 ms noise click at start | 150 ms | -4 dB | Bright "ping" with a click on the front |
| Kill | See 5 (ladder) | | | | |

Why these: body at about 2 kHz sits in the ear's most sensitive band but below the headshot's pitch by well over a minor third (about 1.8x), so head is instantly distinguishable at any volume; the click on the headshot adds a second, noise-based dimension so it survives when pitch is masked. The headshot is deliberately the brightest, shortest-attack cue in the game so it is learned as "the good sound" in a few shots. Leg is the dullest so shooting legs feels (correctly) like a missed opportunity, nudging the player upward.

Pitch variety: the body-hit pitch is randomised by +/- 3% per hit with audio-side jitter (`audio/` is presentation, outside the pure layers, so it may use its own small generator; the sim's `world.rng` is never consumed for it, so determinism is untouched). 3% is inside the just-noticeable band for a single hit but prevents machine-gun fatigue when 13 hits per second land. Headshot and kill are NOT jittered, because they are the cues that must be perfectly recognisable.

### 4.3 Hit stacking and ducking

When several hit events land within one weapon interval (for the SMG, 75 ms; spray rifle 91 ms), cues do not pile up into mush:

- Body hit cues within 40 ms of the previous body hit are skipped for sound (the visual still plays). This keeps pitch discrimination possible during sprays (PLACEHOLDER).
- A headshot or kill always plays and **ducks** body hit cues for 120 ms by 6 dB (single gain node, no per-hit allocation).
- The weapon fire sound is never ducked.

## 5. Kill cues and the kill ladder

Events: `targetKilled`, plus the feedback layer's count of kills in the current chain (#40). The kill cue is the strongest positive cue.

### 5.1 Single kill

- Sound: a two-stage cue at the moment of death. Stage 1 (0 ms): the same tonal hit cue for the zone that killed (so the player hears "headshot" within a kill). Stage 2 (+35 ms, scheduled on the audio clock, NOT `setTimeout`): a rising "resolve" of two sine tones, 880 Hz then 1320 Hz (a perfect fifth, the strongest consonant interval), 90 ms each, with a soft shimmer of filtered noise above 7 kHz (60 ms). Original, because the motif is a plain fifth and the timbre is synthesised; the role (rising two-note) is conventional.
- Visual: kill marker (4.1), and the enemy's death effect: a brief shatter (pooled shards, 200 to 350 ms) in the enemy's Echo colour, plus a 1-frame brightening of the crosshair. No full-screen flash.
- Reward: a short, small "+N" popup near the crosshair (not at a corner) rising 24 px over 350 ms; N is the score of that kill (#25).

### 5.2 The ladder (chain)

Consecutive kills within a chain window (default 2.5 s, PLACEHOLDER; owned by the feedback layer) raise the kill cue one step each time. The ladder is the cheapest, most teachable reward: players learn "higher is better" without reading anything.

| Chain step | Kill cue root (Hz) | Added layer | Marker change |
|---|---|---|---|
| 1 | 880 | none | standard |
| 2 | 988 (about +2 semitones) | + octave sparkle (10 ms) | ring thickens |
| 3 | 1109 (about +4) | + sub thump 80 Hz, 60 ms | ticks extend |
| 4 | 1319 (about +7) | + second voice a fifth above | marker core glows |
| 5 and beyond | cap at step 5 | step 5 plus Surge sting, see 6 | marker is gold-cyan |

Rules: the ladder is derived from a pure function `killLadderStep(chain) -> {root, layers}` in `feedback/` (pure, deterministic, tested) so audio and visual both read the same step. The step resets with the chain, with a short falling "drop" tone (440 Hz to 330 Hz, 120 ms) on a broken chain so the player learns what a miss cost, not as punishment but as information. The drop is played at low level and only if the chain was 3 or more.

## 6. Streak, medal and Surge cues (summary; detail in #40)

- Medals: a 1.2 s sting (three-note arpeggio on the ladder root, original) plus a toast below the crosshair, 1.6 s. One medal at a time; queue extras, never overlap two stings.
- Surge (the high-chain "flow" state, name is Flickline's own): a sustained pad layer faded in at the 5th chain step, 40 Hz-300 Hz warm bed plus a bright 3rd partial; plus a subtle edge glow (CSS, no post-processing needed; with post-processing on, #44 adds a chromatic pulse). It must drop out within 300 ms of the chain breaking.
- Rank-up and personal best: the longest cues in the game (up to 2 s), only ever played between encounters (never mid-fight), so they cannot mask a tell.

## 7. Miss, near-miss and moving-shot cues (feedback on the shot itself)

### 7.1 Miss

A missed shot gets no reward sound, only the world impact (puff + decal, #24). Silence on a miss is information. The accuracy counter updates. Do not play an error buzzer: a trainer that punishes with noise discourages fire.

### 7.2 Near-miss (the "almost" cue)

If a shot passes within the target's hit zone expanded by 15 cm (head by 8 cm; PLACEHOLDER) but misses, emit a soft "whiff" cue: a 40 ms noise band swept 5 kHz to 2 kHz at -18 dB, plus a small marker flick (the four ticks appear at 30% opacity, 60 ms, outward direction of the miss). It tells the player "you were close, correct slightly" without confusing it with a hit: it is noise (no pitch), quiet, and visually dim, whereas every hit is tonal and bright. Disabled in "no assists" modes.

### 7.3 Moving-shot cue

Valorant-style accuracy collapses above the accuracy threshold (mechanics-spec 2.4: speed above about 27.5% of max is inaccurate), and learning to counter-strafe is a core transfer skill. When a shot is fired while moving faster than the accuracy threshold (the sim already knows: `shotFired` carries the movement-error flag once the weapon model lands, #14), play:

- Sound: a short dry "slip" cue, 70 ms, a downward-glissando triangle (700 Hz to 380 Hz) at -14 dB layered under the fire sound. Low and short so it is clearly "wrong" and never mistaken for a hit.
- Visual: the crosshair ticks briefly spread outward 6 px and settle (90 ms, one class toggle). This matches how the spread actually behaves, so the cue teaches the cause.
- Throttle: at most once per 250 ms, so spraying while strafing does not become a stream of noise.
- A hit while moving fast still gets its normal hit cue (the cue describes the shot, not the hit), so the player is never told "wrong" for a kill.

## 8. Enemy tells (the cues that make enemies readable)

Enemy shooting has to be readable and fair: the player reacts to a tell, not to being hit. Tells are issued by enemy behaviours (Strafer, Peeker, Rusher, Bulwark, Gnat; #32, #33) as `enemyTell { enemyId, kind, leadTime, pos }` events and `enemyFired { enemyId, pos }` events. `leadTime` is the sim's remaining time before the enemy fires, so presentation never invents timing.

### 8.1 The timing rule (DERIVED)

A tell is fair when the player has time to act on it. Practical rule: **tell lead time = base reaction budget + movement cost.**

| Component | Value | Basis |
|---|---|---|
| Reaction (perceive + decide) | 0.20 s | auditory simple RT about 0.15 s plus choice (COMMON, ESTIMATE) |
| Crosshair move to the enemy | 0.15 to 0.35 s | a 30 to 60 degree flick at trained speed (ESTIMATE) |
| Counter-strafe to be accurate | 0.16 s | mechanics-spec 2.3 braking |
| **Standard tell lead time** | **0.55 s at Novice, 0.40 s at Skilled, 0.28 s at Expert (floor)** | PLACEHOLDER, driven by the difficulty dial (#17) |

Why a floor: below about 0.28 s the average player cannot complete perceive, aim and shoot; the tell stops being a skill test and becomes luck. The dial tightens the tell as the player improves, which is what "matches your skill" means for enemy reaction.

Tells never get shorter than the fire-rate interval of the player weapon (0.075 s for the SMG) times three: the player can always land more than one corrective shot.

### 8.2 Tell kinds

| Tell | Used by | Sound (carrier) | Visual |
|---|---|---|---|
| **Charge** | all shooters | A rising tonal sweep, 600 Hz to 2400 Hz over the lead time, triangle wave with 7 Hz tremolo that accelerates; spatialised to the enemy | Enemy's trim lines (the Echo shader's glow) ramp from base to bright over the lead time; a thin line from the muzzle toward the player's head height (a "laser tell") whose opacity rises, 0 to 60% |
| **Peek** | Peeker | A short "unlatch" click-thunk (noise 4 kHz, 20 ms, plus a 140 Hz thump) when the enemy begins to appear | Enemy edge silhouette flickers at the corner, 80 ms |
| **Rush** | Rusher | A rising low growl (300 to 900 Hz sawtooth through a low-pass, 0.5 s) | Trim lines turn red-orange; stance leans in |
| **Guard break** | Bulwark | A dull "clank" (metal hit, 1.1 kHz + noise) when its shield opens | Shield panel flips, 120 ms |
| **Buzz** | Gnat | A fast high flutter (4.5 kHz AM at 28 Hz); no lead time, only a trajectory cue | Small trail |
| Fire | any | Enemy's own gun burst; positioned and lowpassed by distance | Muzzle flash, brief tracer toward the player |

Distinguish tell from reward: tells are **sweeps and clicks with a harmonic, aggressive timbre** (sawtooth/triangle, detuned, movement in pitch), rewards are **steady sines with sparkle**. They also occupy different spatial roles: tells come from the enemy's world position (stereo pan and a 3D panner), while hit and kill cues are centred "interface" sounds (no panning). So a player can separate "something is about to happen over there" from "I did something".

The laser tell is the single most effective peripheral/foveal cue; it ends exactly when the enemy fires (the visual does not run past the shot), so it can never mislead.

### 8.3 Spatial audio

- Use the Web Audio `PannerNode` (equalpower, or HRTF at high quality) for enemy-origin sounds, with distance rolloff tuned to the map scale: reference distance 8 m, max 45 m (mechanics-spec 5.2 distance mix), `rolloffFactor` 1.0. HRTF is gated by the quality preset (it costs CPU).
- Direction accuracy matters more than realism: below 45 m the stereo image must correctly place sources left/right/behind. A subtle high-shelf cut (-6 dB at 6 kHz) for sources behind the player gives front/back cues cheaply (COMMON).
- Enemy tells have a priority: they are never ducked by hit cues, and they duck the ambient bed by 3 dB while active.

## 9. Damage-taken cues

Events: `playerHit { amount, fromYaw, fromPos, zone }`, health. Tagging (movement slow on hit, mechanics-spec 4.3: 72.5% slow with a 0.1 s ramp and 0.5 s release) is a gameplay effect; the cues explain it.

- **Damage arc** (visual): a 90 degree arc segment on a ring around the crosshair, pointing toward the source, 350 ms, fading; opacity scales with damage up to a cap. Because it is relative to the view, the player learns where the enemy is. Pooled, not DOM per hit (one arc element per quadrant, class toggle).
- **Edge vignette** (visual): a red-orange screen-edge pulse, 160 ms, max 35% opacity; the post-process version (#44) adds a gentle chromatic aberration pulse (cheap; off at low quality).
- **Hit sound**: a low "thud" (noise through a 220 Hz band, 60 ms, -3 dB) plus a short ear-ringing-free tonal "ow" (a 420 Hz saw, 40 ms, falling 20%). Played centred, no pan; the arc carries direction. Quieter than a kill reward by 6 dB so damage never overpowers the player's own successes (principle 7).
- **Low health**: below 30% health, a slow heartbeat low-thump at 1.2 Hz (single oscillator, 70 Hz) and a gentle desaturation; fades in over 0.4 s. It is never above 6 dB under the fire sound.
- **Tagging cue**: the player's own footstep and view bob damp while slowed (the sim already moves the player slower; the cue is the camera and footstep rate following the speed, not a separate sound).
- Camera flinch (mechanics-spec 4.4): head hit 2.0 degrees, body 0.6, leg 0.3, recovering over 0.25 s, scaled by a "flinch strength" setting. Always user-adjustable and default modest, because involuntary camera motion is a comfort and fairness issue.

## 10. UI sounds

Short, soft, low in the 2.5 to 9 kHz band so they never resemble hit cues: menu hover (a 40 ms 1.2 kHz tick at -24 dB), confirm (two ticks, 1.2 then 1.6 kHz, 70 ms), back (a single falling tick). They never play in-run. No UI sound resembles a kill or a headshot, so a menu click can never be mistaken for a result.

## 11. Learn-in-a-minute: the one-minute onboarding script

First run (Cold Start, about 60 s), with no tutorial text before the first interaction:

| Time | What happens | What the player learns |
|---|---|---|
| 0 to 5 s | First enemy appears close, standing, centred; the player fires (the gun sound plays) | Click shoots |
| 5 to 12 s | First hit on the body: tonal "tock" plus marker X | "This sound is I hit" |
| 12 to 20 s | Second enemy slightly higher, a headshot is natural: bright ping plus ring plus amber marker | "Higher and brighter is better" |
| 20 to 30 s | A kill: rising two-note plus shatter plus cyan marker | "This is the best sound; enemy is gone" |
| 30 to 45 s | Two enemies in quick succession: kill cue steps up the ladder | "Chain makes it climb" |
| 45 to 60 s | One enemy telegraphs: charge sweep plus laser tell, then fires; the player can pre-react because the first tell is generous (0.8 s) | "Rising scary sweep means get ready" |

After the first run, show a single 8-second text card per family only if the player failed to respond to it (for example, took damage from a tell without turning toward it). The card names the sound and plays it. The game never has a mandatory tutorial screen.

### 11.1 How to verify it (acceptance test, headless and human)

- **Automated (pure logic, in `feedback/` tests):** `killLadderStep` returns strictly increasing roots; cue definitions are data with no two families sharing a base partial within a minor third; every cue has a visual counterpart row in the table; tell lead-time function is monotone non-increasing in skill and clamped to the 0.28 s floor.
- **Offline render check:** an `OfflineAudioContext` renders each cue and a script asserts peak level, duration <= the table value, no clipping, and spectral centroid ordering `leg < body < head < kill` (cheap, runs in a second, not in the unit suite because Web Audio is not available in Node).
- **Browser playtest (headless Chromium with the debug hook):** step scripted shots (`__flickline.step`) and capture the HUD at the frame the marker is at peak; confirm each variant is visually distinct (body X, head ring, kill +).
- **Human check:** ABX-style test with five people on cheap headphones and on laptop speakers: after one 60 s run, they must correctly classify body/head/kill/tell from audio alone at least 90% of the time. Recorded in the playtest issue (#29).

## 12. Accessibility

- **Colour:** every colour cue has a shape or motion alternative (section 4.1). Provide three cue palettes: default (white, amber, cyan, orange-red), high-contrast (white, yellow, white-outlined, red-outlined), and colour-vision-safe (blue and orange only, avoiding red/green pairs). Colours are CSS tokens (`--cue-hit`, `--cue-head`, `--cue-kill`, `--cue-dmg`, `--cue-tell`).
- **Hearing:** captions are not needed for the game to be playable because every sound has a visual; add an optional "visual-only tells" setting that strengthens the laser tell and a directional edge indicator for enemy fire. Subtitles for medal names only.
- **Mono and one-ear play:** pan is an enhancement, never the only direction carrier; the damage arc and the enemy world position are visible.
- **Reduced motion and photosensitivity:** a "reduced effects" setting removes screen shake, chromatic pulse, and flinch, shortens markers to a fade, and caps flash rate: no more than 3 flashes per second, never a full-screen flash above 10% luminance change (WCAG 2.3.1 style limits, COMMON). The edge vignette is exempt only below 160 ms and 25% opacity.
- **Volume sets:** independent sliders for hit cues, tells, damage, ambient, UI, plus master (settings #42). Defaults are the tested mix.

## 13. Implementation mapping

How this spec lands on the architecture (issue #54) without changing it.

| Piece | Where | Notes |
|---|---|---|
| Cue definitions (frequencies, durations, levels, colours) | `config/audio.ts`, `config/feedback.ts` | Pure data tunables; no inline numbers (architecture 5.3) |
| `killLadderStep`, `tellLeadTime`, `shouldPlayBodyHit` (throttle), `nearMissFlag` | `feedback/cues.ts` + `cues.test.ts` | Pure, deterministic, tested; no DOM/Web Audio |
| New sim events | `sim/types.ts`: add zone to `targetHit`, `enemyTell`, `enemyFired`, `playerHit`, `shotMoving`/near-miss flag on `shotImpact` | Sim emits facts; presentation decides what they mean |
| Sound engine | `audio/audioEngine.ts` gains a small scheduler on the audio clock and a cue renderer; `audio/sfx.ts` stays the event map | Pre-rendered buffers or per-hit 1 to 3 nodes; no allocation of buffers per hit |
| Hit marker, damage arc, popups | `hud/hud.ts` (DOM, class toggles from events) | No per-frame DOM writes |
| Shatter, impacts, tracers, laser tell | `render/effects.ts` pooled pools | Fixed capacity; skip when full |
| Edge vignette, chromatic pulse | `render/post.ts` | Switchable off by quality preset |
| Settings (cue volumes, palette, reduced effects) | `settings/settings.ts` + `ui` | New fields with clamps |

Cost: a cue plays in under 0.2 ms of main-thread time (two oscillators or one buffer source), pooled DOM markers use compositor-only properties (transform, opacity), and no cue touches the sim. Voice limit: 24 concurrent voices, oldest hit-body cue dropped first; kill and tell cues are never dropped.

### 13.1 Mismatches noted against #54

- `playKill` in the scaffold schedules its second note with `setTimeout`; the spec requires scheduling on the audio clock (`ctx.currentTime`) to avoid drift under load. Structure-wise this is a body change inside `AudioEngine`, within the architecture's "replace the bodies of the `play*` methods" rule, so no structural conflict.
- `targetHit` has no zone today (sphere targets); the cue set depends on `zone` from the humanoid hit-zone work (#15). Until then, all hits are `body`. No action beyond what #15 already plans.
- Enemy events (`enemyTell`, `enemyFired`, `playerHit`) do not exist; they are additions to `SimEvents` as architecture 5.2 prescribes (add event type + subscriber file).

## 14. Open questions and defaults

| Question | Default answer | Revisit when |
|---|---|---|
| Headshot cue: ping or crunch? | Ping (tonal, bright), with a click for masking resistance | After the human ABX check in 11.1 |
| Should tells be spatialised for all quality levels? | Stereo panning at every level; HRTF at high only | After CPU profiling (#55) |
| Should kill cue vary by enemy type? | No for v1 (one cue = one meaning); the death effect varies | If players ask what they killed |
| Chain window | 2.5 s | Balance pass (#53) |
| Tell lead times | 0.55 / 0.40 / 0.28 s by skill | Human data (#12) and bot data (#28) |
| Near-miss cue on by default? | Yes, quiet | If playtest says it reads as a hit |

## 15. Summary of the language (one page)

- **Bright and tonal means I did it.** Body = short 2 kHz tock; leg = dull; head = bright ping with a click, amber ring; kill = rising fifth, cyan plus; chain = the kill climbs.
- **Noise means a near thing or a mistake.** Near-miss whiff, moving-shot slip, impact puff. Quiet.
- **Sweeps mean someone is about to hurt you.** Charge sweep plus laser tell, from the enemy's position, with a fair, shrinking lead time.
- **Low and thudding means you were hurt.** Arc points at the source; quieter than a kill.
- **Everything has a visual twin and a switch.**
