# Flickline audio

Implements design section 12 (sound) for the feedback sound set, issue #20. Every sound is synthesised from code at load: no samples, no downloads, no network requests. Recipes are data in `src/config/audio.ts`; the renderer is `src/audio/dsp.ts` + `src/audio/cues.ts`; the engine is `src/audio/audioEngine.ts`; events are wired in one place, `src/audio/sfx.ts`.

## How it works

**Rendering.** `renderSoundSet()` turns each recipe (tone and filtered-noise layers, exponential envelopes) into a mono `Float32Array`, normalised to the cue's peak target, once, when the audio context is created on the first user gesture (the Play click). The arrays are copied into `AudioBuffer`s. The synthesis is plain TypeScript rather than an `OfflineAudioContext` so the exact buffers the game plays are rendered and measured in Vitest (Node has no Web Audio); that is what makes the peak and spectrum tests run in CI. Rendering is synchronous and seeded, so output is deterministic. Measured: 29 buffers, 3.3 s of audio, no network requests. Render time in headless Chromium (software GL, a shared machine at a load average of 60 to 70 on 8 cores, so every number is inflated by roughly 8x contention): best of 12 renders 12.7 ms, typical warm 16 to 30 ms, first call at page load 50 to 200 ms depending on what else was running. The unit test asserts < 150 ms for a warm render in Node. The engine records its own render time (`__flickline.audio().stats.renderMs`).

**Graph.**

```
voice (BufferSource -> Gain -> [HRTF Panner]) -> bus.volume -> bus.duck -> master gain -> soft limiter -> destination
buses: weapons, hits, enemies, ui
```

* Bus volumes and the master volume come from settings (`volume`, `weaponsVolume`, `hitsVolume`, `enemiesVolume`, `uiVolume`, each 0..1) and are applied on `settingsChanged`.
* **Ducking:** every hit, kill and sparkle cue dips the `weapons` bus by 3 dB for 80 ms (2 ms attack, 40 ms linear release). Verified on the real graph: shot alone -15.14 dBFS, shot with a hit playing (hits bus muted so only the ducked weapon is measured) -18.14 dBFS.
* **Limiter:** a static soft limiter (WaveShaper): identity up to -3 dBFS, tanh shoulder above, never exceeds -0.01 dBFS. It adds no latency. The first attempt used a `DynamicsCompressorNode`; in Chromium it delays the signal by about 6 ms and attenuated short transients by 13 to 16 dB, so it was replaced. Everything-at-once pile-up (8 cues) peaks at -1.6 dBFS.
* **Positional voices:** `play(cue, { position })` routes the voice through an HRTF `PannerNode` (inverse distance model). The listener pose is set once per frame from the player's head (`setListener`, skipped when unchanged). Only the miss cue is positional today (at the impact point); enemy cues (#41) will use the same path.
* **No per-frame cost:** nothing is rendered or allocated per frame. A `play()` creates one source and one gain node (plus a panner for positional voices); the debug play log is a preallocated ring.
* **Voice limit:** 24. Beyond that, low-priority cues are dropped; headshot, kill and streak-break are never dropped.

## API

```ts
engine.play(cueId, { pitchStep?, position?, gain? })
```

* `pitchStep` is the kill ladder step (the clean streak), clamped to 1..8, so the ladder caps at step 8. Only `kill` and `killSparkle` use it.
* `position` is a world position in metres (HRTF voice). `gain` is an extra linear gain.
* Shot cues (`shotPace`, `shotKestrel`) get +/-3% random pitch (playback rate) and +/-3% gain per shot from a seeded audio-side generator (never the sim RNG, so determinism is untouched).
* Before the first user gesture the context does not exist and `play()` is a no-op.

## Event wiring (`attachSfx`)

| Event | Cue |
|---|---|
| `shotFired` | weapon shot by `weapon` id (`pace` -> `shotPace`, `kestrel` -> `shotKestrel`, anything else or absent -> Kestrel); plus `movingShot` when `moving` is true |
| `shotImpact` with `onTarget: false` | `miss` at the impact point (positional) |
| `targetHit` | `hitBody` (zone `body`), `hitLeg` (`leg`), `hitHead` (`head`) |
| `targetKilled` | `kill` at ladder step = current clean streak (min 1, cap 8); `killSparkle` at the same step when `zone` is `head` |
| `streakUpdated` | tracks the streak; a streak of 2 or more falling to 0 plays `streakBreak` |

`streakUpdated { streak, mult }` is a typed contract in `src/feedback/events.ts` (design 14.3); its producer lands with the run/feedback work (#13, #40). The producer must emit it before presentation handles the `targetKilled` it belongs to; subscribing the producer to the bus before `attachSfx` does that. `shotFired.moving` and the `zone` of `targetHit`/`targetKilled` are emitted by the sim; `shotFired.weapon` is an optional addition until the weapon work (#14) sets it; absent means the default weapon (Kestrel).

UI ticks: `src/audio/uiSounds.ts` plays `uiTick` for a click on any menu button and `uiConfirm` for the primary Play button (one delegated listener).

## Mix targets (peak dBFS of the rendered cue at unity bus gain)

Design section 12: hits peak around -12 dBFS, weapons around -15 dBFS. Levels for cues the design describes only in words are noted as chosen.

| Cue | Target | Rationale |
|---|---|---|
| shots | -15 | design |
| body thock, headshot, kill chime | -12 | design |
| leg thock | -18 | design: 6 dB quieter than the body thock |
| kill sparkle | -18 | chosen: a top layer under the chime |
| miss pfft | -26 | design: "low gain" |
| moving-shot tock | -20 | chosen: audible under the shot, clearly lower than a hit |
| streak break | -22 | design: "quiet" |
| UI ticks | -24 / -22 | chosen: soft, never near hit levels |
| jump / land / footstep | -30 / -24 / -32 | scaffold placeholders carried over; #41 replaces them |

A unit test renders the set and checks every cue (every ladder step) is within 1 dB of its target.

## The cues

Each image: waveform on top, spectrogram (0 to 8 kHz, 250 ms wide) below. Regenerate with `npm run audio:snapshot` (writes `docs/audio/*.png` and prints the metrics table).

| Cue | Description | Metrics |
|---|---|---|
| `shotPace` | Pace: high and dry. 2 ms high-passed noise transient, a 520 -> 210 Hz triangle body over 70 ms, and a short band-passed noise tail sweeping 3.6 -> 2.2 kHz. 82 ms. | ![](audio/shotPace.png) |
| `shotKestrel` | Kestrel: mid and punchy. 2 ms transient, a 230 -> 84 Hz sine body (110 ms) with a 460 -> 170 Hz triangle snap, and a low-passed noise tail. 152 ms. | ![](audio/shotKestrel.png) |
| `hitBody` | Thock: 60 ms sine drop 260 -> 150 Hz with its second harmonic (520 -> 300 Hz) at -6 dB, and a 3 ms 3 kHz click (a sine burst) peaking about -20 dBFS (research #52 R2/R3). The click is the short blip at 3 kHz in the spectrogram. | ![](audio/hitBody.png) |
| `hitLeg` | Weaker than the body in three ways at once (#52 R1): the thock 3 semitones lower (219 -> 126 Hz), 6 dB quieter, 35 ms instead of 60, and no click. | ![](audio/hitLeg.png) |
| `hitHead` | The thock plus the tink: two detuned triangles at 3.00 kHz and 3.03 kHz, 120 ms (#52 R4). The bright line in the spectrogram is the tink, far above the kill ladder's top step (1.1 kHz). | ![](audio/hitHead.png) |
| `kill` | Chime on a pentatonic ladder: a 200 ms sine note with a slightly detuned twin (x1.005) for a bell-like shimmer. 8 steps from 440 Hz (A4) at semitones 0, 2, 4, 7, 9, 12, 14, 16, so the top step is 1109 Hz, far below the 3 kHz tink. See the ladder image below. | ![](audio/kill.png) |
| `killSparkle` | Headshot-kill top layer: two detuned triangles an octave above the step note, 90 ms. | ![](audio/killSparkle.png) |
| `miss` | 20 ms band-passed noise "pfft" sweeping 2.3 -> 1.4 kHz, quiet, positional at the impact point. | ![](audio/miss.png) |
| `movingShot` | Flat, low, dull "tock": 150 Hz triangle, 70 ms, a soft click, no pitch movement and no ladder. | ![](audio/movingShot.png) |
| `streakBreak` | Falling minor third (880 -> 740 Hz), 2 x 75 ms sines, soft. | ![](audio/streakBreak.png) |
| `uiTick` | 40 ms, 1.2 kHz sine tick. | ![](audio/uiTick.png) |
| `uiConfirm` | Two ticks, 1.2 then 1.6 kHz, 80 ms. | ![](audio/uiConfirm.png) |
| `jump`, `land`, `footstep` | Low-passed noise puffs carried over from the scaffold. #41 owns the real set. | ![](audio/jump.png) ![](audio/land.png) ![](audio/footstep.png) |

The kill ladder, steps 1 to 8 (250 ms apart), 0 to 8 kHz:

![kill ladder](audio/killLadder.png)

Measured (48 kHz):

| cue | bus | length | peak | centroid | dominant | energy > 1.5 kHz |
|---|---|---|---|---|---|---|
| `shotPace` | weapons | 82 ms | -15.0 dBFS | 920 Hz | 398 Hz | 11.0 % |
| `shotKestrel` | weapons | 152 ms | -15.0 dBFS | 270 Hz | 164 Hz | 3.4 % |
| `hitBody` | hits | 60 ms | -12.0 dBFS | 263 Hz | 211 Hz | 0.0 % |
| `hitLeg` | hits | 35 ms | -18.0 dBFS | 221 Hz | 176 Hz | 0.0 % |
| `hitHead` | hits | 120 ms | -12.0 dBFS | 2830 Hz | 3000 Hz | 89.2 % |
| `kill` (step 1) | hits | 200 ms | -12.0 dBFS | 441 Hz | 439 Hz | 0.0 % |
| `killSparkle` (step 1) | hits | 90 ms | -18.0 dBFS | 897 Hz | 885 Hz | 0.6 % |
| `miss` | hits | 20 ms | -26.0 dBFS | 3842 Hz | 1805 Hz | 88.2 % |
| `movingShot` | hits | 70 ms | -20.0 dBFS | 156 Hz | 152 Hz | 0.0 % |
| `streakBreak` | hits | 150 ms | -22.0 dBFS | 744 Hz | 738 Hz | 0.0 % |
| `uiTick` | ui | 40 ms | -24.0 dBFS | 1200 Hz | 1195 Hz | 0.0 % |
| `uiConfirm` | ui | 80 ms | -22.0 dBFS | 1597 Hz | 1605 Hz | 95.4 % |

**Headshot vs body, by spectrum (the centroid test):** the body thock has 0.0% of its energy above 1.5 kHz (its 3 ms click is loud in level, about -20 dBFS, but tiny in energy) and a centroid of 263 Hz; the headshot has 89.2% above 1.5 kHz and a centroid of 2830 Hz (10x). The unit test requires the thock under 3% and the tink over 20% above 1.5 kHz, the headshot centroid at least twice the thock's, the tink dominant above 2.5 kHz and the thock's below 400 Hz. By ear the difference is a knock with a tick on it against a bright "ting" on top of the same knock.

**Cue research #52 R1-R4 (adopted in #130), each with a test in `soundSet.test.ts`:** R1 leg vs body: 3 semitones lower (dominant 211 vs 176 Hz), 6 dB quieter, 35 vs 60 ms, no click (the leg has nothing in the 2.5-4 kHz band). The research's "ERB separation >= 1.5" cannot come from the fundamental alone at this pitch (3 semitones near 200 Hz is about 0.7 ERB); the separation is in the click band, where the body has the click and the leg has none. R2: about a fifth of the body thock's energy is above 250 Hz (it was about 0 at 220 -> 110 Hz). R3: the click peaks at -20 dBFS in the 2.5-4 kHz band, at least 10 dB over either weapon's peak there once the hit's 3 dB weapon duck is applied (Pace's noise tail is the closer one: 9 dB under the click before the duck, 12 dB after). The weapons' pitched bodies were not moved below 200 Hz: the click alone meets the check, and the shot sounds are a feel decision (#62). R4: thock, kill ladder (440-1109 Hz) and tink (3 kHz) are at least 3 ERB apart.

## Deviations and decisions

* **Sample-domain synthesis instead of `OfflineAudioContext`** (issue text): see "Rendering"; same intent (rendered once at load, no network), testable in CI.
* **Soft-limiter waveshaper instead of a compressor** as the master limiter: see "Graph".
* **Design 12 vs cue research (#52):** design 12 adopted R1-R4 in #130 (see "The cues" above). The research's body-hit throttling (skip body sounds within 40 ms) and moving-shot throttling are not in design 12 and are not implemented; per-shot cues play every shot.
* **Ladder root 440 Hz, not 880 Hz.** The merged cue research (`docs/research/cues.md` 3.4) found that a root above about 760 Hz puts the top ladder step above the 1.9 kHz tink, so a high kill would sound like a headshot. The ladder spans 440 to 1109 Hz and a test keeps every step below 1.5 kHz.
* **Chain chime layer, enemy tells, damage, near miss, footsteps, medal fanfare** are out of scope (#40, #41).
* **Miss "surface type"** is not varied: the sim does not emit a surface type yet (map tags arrive with #16).
