# Flickline — Game Design

Status: v1 of the design, written for the first playable and first release. Decisions are made here, not offered as menus. If a rule in this document conflicts with `docs/mechanics-spec.md` on a *number* (speeds, damage, spread, fire rate, FOV, sensitivity scale), the spec wins. If it conflicts with the "Architecture and conventions (read first)" issue (#54) on a *module boundary or event name*, that issue wins. Section numbers of the spec are cited as `spec §x.y`. Everything else here is normative.

Vision: [`docs/vision.md`](vision.md) states what Flickline is for. This design is how we currently pursue it, and every section here is checked against it.

Contents: 1 Pitch and pillars · 2 Core loop · 3 Skills and stat definitions · 4 Modes · 5 Enemies and targets · 6 Weapons · 7 Instant feedback · 8 Results and progression · 9 Skill matching · 10 Maps · 11 Look · 12 Sound · 13 Interface · 14 Technical contracts (incl. 14.7 quality tracks) · 15 Scope · 16 Identity and legal line · 17 Backlog

---

## 1. Pitch and pillars

**Pitch.** Flickline is a free browser first-person aim and movement trainer whose shooting, movement, damage and field of view are modelled on a modern tactical shooter, so everything you learn transfers. There are no rounds, teams or objectives: you press a key, a 60-second run starts, every shot answers you instantly with sight, sound and a number, and pressing the key again restarts in under a quarter of a second. The game measures you in the first minute and keeps every target at the edge of your ability, then tells you the one mechanical thing to fix next.

**Pillars, ranked.** When two pillars conflict, the higher one wins.

1. **Mechanical truth.** The gun, the body and the camera behave like the reference game's, in numbers *and* in feel, which are tracked separately (section 14.7). A drill that teaches a habit that fails in the real game is a bug. Numbers come from `docs/mechanics-spec.md`; we never "game-ify" them (no aim assist, no bullet magnetism, no slow-motion, no hit-box inflation beyond the spec).
2. **Feedback is the product.** The feedback that makes a shot feel good and informative (hit confirmation, headshot distinction, kill reward, moving-shot flag, time to shot, miss offset, sound, screen response) is product design, not polish. It is specified in section 7 and built in the first playable, not at the end.
3. **At the edge of your ability.** A new player and an expert should both be missing roughly three targets in ten within the first minute, and stay there as they improve. Difficulty is a measurement we show, not a rubber band we hide (section 9).
4. **Zero friction.** Shooting within ten seconds of opening the link; restart in under 250 ms; nothing between you and the next run that you did not ask for.
5. **Readable at 144+ fps.** Targets are the brightest, most saturated things on screen with strong silhouettes; effects are cheap and short; the frame budget (section 14) is a hard constraint on every visual.
6. **Its own identity.** Original names, shapes, sounds and interface (section 16). Polish, in the narrow sense of atmosphere that does not inform play, is last and never costs a frame or a millisecond of input latency.

**Not goals.** Teamplay, economy, abilities, narrative, monetisation, realism of ballistics beyond the reference's rules.

---

## 2. Core loop

### Second by second (inside a run)

1. A target becomes visible. Its appearance is the only timer that matters (time to shot starts here).
2. You aim and fire. The crosshair ticks and the target answers within one frame: hitmarker, sound, flash. A miss answers just as clearly (impact spark and, if the option is on, a miss-offset ghost showing where the head was).
3. A kill pays out in the same frame: shatter, pitched chime, floating points, chain/streak counters. The time to shot and time to kill of that kill float near the crosshair for 0.6 s.
4. The next target is already appearing. Gaps between targets are short and seeded-random (0.1–0.9 s by mode) so there is no dead air and no rhythm to memorise.

### Minute by minute

| Time | What happens |
|---|---|
| 0:00 | Page loads (no asset downloads; everything is procedural). |
| 0:03–0:10 | "Click to play" with a sensitivity field already filled in. First click starts the **Placement run** (section 9). First shot is fired by 0:10. |
| 0:10–0:55 | Placement run: 45 s of Orbit/Cold-Start hybrid targets that also calibrate difficulty. |
| 0:55 | Results card: first rating, tier, one thing to fix, `Enter` = next run. |
| 1:00+ | Real runs. A run is **60 s** (drills) or **up to 5:00, typically about 3:00** (Sweep, the flagship). |
| every run | Run ends, results card appears *over the frozen last frame* in under 100 ms, `Enter` (or the **Play again** button) starts the next run, `Esc` opens the menu. |

### Definitions

- **Run**: one attempt at one mode with one seed. It has three states: `ready` (0.8 s, targets not live, crosshair and movement work so you can settle), `live`, `result`.
- **Session**: one sitting, expected 15–25 minutes and 12–25 runs. Sessions are suggested but never enforced: the **Play** button starts "Today's session": the **Daily Baseline** when it is due (section 8.5), then two **Mix** runs, then one Sweep run. The player can ignore it at any time.
- **Mix run**: a 60-second run on one map with one weapon whose trials are drawn, in random order (at most two of one skill in a row), from the session's chosen skills (lowest-rated, the skill the last results card flagged, a favourite) that share that map and weapon. Each trial runs at its own skill's matched dial and counts for its own skill, as in the Placement run. A skill with fewer than 60 trials gets its own single-skill run first. Interleaving is a tested hypothesis, not a settled fact: the session's schedule is data, and the practice-schedule experiment ([#159](https://github.com/omkarbhale/flickline/issues/159)) decides between interleaved and blocked (`docs/research/transfer.md` §8).
- **Instant restart**: `Backspace` during a run, `Enter` on the results card. The world is reset from the run seed (no scene rebuild, no asset load); target: key press to first frame of the next `ready` state ≤ 250 ms on the reference rig. The previous run is saved to history before the reset.

### What makes the player start another run immediately

1. **Restart cost is zero** (see above); the results card is skippable the instant it appears.
2. **Ghost pace**: during a run a thin bar under the score shows ahead/behind your personal best at the same elapsed second. Finishing at 97% of a PB is the most reliable "one more" trigger there is.
3. **A concrete next goal**: the "one thing to fix" card ends with a one-key **Practice this (30 s)** button that launches a focused mini-run targeting exactly that weakness.
4. **Rating progress**: a bar to the next sub-tier on the results card moves every run, even bad ones, because the estimate sharpens.
5. **Variety by seed**: each run has a seed shown on the card; `Seed` entry lets you replay an identical run to beat yourself on the same layout.

Nothing in the loop rewards time spent: no XP for playing, no daily-login streak, no currency. Rewards are derived only from mechanics (section 8).

---

## 3. Skills and stat definitions

### The seven trained skills

| Skill id | Name | What it is in the reference game | Primary mode |
|---|---|---|---|
| `precision` | Precision | First bullet on the head from a stationary, settled crosshair. | Cold Start |
| `flick` | Flick | Large, fast, accurate crosshair relocation to a newly seen enemy. | Orbit |
| `track` | Tracking | Keeping the crosshair on a strafing enemy through a burst. | Strafe Track |
| `footwork` | Footwork | Counter-strafe, stop, shoot; shooting from the correct movement state (stand / crouch). | Stop & Pop |
| `spray` | Spray control | Counter-recoil during a burst and a full spray. | Spray Wall |
| `switch` | Target switching | Clearing several enemies without hesitation between kills. | Switchboard |
| `angles` | Angles | Crosshair placement at head height, pre-aim, peeking and clearing a corner without over-exposing. | Corner Clear |

Sweep trains all seven and updates all seven ratings, weighted by what actually happened in the run.

### Stat definitions (single source of truth for code and UI)

Every stat is computed from the event log (section 14), never from UI state.

- **Accuracy** = shots that hit a target zone ÷ shots fired (only in `live`).
- **Headshot rate** = head hits ÷ all hits.
- **Time to shot (TTS)** of a target = time from `targetVisible` (the first tick the target is in the view frustum and unoccluded from the eye) to the first `shotFired` that is aimed within 5° of it. It includes the aiming movement, so it is **not a reaction time** and is never called one in the UI (research #12 P1; the code identifiers still say `rtMs` until #137). Time to shot is reported per target; the run's is the **median**, not the mean. Context only, never pass/fail: about 0.25–0.35 s pre-aimed, 0.45–0.9 s for a 10–25° relocation, 0.9–1.5 s for a 60–120° flick (#12 §1.2).
- **Time to kill (TTK)** = time from the first shot fired at the target (a shot that hits it or lands within 1° of it) to its death.
- **Time on target** = fraction of `live` ticks where the aim ray is within the target's hit volume padded by 0.5° (Strafe Track's main number).
- **Moving shot** = a shot fired while the player's horizontal speed is above the accuracy deadzone from the spec (`move.deadzone_fraction`: 27.5% of the equipped weapon's run speed, 15% for the sniper; spec §2.4) or while airborne. It is flagged at the shot, not inferred later.
- **Stop latency** = time from the last movement key release (or counter-strafe key press) to horizontal speed first falling below the accuracy threshold.
- **Pre-aim error** = angle between the aim ray and the centre of the head of an enemy at the tick it becomes visible. Smaller is better.
- **Head-height discipline** = mean absolute vertical angle between the aim ray and the head-centre height (spec `hit.head_centre_stand`, 1.66 m against the 1.62 m eye) at the player's eye position, sampled while no enemy is visible, while moving. Smaller is better. On a map with elevation the reference height is the head centre of the enemy the player is facing: the nearest-to-the-view-line enemy anchor (post, gate, peek, lane end) within 30 degrees of the view direction and 3 to 45 m away, at that anchor's own floor height and distance; with none ahead, an enemy standing on the floor 10 m ahead. It is never the player's own floor or eye level.
- **Flick error** = for a flick, signed overshoot or undershoot (in degrees, along the flick axis) at the first shot relative to the target centre.
- **Spray trace** = for a burst, the ordered list of per-bullet impact offsets (in degrees, relative to the aim point at the first bullet) and the player's per-bullet mouse pull. **Ideal trace** = the same burst with the spec's recoil pattern perfectly countered (every bullet at the first bullet's offset plus only the spec's random spread). The comparison drawn is between required pull and actual pull per bullet index.
- **Clean kill** = a kill on that target with no missed shot at it and no moving shot.
- **Chain** = isolated kills within 1.5 s of the previous one; a kill made while another live enemy had the player in sight from a second angle (more than 30° away) gets no chain credit (#132). **Clean streak** = consecutive clean kills. (Two different counters; both shown.)
- **Contact** = one Sweep contact or one Corner Clear angle, from the first information either side has to every enemy dead, the player dead, or 2 s with no line of sight either way (`docs/research/fight-attribution.md` §3.1). **Health kept** = 1 − health+shield lost in the contact ÷ health+shield at its start (kill-heal does not reduce the loss).

---

## 4. Modes

Seven drills and one flagship ship in the first release. Every drill is a 60-second run (Spray Wall is five sprays or 60 s, whichever comes first). Every mode shares: the run state machine, scoring table (section 8), the difficulty dial (section 9), the event log, the results card. A mode is data plus a small scheduler; it does not own rendering, input or audio.

All modes have `ready` → `live` → `result`; weapon per mode is the default but modes allow swapping with `1`–`3` where a loadout makes sense (Sweep only).

### 4.1 Cold Start — trains `precision`  (first playable)

- **Map/weapon**: Range, Kestrel (`rifle_spray`), no reload (infinite magazine).
- **Rule**: one Post (section 5) appears at a time at a random anchor, 5–25° from the current crosshair direction (mostly small adjustments; this is a *placement and click* drill, not a flick). The first bullet fired at it decides the trial: if the target is hit in the head by that bullet it dies (shatter); a body hit makes it flash and leave; a miss makes it leave. Whatever happens, the Post leaves 0.25 s after your first bullet at it, so spraying is pointless by design. If no bullet is fired before its exposure ends it leaves and counts as a miss-by-timeout.
- **Trial** (for the skill model): success = head hit with the first bullet.
- **Pace**: 0.5–0.9 s between targets, about 45 trials per run.
- **Dial axes**: distance (head size on screen, 5 → 35 m), exposure (2.5 s → 1.05 s, Cold Start's own curve, §9.4), density fixed at 1.
- **Score**: first-bullet head kill = 100 base; the precision multiplier is the dominant term (section 8).
- **Key metrics shown**: first-shot accuracy, pre-aim error, time to shot.

### 4.2 Orbit — trains `flick`  (first playable)

- **Map/weapon**: Range, Pace (sidearm, semi-auto), movement locked, infinite magazine.
- **Rule**: one Beacon (section 5; a head-sized orb) at a time on a shell 8–25 m from the player. Each new Beacon is placed at an angular distance from the previous one between `Amin` and `Amax` set by the dial (from 20–40° at dial 0 up to 60–120° at dial 100; a rare 120–180° extreme, behind you, above dial 85 and at most 15% of trials is #136), pitch limited to −20°…+25° of horizon and biased towards head height. A Beacon has a time-to-live (exposure); one bullet that hits it kills it; if it expires the trial is a miss.
- **Trial**: success = killed before expiry. Extra data: flick error, time to shot, flick time (visible → hit).
- **Pace**: next Beacon appears 0.1 s after a kill, 0.2 s after an expiry; about 70 trials per run.
- **Dial axes**: size (Beacon scale ×3.0 → ×1.0 of real head size), angle range, exposure (2.5 s → 1.6 s, Orbit's own curve, §9.4).
- **Key metrics shown**: flick time, overshoot/undershoot bias (the single most useful flick diagnostic), accuracy.

### 4.3 Strafe Track — trains `track`  (first release)

- **Map/weapon**: Range, Kestrel. The player may move but does not need to. Strafers (section 5) do **not** shoot back in this mode.
- **Rule**: 1–3 Strafers alive at once at 10–35 m, strafing left/right with realistic stop-and-shoot rhythm: a strafe leg of 0.35–1.0 s (randomised), a counter-strafe decel of 0.16 s, a stand-still of 0.25–0.4 s, then the next leg, possibly reversed (spec §5.3). Kill them; replacements spawn 0.4 s after a kill from the edge of cover.
- **Trial**: one Strafer = one trial; success = killed within its time limit (8 s at dial 0 down to 3 s at dial 100). Strafer speeds run from 2.0 m/s (dial 0) to 5.4 m/s (dial 100), the spec's slow/fast values.
- **Dial axes**: strafe speed, direction-change interval, stop window length, distance, density.
- **Key metrics shown**: time on target, headshot rate, TTK, lead error sign (are you lagging behind or leading?).

### 4.4 Stop & Pop — trains `footwork`  (first release)

- **Map/weapon**: Lane, Kestrel.
- **Rule**: the near end of the lane is a start line; targets (Posts, one at a time) appear at the far end only while you are *moving sideways* (lateral speed ≥ 80% of the equipped run speed; the floor stripe lights up to show the lane is "armed"). Each target carries a **stance ring** on its base: white = stand still, blue = crouched and still (the spec's crouch accuracy bonus). You must kill it with your first bullet fired **in that stance and below the accuracy deadzone** (spec §2.4: 27.5% of run speed, reached about 0.10 s after the stopping input, §2.5). Firing earlier is a *moving shot*: it still fires, exactly as in the reference game (inaccurate by the spec's movement error), and the coaching cue (section 7) flags it. Walking (`Shift`) is not a valid stance because it is above the deadzone in the reference game too.
- **Trial**: success = killed with the first bullet, fired in the required stance and not a moving shot.
- **Dial axes**: exposure (2.0 s → 0.7 s; 0.5 s was under the 0.55 s minimum of reaction + accuracy gate + a small aim, #12 §4.1), distance, stance mix (dial < 30: stand only; 30–60: stand + crouch; > 60: adds a 20% chance of a "double" of two targets and requires the stop to come from a direction reversal, i.e. a true counter-strafe tap).
- **Key metrics shown**: stop latency, moving-shot count, stance correctness, accuracy while stopped versus moving.

### 4.5 Spray Wall — trains `spray`  (first release)

- **Map/weapon**: Range, Kestrel (full-auto). Fixed distances 12 / 20 / 28 m cycle each spray.
- **Rule**: five sprays per run. A Post appears (tall wall panel behind it records decals). Fire a full magazine (or the burst length the dial asks for: dial < 30: bursts of 3; 30–60: bursts of 7; > 60: full magazine) at it, reload, and the next Post appears at the next distance. The run ends after five sprays or 60 s.
- **Trial**: one spray = one trial; success = at least a dial-set fraction of bullets (60% at dial 0 → 85% at dial 100) in head or body zones.
- **Dial axes**: distance, burst length, required hit fraction. (Posts are static; the difficulty is the recoil.)
- **Key metrics shown**: per-bullet-index hit rate, spray trace vs ideal, the bullet index where the pull falls apart.

### 4.6 Switchboard — trains `switch`  (first release)

- **Map/weapon**: Range, Kestrel, infinite magazine.
- **Rule**: a wave of 3–6 Posts and Strafers appears at once spread across a 140° arc at mixed distances. Kill them all; a new wave appears 0.3 s after the last dies. At dial > 60, Gnats (section 5) join waves.
- **Trial**: one wave = one trial; success = cleared within its par time (par = 1.3 s per enemy at dial 0 down to 0.70 s per enemy at dial 100; 0.55 s was faster than the flick model allows for a 30° switch onto a dial-100 head, #12 P5).
- **Dial axes**: density, distance, speed (for Strafers), exposure (waves with a lifespan at the highest dials).
- **Key metrics shown**: switch time (kill → next first shot), overkill bullets, order efficiency (did you clear nearest-angle first).

### 4.7 Corner Clear — trains `angles`  (first release)

- **Map/weapon**: Elbow, Kestrel. Enemies shoot back; health, shield (default heavy, 50, you and the Peekers) and slow-on-hit apply (section 5).
- **Rule**: a ten-checkpoint route through the map. Reaching a checkpoint (a floor mark) arms an **angle**: 1–3 Peekers (section 5) hold it, cycling peek patterns on a short random timer. Kill them, or after 6 s they retreat and you move on. The run ends at the route's end, at 90 s, or at 0 HP.
- **Trial**: one angle = one trial; success = every Peeker killed and no damage taken. Shoulder, jiggle and hop peeks are **bait, not trials** (#12 P3): letting one pass is never a failure, and a Peeker that retreats having shown only bait peeks is not required for success, so the dial never penalises correct patience. For the skill model (#17) and the mode (#50).
- **Dial axes**: exposure (wide peek 1.4 s → 0.45 s), enemy reaction and tell length, enemy accuracy, density, distance.
- **Key metrics shown**: pre-aim error, head-height discipline, over-peek count (damage taken while you were exposed more than 0.5 s without firing), damage per angle.
- **Contact settle**: each angle settles as a contact (section 8.1): cleared, disengaged alive or died.

### 4.8 Sweep — the flagship  (first release)

Sweep is a game, not a drill: you move through a compact arena that fights back, and the pressure comes from reading the fight rather than from a timer.

- **Map/weapons**: Foundry. At the start of a run pick a primary (Kestrel or Rill) and the sidearm is always Pace. `1`/`2` swap, `R` reloads, magazines are real.
- **Rule**: the **Sweep Director** (section 9) sends a continuous stream of **contacts** from six spawn gates: a contact is one to four enemies of mixed types arriving by different routes with staggered timing. You have health (spec values) and the default heavy shield (50, as do the enemies), slow-on-hit applies, there is no passive regeneration and a spent shield does not come back. **Kills heal**: a body kill restores 5 HP, a headshot kill 10 HP (tunable), capped at maximum and never restoring shield, so playing cleanly sustains you and sloppy play drains you.
- **Surge**: chain and clean-streak progress fills a meter (never time). Only isolated kills build chains (section 3), so swinging into a crossfire never fills Surge. When full it triggers an 8-second Surge: score ×2, enemy tells are drawn brighter (more readable), the HUD frame glows. Surge changes no mechanic.
- **Run end**: 0 HP or 5:00. A typical run for a matched player lasts about 3:00.
- **Waves of intent** (director pacing, not difficulty): warm-up 0:00–0:20 at dial −8; build to the player's dial by 1:00; two *peaks* (+6 dial) around 2:00 and 4:00 each lasting 20 s; a short *breather* (−6) after each peak.
- **Scoring/rating**: standard table, including the contact settle (section 8.1): every contact pays for how it ended and the health you kept, so leaving a fight you are losing is rewarded and swinging into every fight is not. Contributes to all seven skill ratings through the trials it contains.
- **Key metrics shown**: all of the above plus damage taken per contact and the single biggest HP loss ("you lost 40 HP to Rushers while reloading").

### Mode phasing

First playable: Cold Start, Orbit, Placement run (a fixed hybrid of the two). Everything else: first release.

---

## 5. Enemies and targets

All human-shaped enemies are called **Echoes**: faceless faceted mannequins of light. The story is that you are practising against echoes of opponents; there is no other lore. All Echoes share one proportion model so that head height and body height transfer.

### 5.1 Humanoid hit zones

Hit zones follow the spec's three-zone hitbox (spec §5.1, PLACEHOLDER dimensions that the spec expects to be measured and replaced; read them from the tunables, never hard-code):

| Zone | Standing, height range | Crouched, height range | Width | Notes |
|---|---|---|---|---|
| Head | 1.52–1.80 m, sphere radius 0.14 m, centre 1.66 m (`hit.head_radius`, `hit.head_centre_stand`) | centre 1.16 m | 0.28 m | Headshot multiplier from the spec (4× rifles). |
| Body (torso, arms count as body) | 0.80–1.52 m (`hit.torso_range_stand`) | 0.55–1.02 m | 0.50 m | Body damage from the spec. |
| Legs | 0.00–0.80 m | 0.00–0.55 m | 0.46 m | Leg damage from the spec (0.85× body). |

As fractions of the 1.80 m standing height (the fallback if the spec's numbers move): head 0.84–1.00 H, body 0.44–0.84 H, legs 0–0.44 H. A standing player's eye (1.62 m) is inside the head zone, 0.04 m below the head centre, which is why head-height crosshair discipline (section 3) is measured against the head centre.

Hit detection is hitscan against these shapes in the simulation (the same shapes the renderer's silhouette is built from; the render mesh never decides hits). A **head node** (a slightly brighter emissive core inside the head, drawn *without* enlarging the hitbox) marks the head. Health is 100 HP for players and Echoes. **Shields** (spec §4.1 armour) sit on top of it **in the modes where enemies shoot back** (Corner Clear, Vigil, Sweep), for the player and for every humanoid Echo alike: a shield absorbs 66% of each hit until it has absorbed its capacity (light 25, heavy 50), the rest goes to health, so the total damage to kill is `100 + shield`. Drills have no shields (nothing shoots the player, and the bullet counts the drills train are the unarmoured ones). Orbs (Beacon) and the Gnat carry none. Reversed from the first draft's "no armour in the first release": rifle duels in the reference game are mostly fought by players who bought shields (rifles and full shields are bought together), so training only the unarmoured bullet counts would teach thresholds that fail there (vision review 1, #131).

### 5.2 Roster

| Enemy | Shape | Moves | Threat | Used in |
|---|---|---|---|---|
| **Post** | Standing Echo, idle sway only. | Stationary. | None. | Cold Start, Spray Wall, Switchboard, Stop & Pop |
| **Beacon** | Head-sized glowing orb on nothing. | Stationary. | None. | Orbit, Placement run |
| **Strafer** | Echo that mirrors a strafing player. | Strafe legs (0.35–1.0 s) → counter-strafe decel (0.16 s) → stand-still (0.25–0.4 s) → strafe, reversing on a seeded coin; speed 2.0–5.4 m/s by dial (spec §5.3). Stops are *real stops* with the spec's braking, so the stand-still is exactly the window where a player's counter-strafed shot is accurate. | In Sweep and Corner Clear it fires in its stop windows. | Strafe Track, Switchboard, Sweep |
| **Peeker** | Echo behind low or full cover. | Peek patterns: **shoulder** (exposes 40% of body, 0.3 s), **wide** (full body, 0.8–1.2 s), **jiggle** (shoulder out-in-out), **hop** (rises above low cover for 0.35 s, head and upper body only). | Fires one or two bursts during a wide peek. | Corner Clear, Sweep |
| **Rusher** | Echo with a forward-leaning stance. | Sprints at the player along nav nodes from ≥ 15 m, slows and fires from 8–12 m, then keeps closing. | Threatens in the open; forces you to leave cover or reposition. | Sweep |
| **Bulwark** | Echo with a front plate across the torso. | Walks slowly towards the player. | Fires steadily; the plate absorbs body shots from the front (sparks and a muted tick, no damage), so only the head and legs are valid. | Sweep, high dials |
| **Gnat** | Small spinning octahedron (hand-sized). | Hovers at head height and darts on a 3D curve (seeded Lissajous with random impulses), 1 bullet kills. | None; its job is vertical tracking and fast re-targeting. | Switchboard, Sweep |

All Echoes use HP, damage-per-zone, shield and bullet-count rules identical to the player's side of the spec (`health.max` 100 HP). **Unshielded**, a rifle headshot kills and three body bullets kill. **With the default heavy shield (50)** the bullet counts of spec §6 apply: a Kestrel needs four body bullets (a headshot beyond 20 m needs two), a Pace needs two headshots (not one), a Rill six body bullets.

**Economy.** The shield level is a scenario variable (`config/economy.ts`): `full` = heavy shield (50) and the rifle, `light` = light shield (25), `eco` = none and the sidearm. A scenario card carries `economy`; a mode that fires back and has no card setting uses `defaultEnemyFire` (`full`). The player and the Echoes get the same tier, as in a real full-buy or eco round. Kill-heal restores health only, never shield (section 4.8). Results and the fix engine name the difference when it mattered: "your Pace needed two headshots on an armoured target".

### 5.3 How enemies shoot back (where they do)

Only in **Corner Clear** and **Sweep** (and they never shoot in drills). The rules are designed so damage is *readable and mostly your fault*, and so slow-on-hit matters:

*Adopted from research (#130): tell and floor from #12 P5/P6 and #52 R8; aimed shots from #71 (`docs/research/player-like-enemies.md` §5.6).*

1. **Tell.** An enemy that has acquired the player begins a **tell**: its head node flares and a thin bright line flickers from its muzzle towards the player's position for `tell` seconds (0.7 s at dial 0 → 0.30 s at dial 100; **never below 0.25 s**). The floor is one mean simple reaction time (0.218 s) plus the time a strafe needs to clear the accuracy deadzone; 0.30 s is the first tell at which a typical player's strafe takes effect before the shot (#12 §5). The tell is the enemy's real aiming phase: it lasts `max(aim phase, tell floor)`, so it never adds delay to an enemy that is still aiming (#71 F5). An enemy that was **prepared** for the player (holding this spot with information, #127) does not hold fire for a tell: its tell runs from the moment it sees the player until its shot (`docs/research/prepared-holders.md`). A rising synthesised tone plays from its position (section 12). These added cues **fade as the player's dial rises** (tell cue axis, sections 9.4 and 7.4): above the fade band only the true cues remain (the enemy raising the weapon, stopping, the muzzle flash), as in the reference game. The tell's duration and its floor are unchanged.
2. **Fire.** At tell end it fires a burst of 1–3 shots at the spec's fire-rate for a sidearm/rifle archetype. Each shot is **aimed, not rolled**: a hitscan shot from the enemy's simulated crosshair through the spec's spread, recoil and movement error, with no hidden hit roll (#71). Strafing is a real defence for the same reasons as in the reference game: the player's movement takes the hit zones away from where the enemy aims, and an enemy that moves gets the spec's movement error. The dial's enemy hit chance (0.15 → 0.6 at standstill) is a **calibration target** the bot harness measures (#28, #53), not an input. A near miss draws a thin tracer past the player's head and plays a whiz from the correct side.
3. **Damage.** Per-zone damage from the spec, through the player's shield first (66% of each hit until the shield is spent, section 5.1). A hit applies the spec's **tagging** slow (spec §4.3: speed capped to 27.5% of max, 0.10 s ramp-in, held while hits continue, 0.5 s release; all four are tunables) to the player, shows the damage arc pointing at the shooter, and plays the damage cue (section 7).
4. **Reaction.** Enemy `reaction` (time from first seeing the player to starting the tell) scales 1.2 s → 0.3 s with the dial. A prepared enemy reacts on a human pre-aimed draw instead (floor 0.15 s, #127).
5. **Determinism.** Every enemy draw (reaction, aim noise, decisions) comes from a per-enemy stream seeded from the run seed, so a seeded run is replayable.

### 5.4 Behaviour implementation notes

Enemies are small finite-state machines advanced in the fixed-timestep simulation; the renderer only interpolates their transforms. Nav uses a per-map waypoint graph authored in the map file (section 10). No pathfinding library.

---

## 6. Weapons

Original names, simple roles. **All numbers (fire rate, magazine, reload and equip time, damage by range and zone, spread, recoil pattern, movement penalty, scoped zoom and sensitivity) come from `docs/mechanics-spec.md` under the archetype listed; none are invented here.** Each weapon is a data entry keyed `weapon.<id>` in the tunables table, implemented by one generic weapon simulation.

| Weapon | Spec archetype (config key) | Role | Why it exists | Phase |
|---|---|---|---|---|
| **Pace** | `pistol_accurate` | Accurate semi-auto sidearm, one-tap head up close. | Orbit flicks; Sweep sidearm; first-bullet discipline. | First playable |
| **Kestrel** | `rifle_spray` | Controllable full-auto rifle with a learnable recoil pattern. | The drill weapon: Cold Start, Strafe Track, Stop & Pop, Spray Wall, Corner Clear, Sweep. | First playable |
| **Vane** | `rifle_precise` | One-tap rifle: high damage, no falloff, punishes spraying. | Alternative primary for Cold Start and Sweep; teaches tap and burst discipline. | First release |
| **Rill** | `smg` | Close-range full-auto, fast movement, low recoil. | Sweep close-range alternative; teaches range discipline. | First release |
| **Longnail** | `sniper` | Bolt-action sniper (scoped, one-shot body kill, 15% deadzone). | Scoped flicks and holding angles. | **Later** (needs scoped sensitivity; keep out of first release) |

The spec's `pistol_light` and `pistol_heavy` archetypes are unused in the first release (they are the same role as Pace or a later heavy pistol).

Shared rules: the viewmodel never covers the crosshair or the screen centre; tracers are always drawn; magazines are real in Sweep and Spray Wall and infinite in the other drills; reloading is cancelled by weapon swap exactly as the spec says.

---

## 7. Instant feedback and rewards

Rule: every event the player causes is answered **in the same frame** with at least one visual and one sound, and every one carries a distinct *meaning*. Nothing decorative takes longer than 200 ms except text that fades. All of these are in the first playable (sections marked *FR* are first release).

### 7.1 Per event

| Event | See | Hear | Read |
|---|---|---|---|
| **Shot fired** | Muzzle flash (one frame sprite) on the viewmodel; tracer (thin bright quad, 80 ms); viewmodel recoil as the spec requires (camera recoil is the spec's; no extra camera shake). | Weapon shot, per weapon (section 12). | Ammo count ticks down. |
| **Shot fired while moving too fast** (coaching cue, toggleable, fades: section 7.4) | Tracer is **violet** (`warn`) and dashed; a small `⇆` glyph flashes under the crosshair for 0.3 s. | A dull, flat "tock" layered under the shot. | "Moving shots" counter in the stat strip increments. |
| **Miss** | Impact spark + decal at the hit point; (option, default on) a faint ghost ring where the nearest target's head was, for 0.25 s, with an offset arrow. | Short "pfft" on the impact surface. | Nothing text-based; miss data goes to the run's miss map. |
| **Body hit** | White hitmarker tick (4 short lines around the crosshair, 90 ms); target flashes white 60 ms; damage number floats up if enabled. | Low "thock". | Damage number. |
| **Leg hit** | Dimmer tick, smaller. | A shorter, quieter thock 3 semitones lower, with no click (section 12). | — |
| **Headshot (non-kill)** | **Gold** hitmarker, larger (140 ms), crosshair gap pulses once; target head node flares. | Bright "tink" over the thock. | Gold number. |
| **Kill** | Target **shatters** into 12 shards flying from the hit point and fades (400 ms); hitmarker turns into a larger burst; `+score` floats from the kill point; subtle 3-frame screen-edge pulse in the accent colour. | A rising chime whose pitch steps up the pentatonic scale with the clean streak (caps at 8 steps). Headshot kills add a sparkle top-layer. | `+score`, plus time to shot and TTK for that kill floating by the crosshair for 0.6 s ("TTS 182 ms · TTK 0.41 s", each labelled). The time to shot turns green if it beats the run median, white otherwise. |
| **Chain** (kill within 1.5 s of previous) | Counter above the crosshair: "×2", "×3", "×4", "×5+", pulsing once. | An extra layered chime step. | Chain count. |
| **Clean streak** | Streak number under the score, fills a ring around it; multiplier shown (×1.0 → ×3.0). | The chime pitch ladder above. | Multiplier. |
| **Streak break** | Ring empties with a short desaturate; no shake. | A soft falling interval (never harsh). | — |
| **Contact settled** (Sweep, Corner Clear) | `+score` under the score with one word: **Clean** (cleared untouched), **Clear** (cleared, hurt), **Reset** (left a losing fight alive). Nothing for died or left unhurt. Hidden while an enemy is visible or a tell runs. | A short soft resolve, brighter for Clean. | The settle points. |
| **Medal earned** (*FR*) | Toast at the upper centre for 1.2 s, then stored in the results card. | Short fanfare phrase (section 12). | Medal name and what earned it. |
| **Surge ready/active** (*FR*) | Frame glow, brighter tells. | Rising whoosh; sustained shimmer. | Timer. |
| **Taking damage** (Corner Clear, Sweep) | Directional red arc towards the shooter, brief screen vignette narrowing, desaturation for 150 ms, slow-on-hit applies exactly as in the spec. | Low, dry thud in the player's ear with a 300 ms low-pass dip. | HP bar flashes. |
| **Near miss against the player** | Tracer past the head. | Directional whiz. | — |
| **Run end** | Last frame freezes, results card slides in (80 ms). | One closing note, resolving the streak pitch. | Section 8. |

### 7.2 Live readouts (all toggleable; default: **minimal**)

Always on: crosshair, ammo, timer, score, multiplier, chain/streak counters, HP and shield (modes with enemy fire; the shield bar sits above the HP bar and is drawn only when the fight has one).

Stat strip (bottom-left, small, default **on** so the feedback is learnable; each item toggleable): **Acc %**, **HS %**, **Median TTS** (time to shot), **Median TTK**, **Moving shots**. A single combined "pace vs PB" bar sits under the score.

In-world: stance rings (Stop & Pop), checkpoint marks (Corner Clear), the wall decals in Spray Wall (persist for the spray, wiped before the next).

### 7.3 Rewards (mechanics-derived only)

- **Streak multiplier** (clean streak ×1.0 → ×3.0 at 20).
- **Contact settle** (Sweep, Corner Clear): pays for surviving a fight, scaled by the health kept (section 8.1).
- **Chain callouts**: `Pair` ×2, `Triple` ×3, `Quad` ×4, `Surge chain` ×5+.
- **Medals** (named in section 8) with thresholds designed to be reachable by the matched player: they are awarded relative to the dial and the run's context, not to account age.
- **Personal bests** per mode and difficulty dial band, per skill; the live ghost-pace bar compares against them.
- **Flawless** (no miss, no moving shot, full run) — gold card frame.
- **Rank progress** (section 8).

### 7.4 Fading cues: feedback that goes away as you improve

The augmented cues above (violet moving-shot tracer, `⇆`, "tock", miss ghost, damage numbers, the RT/TTK readout, and the enemy tells of section 5.3) teach what happened, but none of them exists in the reference game. A player who waits for the tell's laser before strafing, or knows they moved because they heard the tock, has built a habit that fails there (vision principle 1). Feedback on every trial also trains learners to lean on it instead of their own senses; reducing its frequency costs a little practice performance and helps retention (guidance hypothesis, Winstein and Schmidt 1990). So the answer stays instant and specific (principle 3) but **stops being constant** (issue #129; `config/cues.ts`, `adaptive/cueFade.ts`, `feedback/cueGate.ts`, `feedback/cuePlanner.ts`).

**Phase per skill.** At each run start the mode's skill (the Line rating for modes that train several) is read from the posterior (section 9.1) and put in one phase. Both gates must hold, so a lucky minute that lifts the mean but leaves a wide band does not strip the cues:

| Phase | Enters when (starting values, HYPOTHESIS) | What the player gets |
|---|---|---|
| **Every trial** | default; new players, a wide band, or a low rating | every cue of section 7.1, as designed |
| **Bandwidth** | rating ≥ dial 25 and posterior s.d. ≤ 5.5 (about one run of evidence) | a cue only on a **large error** (rules below) |
| **Summary** | rating ≥ dial 50 and posterior s.d. ≤ 3.2 (two or three runs) | no per-event coaching cue; the results card carries the pattern (moving-shot count, the one thing to fix) |

A player already in a phase stays in it until the rating falls 3 dial points below its gate or the band widens 1 point above it (hysteresis), so one on a border does not see the cues blink on and off between runs. A real decline brings the cues back, because the phase is a function of the posterior only.

**Bandwidth rules.** Moving-shot tracer, `⇆` and tock: only when the shot is at or above 3.5 m/s (the deadzone is about 1.5 m/s, a walk 2.7, a run 5.4: so only near-running shots) or airborne. Miss ghost: only when the shot passed 1.5° or more from the nearest head. Time-to-shot readout: only when slower than 1.3× or faster than 0.75× the run median (a good trial is worth saying too: feedback after good trials helps learning, Chiviacowsky and Wulf 2007). Damage numbers carry no error signal, so they stop at bandwidth; the hitmarker colour already names the zone. Rewards (chime ladder, score, streak, chain) are not coaching cues and never fade.

**Tells are a dial axis.** `axes(dial).tellCue` is 1 up to dial 35 and falls in a straight line to 0 at dial 60. It scales the **added** tell cues (head-node flare, laser line, rising tone). The windup itself, its duration and its floor are untouched, so a fight is not made unfair; what changes is that the player learns to read the real signs. Surge (first release) may bring the tells back as a reward (`FeedbackOptions.surge`).

**The clean run.** The first scored run of a session, once the player has completed three scored runs ever, has **no coaching cues at all, no added tells, and a reference-like HUD**: the stat strip, edge meter and ghost-pace bar are hidden (crosshair, timer, ammo, health and the reward counters stay). It is never the Placement run. It is spent only when it ends for real; quitting it early offers it again. Its results card says so. It is the cold-open benchmark for the transfer question (#128): a score earned the way the reference game would let you earn it.

**Settings (section 13.3).** *Coaching cues* remains the master switch (off = no cue, no added tell, always). *Fade cues as I improve* (default on) off keeps every cue at full forever. *One clean run per session* (default on).

**Settling experiment (open, tracked in its own issue).** Two groups practise Stop & Pop for a week, one with fading off and one on, then play a cues-off retention test (a clean run). If faded cues retain as well or better, fading stays the default; if not, the thresholds in `config/cues.ts` move or the default flips.

Known limits: the posterior is saved in the progress save (§14.5) after every run, so cues resume where they were; a new player starts at full cues; the enemy tell visuals and tone (#32, #41) read `tellStrength()` when they land.

---

## 8. Results and progression

### 8.1 Scoring (single table, all tunable in the `config/scoring.ts` area file)

Per kill: `score = base(enemy) × precision × speed × streak × difficulty`.

| Term | Value |
|---|---|
| `base` | Post 100, Beacon 100, Strafer 150, Peeker 200, Rusher 150, Bulwark 250, Gnat 120 |
| `precision` | ×1.5 if the killing bullet hit the head; ×1.25 if the killing bullet was the first bullet at that target; they stack to ×1.875 |
| `speed` | `1 + 0.5 × clamp((par − TTK)/par, 0, 1)` where `par` is the mode's par time for that enemy |
| `streak` | `1 + 0.1 × min(cleanStreak, 20)` (×1.0 → ×3.0) |
| `difficulty` | `2^((dial − 50)/25)`, so dial 75 = ×2 and dial 25 = ×0.5 (score is comparable across ability; adapting the dial never gives free points or takes them away) |

No negative scores: missing costs you the clean streak, the first-shot bonus and time, never points directly. Surge doubles the total.

`speed` uses TTK, which starts at the first shot, so it pays for killing efficiently once committed and never for rushing into a fight; it applies on every card, holding cards included (#132).

**Contact settle** (Sweep and Corner Clear, #132; research and settling experiment: `docs/research/survival-rewards.md`). Kills alone would pay "take every fight, fast", the over-aggression the reference game punishes; there survival is the currency. So when a contact ends (section 3) it pays once, on top of its kill points:

| Outcome | Settle |
|---|---|
| Cleared (every enemy dead, player alive) | `2 × kill × kept` |
| Disengaged alive (lost ≥ 30% of the contact's starting health+shield, then left and lived) | `1.5 × kill × kept` |
| Left unhurt, or died | 0 |

`kill` = the mean `base` of the contact's enemies × `difficulty`; `kept` = health kept (section 3). A clear always pays more than a disengage at the same health, and leaving unhurt pays nothing, so the settle cannot be farmed by peeking and leaving. A CI test (`npm run reward-experiment`) checks that this table ranks "isolate angles and disengage when losing" above "always swing", and "back off at the first hit" below both, at every dial.

### 8.2 End-of-run results card

A single screen, readable in under 5 seconds, scannable in 15:

1. **Header**: mode, run seed, score, **PB delta** (green/red), grade-free.
2. **Rating**: the mode's skill rating before → after, the run's delta ("+14"), the tier badge, a progress bar to the next sub-tier.
3. **Headline stats**: Accuracy, HS rate, median time to shot, median TTK, moving shots, and the mode's two key metrics (section 4).
4. **Medals** earned this run.
5. **One thing to fix** card (below), with the `Practice this` button.
6. **Detail** (collapsible): per-target timeline strip (each target a bar: visible → first shot → kill, colour coded), miss map (all misses plotted relative to the nearest target head, centred, so bias is obvious), **spray trace vs ideal** with the per-bullet-index pull curve (Spray Wall, Sweep), pre-aim error distribution (Corner Clear, Sweep), flick error histogram (Orbit).
7. `Enter` = **Play again**, `P` = **Practice the fix**, `Esc` = menu.

### 8.3 The one thing to fix

A deterministic rules engine (no model needed) picks one weakness per run:

1. Compute 12 candidate diagnostics with an *estimated points lost* for each, from the run's own events and the player's skill profile:
   moving shots (hit rate stopped vs moving); late shot (time to shot above the player's rating-baseline); flick overshoot or undershoot bias; head-height discipline (aim vertical bias); pre-aim error; spray collapse (the bullet index where per-bullet hit rate drops below 50%); tracking lag or lead; switch hesitation (kill → first shot gap); over-peek damage; overkill bullets; reload in the open; accuracy drop after a streak break (tilt).
2. Rank by estimated points lost; take the top one, show **one sentence of evidence** and **one sentence of what to do**, and attach a 30-second focused drill (a mini-run of the relevant mode with that skill's axes forced to the player's dial).
   Example: *"22% of your shots were fired while moving; those hit 31% of the time vs 74% when stopped. Tap the opposite strafe key and fire only once your speed has dropped (about 0.1 s)."* → **Practice this (Stop & Pop, 30 s)**.
3. Two secondary findings are collapsed under it. Rules and copy live in data so they can be improved without code.

### 8.4 Progression

Progress is **rating**, **tiers**, **medals** and **personal bests** for practice, and the **Daily Baseline** (section 8.5) for learning; time played earns nothing.

- **Rating**: each of the seven skills has a rating 0–3000 (dial × 30). The **Line Rating** shown on the profile is their mean (equal weights, tunable).
- **Tiers** (dial bands): **Chalk** 0–14, **Brass** 14–28, **Steel** 28–42, **Cobalt** 42–58, **Neon** 58–72, **Prism** 72–86, **Zenith** 86–100. Each tier except Zenith has divisions I–III (thirds of the band). Zenith shows the number only. Ranks go up *and down*: no permanent promotion, only a demotion buffer (a tier changes only after the estimate stays across the boundary for two consecutive runs).
- **Medals** (awarded in-run, listed on the card):

| Medal | Criterion |
|---|---|
| **Needle** | 5 headshots in a row (consecutive hits, first bullets). |
| **Cold Open** | 5 first-bullet kills in a row. |
| **Planted** | 10 kills with no moving shot (Stop & Pop: 10 stance-correct). |
| **Hairline** | Headshot within 0.15° of head centre (Cold Start/Orbit). |
| **Metronome** | 6 kills whose intervals are within ±12% of each other. |
| **Pendulum** | ≥ 85% time on target for 4 s (Strafe Track). |
| **Thread** | A full spray where every bullet after the 3rd lands within the body-or-head zone (Spray Wall). |
| **Quick Study** | Median time to shot lower than your 20-run median by 10% (once per run). |
| **Clean Corner** | 5 angles cleared with no damage (Corner Clear, Sweep). |
| **Untouched** | A Sweep contact of 3+ enemies cleared without taking damage. |
| **Flawless** | A run with no miss and no moving shot. |
| **Ascent** | Rank up to a new sub-tier. |
| **Retained** | A Daily Baseline whose trend reports "Improved" (section 8.5); at most once per 7 days. |

- **Personal bests**: per mode, per dial band (bands: Chalk/Brass, Steel/Cobalt, Neon, Prism/Zenith, so a PB at an easier band doesn't hide a harder band's), stored with seed, date, score, stats. The live ghost-pace bar uses the PB for your current band.
- **Persistence**: all progress lives in `localStorage` as one versioned save object with a manual export/import JSON file. No accounts, no telemetry.
- **Ratings and tiers are practice performance**: they say where the targets are set and they move within a session. Whether the player *learned* is the Daily Baseline's job (section 8.5).

### 8.5 The Daily Baseline: learning, not warm-up

Ratings are measured inside a session, after warm-up, on an adaptive dial, so they climb within an evening whether or not anything was learned. The progress claim therefore comes from one cold, fixed measurement a day. Full rules, evidence and hypotheses: `docs/research/transfer.md` §5.

- **When**: the first run after at least 8 hours without a finished run is the Baseline (the Play button's first run; skippable like any run). Only the first Baseline of a calendar day enters the trend. After the run, one optional key answers "Aimed in any game in the last hour?"; a yes marks it **warm** and keeps it out of the trend.
- **What** (version 1): 40 trials on the Range with the Kestrel, 20 Orbit-style (`flick`) and 20 Cold-Start-style (`precision`), alternating, at the player's **Baseline level** per skill (dial 15, 30, 45, 60, 75 or 90, moved only after 3 of 5 Baselines above 85% or below 35% success). Each level has a fixed, stored item set; the run's seed only shuffles the order and mirrors items, so every Baseline is equally hard and none can be memorised. No adaptation inside the run.
- **How it looks**: reference-like. Only the shot, the target's reaction and the hit and kill sounds; no coaching cues, numbers, stat strip, ghost pace or edge meter during the run. The results card shows everything afterwards.
- **The number**: per skill, an estimate from that run's trials alone (flat prior, `s = 9`), independent of the matched posterior; the Baseline score is their mean on the rating scale. One Baseline is good to about ±3 dial points.
- **The verdict**: the mean of the last `k` valid Baselines against the `k` before (`k` up to 7, at least 3), with a noise band from the player's own day-to-day spread. "**Improved**" only beyond the band, otherwise "**Steady**" or "**Lower**". It is the headline of the profile (section 9.5) and earns the Retained medal.
- **Reference check-in** (optional, weekly, local only): the player types their reference-game shooting-test scores and 20-match headshot % (`docs/research/transfer.md` §6); the profile shows them beside the Baseline trend and claims nothing about the relationship. Nothing is ever sent anywhere.
- Each change to the Baseline's content is a new version and a new series. Built in [#150](https://github.com/omkarbhale/flickline/issues/150), [#151](https://github.com/omkarbhale/flickline/issues/151), [#153](https://github.com/omkarbhale/flickline/issues/153) and [#154](https://github.com/omkarbhale/flickline/issues/154).

---

## 9. Skill matching

### 9.1 The model

Each skill has a latent ability `θ` on the same 0–100 **dial** scale as difficulty (rating = 30 × dial). Every target engagement in a mode is an **item** with a difficulty `d` that is a function of the dial settings in force when it spawned. The probability that a player at ability `θ` succeeds on an item of difficulty `d` is `p = σ((θ − d)/s)` with `s = 9` (tunable). We keep a **grid posterior** over θ ∈ {0, 0.5, …, 100} (201 points; a few hundred multiplies per update, irrelevant to performance), updated after every trial with the logistic likelihood. The rating shown is the posterior mean; the posterior standard deviation is the **confidence**, shown as a band.

An item's **trial type** is one of its properties, next to its difficulty: *pre-aimed* (the crosshair is already within about 2° of where the target appears) or *must-flick* (the crosshair has to move). Their feasible times differ, so the model never compares a pre-aimed 0.45 s trial with a 135° flick as the same kind of item (#12 P4). How the type enters the likelihood (a difficulty offset or its own scale) is for the skill model (#17) and the mode framework (#22); bait peeks (§4.7) are not items at all (#12 P3).

### 9.2 The first minute: the probe

Priors: a one-tap self-report before the first run ("New to shooters / Some / Experienced / Competitive") sets the prior mean to dial 15 / 35 / 55 / 75 (skippable → 40), standard deviation 25.

The Placement run (45 s, about 25–30 trials) uses an adaptive **staircase** on the dial: it gets harder after 2 consecutive successes and easier after 1 failure (the rule that converges on the 70.7%-success point), starting step 16, halving at each reversal (16 → 8 → 4 → 2). The estimate after the run is the posterior from all trials, with the staircase mean of the last four reversals as a sanity bound. Expected accuracy: ±6 dial points after one run; ±3 after four. Because the posterior is shared, one placement run initialises **all seven** skills with a correlation prior (a Flick estimate moves Cold Start's prior by 40%); each skill sharpens when it is first played.

### 9.3 Steady state: keeping the edge without rubber-banding

1. **Target success rate 70%**: the dial for the next stretch is `θ_est − s × ln(0.7/0.3)` ≈ `θ_est − 7.6`, chosen so the *expected* success rate is 0.70. A mode may set a different target in data: Cold Start's first-bullet-headshot trial is a harder binary event, so it targets 0.55.
2. **Difficulty is a function of the posterior and a pre-planned wave curve, never of the last few shots.** A run is divided into *beats* (every 10 s in drills; every contact in Sweep). The dial changes only at beat boundaries, by at most ±3 points per beat, and the wave curve (warm-up −8, build, peak +6, breather −6) is applied around it. A streak of misses does not make the next target easier; a streak of hits does not instantly spike difficulty. The player sees structure, not a fight against their score.
3. **Asymmetric update**: the posterior reacts faster upward than downward (likelihood scale `s` 8 for successes, 10 for failures) so a few lucky hits are not rewarded by a brutal jump, and a bad evening does not collapse the rating.
4. **No hidden handicaps**: the score table's `difficulty` factor means an easier dial does not hand out free points; the PB is per dial band.
5. **Fairness floors** (*adopted from #12 P6 and #52 R8 in #130*): tell ≥ 0.25 s; exposure ≥ 0.45 s for any timed target (the pre-aimed minimum), and per mode ≥ the minimum feasible time, reaction plus aiming movement (Orbit 1.25 s, Cold Start 0.8 s, Stop & Pop 0.55 s, #12 §4.1); exposure is measured from when the target becomes visible (`targetVisible`), never from its spawn, so an off-screen spawn does not eat the clock (the drills count from spawn today: #143); target size never below the spec's real head size; enemy reaction ≥ 0.25 s; **no target spawns (or becomes armed) closer than 4 m in any direction, and none inside the view cone (±51.5°, half the 103° FOV) closer than 5 m** (no point-blank ambush; a target behind you at 2 m is just as unreactable as one in front). The 4 m rule also binds enemies that walk closer in modes where they shoot (#32, #51). The reaction and tell floors protect the player from an enemy they **surprised**. A **prepared** holder (one that expects the player at this spot) is bound only by a 0.15 s reaction floor and never holds fire for a tell, because flooring it would let a wide swing beat a pre-aimed angle, the opposite of the reference game (#127, `docs/research/prepared-holders.md`).
6. **Pin difficulty** (setting): fixes a mode's dial to a value you choose for fair comparison and drills; matched adaptation is the default.

### 9.4 Where each difficulty axis goes

The dial 0–100 maps to the seven axes (each mode uses a subset; linear unless marked geometric ("g")):

| Axis | Dial 0 | Dial 100 | Applies to |
|---|---|---|---|
| Beacon scale (×real head) | 3.0 | 1.0 | Orbit |
| Distance (m) | 5 | 35 (g); 50 m only as a fixed-distance option, never a dial value | Humanoid modes |
| Flick angle range (°) | 20–40 | 60–120 (a rare 120–180° above dial 85 is #136) | Orbit |
| Strafe speed (m/s) | 2.0 | 5.4 | Strafer |
| Strafe leg interval (s) / stand-still window (s) | 1.0 / 0.4 | 0.35 / 0.25 (after the 0.16 s decel) | Strafer |
| Exposure, pre-aimed timed targets (s) | 3.0 (g) | 0.45 | Any timed target without its own curve |
| Exposure, Orbit (s) | 2.5 (g) | 1.6 | Orbit, Placement run (Orbit-style trials) |
| Exposure, Cold Start (s) | 2.5 (g) | 1.05 | Cold Start, Placement run (Cold-Start-style trials) |
| Exposure, Stop & Pop (s) | 2.0 (g) | 0.7 | Stop & Pop |
| Exposure, Peeker wide peek (s) | 1.4 (g) | 0.45 | Corner Clear, Sweep |
| Exposure, Gnat (s) | 1.5 | 0.6 | Switchboard, Sweep (axis added with the Gnat) |
| Enemy reaction (s) / tell (s) | 1.2 / 0.7 | 0.3 / 0.30 | Sweep, Corner Clear |
| Tell cue strength (head-node flare, laser, tone; the windup is not scaled) | 1 up to dial 35 | 0 from dial 60 | Sweep, Corner Clear (section 7.4) |
| Enemy hit chance at standstill | 0.15 | 0.6 | Sweep, Corner Clear (a calibration target, §5.3) |
| Density (simultaneous targets) | 1 | 6 (step) | Switchboard, Sweep, Strafe Track |

*Adopted from research #12 (§4, P5) and #52 (R8) in #130.* Why the dial-100 values moved: a 50 m head (0.32°) sits inside the first-shot spread cone, so success there measures luck; 90–180° flicks are mostly off-screen, found by sound rather than sight, with no evidence behind them; a 0.20 s stand-still and a 0.18 s tell are shorter than mean simple reaction time (0.218 s); and one 0.45 s exposure for every target cannot cover a flick (a 135° flick onto a real-size head needs about 1.25 s). An item that no ability can pass pushes success towards zero at high dials, so the posterior saturates below the top tiers and strong players are mis-rated. Exposure therefore has one curve per mode, each about 1.3× the minimum feasible time (reaction plus aiming movement for the mode's angles and sizes, #12 §4.1). These end points are starting values; the balance pass (#53) tunes them against human data.

### 9.5 Showing the estimate to the player

- **Before a run**: the mode card shows "Matched to you: Cobalt II · dial 51", with a one-line explanation on hover: "Targets are set to ~70% hit rate for you."
- **After a run**: rating, delta, tier, progress bar (section 8.2).
- **Skill profile screen** (from the menu): headed by the **Daily Baseline trend** (section 8.5): the verdict line, the noise band, "taken X of the last 14 days", the warm-up gap (today's Baseline against today's best matched rating) and, if the player uses it, the reference check-in beside it. Below it, labelled "matched rating: where your targets are set": a seven-axis radar, each axis with tier badge, rating, a shaded confidence band, and a sparkline of the last 20 runs; the weakest axis is highlighted.
- **While playing**: a thin **edge meter** in the HUD corner shows the rolling success rate (target zone 60–80% shaded); outside the zone it just shows the number. It is purely informational.

### 9.6 Verification

A pure module with unit tests and a simulated-player harness (backlog): simulated players of known ability must converge to within ±6 dial points inside a 45-second placement run and keep a success rate within 60–80% over a 10-minute session at stable ability, with no oscillation larger than ±4 dial points. This runs in CI in seconds.

---

## 10. Maps

Compact, original arenas. Distances are chosen from what actually happens in the reference genre: most duels at 5–25 m, long angles to about 35–45 m, doorways about 2 m wide, lanes 3–6 m wide. Heights come from the spec's body numbers (standing 1.80 m, crouched 1.30 m): **low cover** ≈ 1.0 m (hides a crouched player), **half cover** ≈ 1.3 m (head and shoulders show on a standing player only if they lean), **full cover** ≥ 2.0 m (hides a standing player).

### 10.1 First-release maps (4)

| Map | Footprint | Purpose | Features |
|---|---|---|---|
| **Range** | 54 × 24 m hall, 8 m ceiling (long enough for the spec's 5, 10, 20, 30, 50 m target positions) | Cold Start, Orbit, Strafe Track, Switchboard, Spray Wall, Placement run. | Open floor, three free-standing pillars as anchor points, distance ticks on the floor every 5 m, an alcove wall for Spray Wall at 12, 20, 28 m. |
| **Lane** | 6 × 30 m corridor | Stop & Pop. | Five alternating half-wall stops, a start line, an "armed" floor stripe, a far-end target alcove. |
| **Elbow** | 26 × 26 m | Corner Clear. | L-shaped corridors, three doorways, crate stacks at low/half/full heights, ten checkpoints with a mix of close (5–8 m), mid (12–16 m) and long (22–26 m) angles, six peek spots with defined peek types. |
| **Foundry** | 38 × 34 m, 9 m ceiling | Sweep. | Three lanes (long flank, mid courtyard with pillars, short flank), a 3 m high catwalk, six enemy gates, sightlines 8–22 m typical, 32 m max, cover at all three heights. |

First playable: Range only (an upgraded version of the foundation's flat test room).
Later: **Stack** (a container yard for Sweep variety), more Elbow-style maps.

### 10.2 Maps as data

Maps extend the foundation's `LevelDef` (`src/sim/levels.ts`: `boxes`, `spawn`, `targets`). Each map is one JSON file under `src/sim/levels/` (so the lint CLI runs without a build), loaded through a typed loader into `LevelDef` plus the additions below. A schema validator and a **map lint** CLI run in CI in under two seconds (checks: all anchors inside bounds, nav graph connected, every checkpoint reachable, every `peek` anchor has a line of sight to the checkpoint it serves, no box overlaps larger than a tolerance, sightline length report). Simulation collision uses axis-aligned boxes only (no meshes) plus **ramps**: a box tagged `ramp` with `ramp: {rise: "+x"|"-x"|"+z"|"-z", lowY}` is the box cut by one sloped plane (surface from `lowY` at the low face up to the box's top at the high face). A grounded player steps up ledges and stair risers of at most `movement.stepHeight` (0.35 m), rides ramps at unchanged horizontal speed, and sticks to the ground when it falls away by no more than a step (spec 2.7); enemies use the same movement code. The map lint also checks that every ramp is no steeper than `movement.maxWalkableSlopeDeg`, that its low end meets a walkable floor, that nav edges are walkable over stairs and ramps, and that every raised or sunken anchor, nav node, checkpoint and lane end is reachable on foot from the spawn (stairs: stack one box per step rather than nesting slabs, so boxes do not overlap). The renderer builds instanced meshes from the same boxes plus trim (a ramp is a wedge).

```ts
// Sketch. The architecture issue's types win on naming; the structure stays.
interface MapDef extends LevelDef {           // LevelDef already has boxes (AABB + tag), spawn, targets
  schema: 1; id: string; name: string;
  bounds: { min: Vec3; max: Vec3 };
  anchors: Anchor[];     // where modes may place things; typed
  nav: { nodes: { id: string; pos: Vec3 }[]; edges: [string, string][] };
  lanes?: { id: string; start: Vec3; end: Vec3; width: number }[];
  checkpoints?: { id: string; pos: Vec3; angleAnchors: string[] }[];
  look: { sky: string; fog: [number, number]; palette: string };
}
// BoxDef.tag: 'floor'|'wall'|'cover'|'trim'|'glass'
type Anchor =
  | { id: string; kind: 'post'; pos: Vec3; yaw: number; stance?: 'stand'|'crouch' }
  | { id: string; kind: 'beacon-shell'; centre: Vec3; rMin: number; rMax: number }
  | { id: string; kind: 'strafe-lane'; a: Vec3; b: Vec3 }
  | { id: string; kind: 'peek'; cover: string; hold: Vec3; out: Vec3; pattern: 'shoulder'|'wide'|'jiggle'|'hop' }
  | { id: string; kind: 'gate'; pos: Vec3; yaw: number }      // enemy spawn
  | { id: string; kind: 'drone-volume'; min: Vec3; max: Vec3 };
```

Coordinates are metres, Y up. The mode scheduler picks anchors by tag and distance band; nothing else in the code knows a map's contents.

---

## 11. Look

**Direction: "Lightline."** Dark, cool, low-detail environments drawn with thin bright **lines of light** along edges (the name), and warm, saturated, luminous Echoes that are always the highest-contrast thing on screen. It should look like a clean, glowing training facility at night, and be nearly free to render.

- **Environment**: flat-shaded boxes with vertex-colour gradients (darker at the floor edge, lighter high up); emissive trim lines along box edges (a screen-space-thin bright edge via geometry, not post); a procedural, derivative-antialiased grid floor with 5 m distance ticks; distance fog to the background colour; a gradient sky with a faint horizon glow. One directional light, **no real-time shadows** (a soft blob decal under each Echo and each pillar). No normal maps, no textures: all procedural, so zero asset downloads.
- **Palette tokens** (defined once in a shared `palette` module): `ink #0B0D14` (background), `slate #151A26`, `steel #26304A` (cover), `trim #38E8FF` (accent and UI), `ember #FF7A4D` (default Echo; was #FF5A36, which cannot reach 7:1 against any surface, even pure black gives 6.77:1; see `src/config/palette.ts`), `core #FFF1D6` (head node), `gold #FFD23F` (headshot), `ok #5BF2A5`, `warn #B58CFF` (moving shot; violet, was amber #FFB020, which is nearly identical to gold under deuteranopia: delta E 7.9, #52 R15), `alert #FF3D5A` (damage). All pairs meet at least 4.5:1 contrast for text/hud use and Echoes meet at least 7:1 against every rendered environment surface (the environment is only ever darker than its palette colour, `palette.env`; thin trim and grid lines are dimmer than an Echo). Under all four colour-vision simulations (normal, protan, deutan, tritan) every Echo body stays at least 4.5:1 and every head node at least 7:1 against those surfaces, and `warn` and `gold` stay at least delta E 20 apart (#52 R13/R15, adopted in #130; `src/config/palette.test.ts` runs the check, so `docs/research/cvd_check.py` no longer has to be remembered). R13's brighter Ember (#FF8A5C) is not needed: #FF7A4D with the darkened environment already passes.
- **Echo shader** (custom `ShaderMaterial`, shared by all enemy types): unlit flat colour plus fresnel rim in the Echo colour, a brighter head node, hit flash (60 ms white), a death **dissolve/shatter** (instanced shard quads), and an outline option (inverted-hull, off at Low).
- **Enemy colour presets** (accessibility and personal visibility): Ember (default), Magenta, Lime, Amber, and "Contrast" (white with a black outline). Amber no longer shares a colour with the moving-shot cue (#52 R14 resolved by R15). Silhouette and brightness carry the information; colour is not the only cue (shape differs per type).
- **Effects**: tracers are camera-facing quad strips; impacts are instanced billboards; shards are instanced quads with a vertex shader doing the motion (no CPU per shard); hit pulse is a 3-frame screen-edge shader.
- **Post** (first release, behind the quality preset): a cheap single-pass bloom on emissive (downsample ×4, threshold on a luminance pass; no mip-chain), vignette (stronger on damage), optional 3-frame chromatic aberration on kills (off by default; **Reduce flashing** setting disables it and all pulses).
- **Quality presets**: the foundation's three presets: *Low* (post pipeline off, no outline, render-scale option), *Medium* (bloom only), *High* (bloom, vignette, outline, optional chromatic pulse, full shard count). The pipeline is off at Low so no render targets are allocated, as the architecture requires. Frame cost budget in section 14.
- **Viewmodel**: low-poly procedural gun meshes (≤ 1,500 triangles, one merged mesh and one draw call per weapon, no textures), matte dark with a single trim line; recoil, equip and reload animation is a pure function of the sim's weapon state (`render/viewmodelPose.ts`: aim offset, last shot time, equip and reload timers; no random number of its own); right-hand, left-hand and hidden settings, live. It is drawn in its own pass with its own camera and a fixed vertical FOV of 60° (`config/viewmodel.ts`), independent of the locked world FOV, so it never clips into walls and keeps its place at every aspect ratio; it stays outside a centre box of 0.2 screen half-heights in every pose (tested). The muzzle flash is a per-weapon procedural sprite drawn at the model's muzzle, and tracers start at the muzzle you see.
- **UI**: bundled open-licence fonts (Barlow for text, JetBrains Mono for numbers, both SIL OFL), rounded-rectangle panels with 1 px trim-colour borders; a wordmark drawn from the geometry of a horizontal line ending in a dot (original, SVG, no font dependency).

## 12. Sound

All audio is **synthesised with Web Audio** at load (an `OfflineAudioContext` renders short one-shot buffers once; a few cues are live). No samples, no downloads, no copied sounds. Every sound carries information, and the mix is designed around readability at the cost of "bigness".

| Cue | Design | Information |
|---|---|---|
| Shot (per weapon) | Layered: 2 ms noise transient + a pitched body (sine/triangle sweep) + short filtered-noise tail. Pace = high and dry, Kestrel = mid and punchy, Rill = tight and fast, Longnail = deep with a long tail. Each shot has ±3% random pitch/gain so spraying is not machine-gunned. | Weapon identity; fire rate. |
| Body hit | 60 ms low "thock" (sine drop from 260 → 150 Hz with its second harmonic at −6 dB, so the pitch survives laptop speakers) and a 3 ms 3 kHz click about 8 dB under it, which carries the hit above the weapon's low body. | A hit, not a kill. |
| Leg hit | The thock 3 semitones lower, 6 dB quieter, 35 ms, no click: weaker in pitch, level, length and attack at once, so it is identified alone, not only by comparison. | A low-value hit. |
| Headshot | The thock plus a bright 3.0 kHz "tink" (two detuned triangles, 120 ms). | Headshot. Learned within a minute and never confusable with body. |
| Kill | Chime on a pentatonic ladder: 8 steps from a 440 Hz root (440–1109 Hz, far below the tink); step = the clean streak, capped at step 8; headshot kills add an octave sparkle. | Kill, and streak height, without looking. |
| Miss | Surface "pfft" at the impact point, 20 ms, low gain. | A miss; the surface type. |
| Moving shot | Flat low "tock" under the shot, no pitch ladder. | "That shot was inaccurate", instantly. |
| Streak break | Falling minor third, 150 ms, quiet. | Gentle. |
| Chain | Extra chime layered a fifth above per chain step. | Multi-kill. |
| Enemy tell | Rising saw/triangle sweep from 300 → 900 Hz over the tell length, positioned at the enemy (HRTF panner). | Where the threat is and how long you have. |
| Enemy shot | Weapon cue, positioned and distance-attenuated. | Direction. |
| Near miss | Short pitched whiz, panned to the miss side. | Where the shot passed. |
| Damage taken | Low dry thud centred in the head, 300 ms low-pass dip on everything else. | You were hit. |
| Footsteps | Own: quiet filtered clicks while not counter-strafing; enemies': positioned. | Information, not ambience. |
| UI | Short ticks and chirps; run-start "ready" blip; results fanfare resolves to the root note. | Navigation. |
| Medal | 4-note phrase, 400 ms. | Reward. |

*Hit cues adopted from research #52 R1–R4 in #130: three families in separate bands at least 3 ERB apart (thock below 600 Hz plus the click, kill ladder 440–1109 Hz, tink at 3 kHz); measured in `docs/audio.md`.*

**Mix**: buses `master`, `weapons`, `hits`, `enemies`, `ui`; hit/kill cues have priority and duck weapons by 3 dB for 80 ms; a limiter on master; hits peak around −12 dBFS, weapons −15 dBFS. A very low-key generative bed (a sparse pulse that tightens with the streak) is **out of first release** to keep the mix free for information; a menu ambience is allowed.

## 13. Interface

### 13.1 HUD (default layout)

```
                       [ Timer ]  [ Score ·  ×mult ]  [ ghost-pace bar ]
                       chain  streak ring
 [stat strip:                          +  (crosshair)
  Acc 74% · HS 38% ·
  TTS 182ms · TTK 0.41s ·                       
  Moving 3]                                    [SH ▮▮▮▮▯▯▯▯ / HP ▮▮▮▮▮▮▯▯]  (modes with damage)
 [edge meter]                                  [ammo 18 / 90]
```

Everything is DOM/CSS layered over the canvas (not drawn in WebGL), animated with transforms only (no layout during play), and hideable per element.

### 13.2 Crosshair

Rendered in a dedicated lightweight overlay (CSS or one 2D canvas drawn on change only). Parameters, all with live preview in the editor and a **share code** (a short base64 string of the parameter vector, so players can paste and trade):

`color` (hex), `outline` (on/off, thickness, opacity), `inner lines` (show, length, thickness, gap, opacity), `outer lines` (same set), `centre dot` (show, size, opacity), `firing error` (the lines spread when a shot is fired while moving too fast; **off by default**, because the reference reticle does not show spread, spec §9 Q15, so the player learns the accuracy states instead of reading them off the reticle), `hit marker colour`. Four built-in presets.

### 13.3 Settings

| Group | Settings |
|---|---|
| **Sensitivity** | Entered in the **reference game's scale** (the unit and conversion constant are in the spec). Displays equivalent `cm/360` from an entered mouse DPI. Separate scoped multiplier (Longnail, later). Raw mouse input on (uses `unadjustedMovement` when supported; shows a notice if not). Invert Y off. |
| **Field of view** | **Fixed** to the reference value, displayed read-only with the reason ("matches the reference game so your muscle memory transfers"). Aspect ratio handling follows the spec (Hor+). No slider. |
| **Keys** | Fully rebindable; defaults: `WASD` move, `Shift` walk, `Ctrl` crouch, `Space` jump, `1`–`3` weapons, `R` reload, `Backspace` restart run, `Enter` next run / confirm, `Esc` menu, `Tab` hold for the stat sheet, `F11` fullscreen. |
| **Audio** | Master, weapons, hits, enemies, UI volumes; "hit sound style" (Standard, Soft); mono option; enemy tell volume. |
| **Graphics** | Preset (Low/Medium/High), render scale, FPS cap (60 / 144 / 240 / uncapped), show FPS and 1% lows, post effects, enemy outline, enemy colour preset, **Reduce flashing**, viewmodel (on/off, left/right). |
| **Gameplay** | **Coaching cues** (violet moving-shot tracer, `⇆` glyph, miss ghost; on by default for learning, off for a pure reference-like view), **Fade cues as I improve** (default on), **One clean run per session** (default on; section 7.4), show damage numbers, stat strip items, HUD scale, difficulty pin (per mode). |
| **Data** | Export/import save (JSON), reset progress (confirm), reference check-in prompt (on by default; section 8.5). |

Settings persist immediately and apply live.

### 13.4 First-run experience (target: shooting in ≤ 10 s)

1. The page opens on the Range with a Beacon floating ahead and the crosshair visible. A single panel, bottom-centre: **Sensitivity** (prefilled with a sensible default, one numeric field, "reference scale"), **Self-report** chips (New · Some · Experienced · Competitive), and **Click to play**.
2. Click enters pointer lock and starts the Placement run immediately; no countdown, no tutorial text. One floating in-world hint ("Click the orb") disappears after the first hit.
3. After 45 s: the first results card with the player's first rating. The next click is the real game.
4. Pointer lock lost (Esc, alt-tab): the pause menu opens with `Click to resume` and `Backspace` restart.
5. Everything the first-time player sees is also available to expert players one key later; there is no unskippable step.

---

## 14. Technical contracts

These exist so that workers can build in parallel. If the architecture issue names modules or events differently, adapt the names, not the intent.

### 14.1 Performance budget

- **144 fps** at 1080p on a mid-range discrete GPU at *High*, **240 fps** at *Low*; a 2020-era integrated GPU must hold **120+ fps at Low** on Range. Frame budget **6.94 ms**; sim tick **< 0.5 ms**; GPU ≤ 5.5 ms of the frame.
- ≤ 150 draw calls (the architecture's soft budget) and ≤ 200k triangles visible, one directional light, no shadow maps, ≤ 3 full-screen passes at High, ≤ 1 at Medium, none at Low.
- **Zero allocations in the frame loop** (pool shards, tracers, decals, events); verified by a heap-growth check in the perf harness.
- JS ≤ 500 kB gzip, no binary assets, time-to-interactive ≤ 2 s on broadband.
- **Low-latency input**: mouse deltas are applied to the camera every render frame (late-latching), independent of the sim tick; the sim (fixed tick from the foundation) reads the latest look direction for shots, so a shot fires exactly where the player sees the crosshair.
- Measured by the perf harness (backlog): scripted 20 s scene, reports average, 1% lows, longest frame, heap growth; fails CI only on a smoke threshold (a generous one, since CI GPUs are software), while the numbers are tracked in the perf issue.

### 14.2 Determinism and seeds

The sim is deterministic given `(seed, mode, dial, input stream)`. Run state stores the seed. Every random choice (spawns, strafe coins, enemy hit rolls, gaps) draws from a seeded RNG stream owned by the sim, never `Math.random`.

### 14.3 Event vocabulary

Emitted by the sim, consumed by HUD, audio, VFX, stats, medals, the skill model. All events carry `tick` and `t` (seconds since run start).

```
Existing foundation events (extend payloads, do not rename): shotFired, shotImpact, targetHit, targetKilled, targetRespawned, playerJumped, playerLanded, footstep

runReady { mode, seed, dial }      runStarted { }      runEnded { reason: 'timer'|'death'|'complete'|'quit' }
shotFired { shotId, weapon, origin, dir, moving: boolean, speed, airborne, spreadDeg, recoilIndex, ammo }
shotImpact { shotId, result: 'hit'|'miss', targetId?, zone?, damage?, point, distance, killed? }
targetSpawned { id, kind, pos, tags }     targetVisible { id }
targetHit { id, zone, damage, absorbed, hpLeft, shieldLeft, killed }    targetKilled { id, kind, zone, ttkMs, rtMs, firstBullet, bullets, shield, clean }
targetExpired { id }                      targetShielded { id }   (Bulwark plate hit)
enemyTell { id, durationMs }              enemyFired { id, hit: boolean, dir }
playerDamaged { amount (HP lost), absorbed, hp, shield, dir, sourceId }   playerSlowed { factor, durationMs }   playerDied { }
chainUpdated { count }                    streakUpdated { streak, mult }   surgeStarted { }  surgeEnded { }
contactSettled { contactId, outcome: 'cleared'|'disengaged'|'avoided'|'died', kept, points }
medalAwarded { id }                       skillTrial { skill, itemDifficulty, success, rtMs?, extra }
```

Event naming follows the architecture issue: camelCase past-tense facts, plain-data read-only payloads valid only during the callback, no allocation on emit. Each owner declares its event map next to its code and merges it into the open `GameEvents` interface (`core/gameEvents.ts`) with `declare module`; no shared list is edited.

The stat tracker is a pure function of this log; the HUD and the results card render from it; nothing computes accuracy in the UI.

### 14.4 Tunables

All numbers in this document that are marked tunable live in the typed `config/` files composed by `config/tunables.ts` (one file per area; a new area such as `sweep` is a new `config/<area>.ts` that exports `tunableGroups` and merges its type into `Tunables`, with no edit to a shared file). Weapon, movement, view and damage numbers are a data change that applies `docs/mechanics-spec.md` §7 (archetype ids such as `rifle_spray`). A change in the table must never require a code change.

### 14.5 Persistence

One versioned `save` object (`version`, `profile` (self-report, sensitivity), `ratings` (posterior grids per skill, compact), `bests`, `medals`, `history` (last 200 runs, summary stats only), `baselines` (every Baseline record, compact) and `baselineLevels` (section 8.5), `checkins` (reference check-ins, never sent anywhere), `settings`), stored in `localStorage` under `flickline.save.v1` (separate from the foundation's `flickline.settings.v1`) with a migration function per version and JSON export/import. As built (#38): `progress/` holds the save (`ratings`, `ranks`, `bests` per mode and dial band with a 1 s score curve for the ghost, `medals`, `history`, `plays`, `flaggedSkill`, plus empty slots for `baselines`, `baselineLevels`, `checkins`); the settings and profile keep their own keys and the export file wraps them around the save (version 2; version 1 was the first export file). Rank-ups are immediate and demotion needs two runs (`config/progress.ts`); Ascent is a new peak sub-tier.

### 14.6 Where the code lives

Aligned with the layout and layering rule in the architecture issue (#54). Pure directories import no three.js, no DOM, no `Math.random`, no wall clock.

| Part | Directory | Pure? |
|---|---|---|
| Weapon sim, enemy FSMs and hit zones, player damage and tagging, movement, map data and loader | `sim/` (+ `sim/levels/*.json`) | yes |
| Run state machine, mode framework, individual modes, sweep director | new `modes/` | yes (add to the architecture test's pure list in the same PR) |
| Stats, scoring, streaks, medals, fix engine | `feedback/` | yes |
| Skill model, dial mapping, staircase | `adaptive/` (implements and extends `DifficultyModel`) | yes |
| Save object, PBs, rank state (injected storage) | new `progress/` | yes |
| Crosshair, HUD, hit markers, callouts | `hud/` | no |
| Menus, settings, results card, profile screen | `ui/` | no |
| Echo shader, look, post, viewmodels, effects | `render/` | no |
| Synthesis and cue wiring | `audio/` | no |
| Bot harness, perf harness | `debug/` (and `scripts/`) | no |

### 14.7 Four quality tracks: numbers, feel, fun, transfer

Four different questions are asked of the game, tracked in four separate long-lived issues and judged in four different ways. They are never merged into one score, because they fail independently: the numbers can match exactly while the recoil, sounds or hit response feel different from the reference game, a game can have exact numbers and a faithful feel and still be dull, and a game can pass all three while the player's reference-game play does not move.

| Track | Question | Judged by | Tracking issue |
|---|---|---|---|
| **Numbers conformance** | Does every implemented mechanic value and measurable behaviour equal `docs/mechanics-spec.md`? | Automated first. A conformance suite and a generated conformance table, `docs/conformance.md`: one row per spec value or behaviour with the spec value and section, the implemented value, the test, and a status (match / deviation with a written reason / not implemented yet / placeholder-or-estimate flagged by the spec). Pass: every in-scope value has a row, zero unexplained mismatches. | [#61](https://github.com/omkarbhale/flickline/issues/61) |
| **Feel similarity** | Independent of the numbers, do recoil, movement, shot sounds, hit and kill sounds, hit response and timing feel like the reference game? | Looked-at and listened-to passes scored against a written checklist, `docs/feel-checklist.md`: items per area (recoil feel, movement feel, shot sounds, hit and kill sounds, hit response, timing, view), each scored 0/1/2 with evidence (frame captures, audio renders and measurements, latency numbers). Pass: a percentage of points, a floor per area, no critical zero. | [#62](https://github.com/omkarbhale/flickline/issues/62) |
| **Fun** | Is it compelling to play: does it pull you into another run, hold you at the edge of your ability, and reward good mechanics clearly? | Playtest passes following `docs/fun-criteria.md`: a fixed human question set, measured proxies (restart friction, edge-of-ability success rate, dead-air gaps, reward cadence) and an explicit verdict on whether Sweep plays like a game rather than a drill. | [#63](https://github.com/omkarbhale/flickline/issues/63) |
| **Transfer** | Does skill earned here carry over to the reference game, and does every mode teach only habits that are also right there? | `docs/transfer-checklist.md`: a habit review per mode (items scored *same* / *different but harmless* / *harmful*, harmful being a bug), the Daily Baseline's bot tests and data (section 8.5), and the transfer pilot's verdict. Pass: per phase, no open critical harmful habit and learning measured honestly; transfer itself is claimed only by a study large enough to show it. | [#149](https://github.com/omkarbhale/flickline/issues/149) |

Rules that keep the four honest:

- **Feel is judged against descriptions, never assets.** The checklist describes behaviours, relationships and timings in our own words. No reference audio, video or image is copied, recorded, ripped, embedded or used as a synthesis target (section 16). Sounds stay synthesised from code and are tuned until the checklist items pass.
- **Numbers belong to the spec, not to the feel pass.** Tuning for feel changes presentation parameters (viewmodel kick curves, hit-marker timing, synthesis parameters, flinch and tagging presentation), never a value that has a row in the conformance table. If feel can only be reached by changing such a value, that is an issue on the numbers track.
- **Conflicts are filed, not silently resolved.** Mechanical truth (pillar 1) outranks fun for everything inside the mechanics; fun outranks feel-polish for everything around the mechanics (pacing, rewards, results flow).
- **A harmful habit is a mechanical-truth defect.** A mode that rewards a habit that fails in the reference game is fixed in the mode, however fun it is; the mechanics' numbers stay the spec's.
- **Every playtest pass reports the four verdicts separately**, in four sections of its report, each also posted on its tracking issue; every defect is filed with the matching `quality:numbers`, `quality:feel`, `quality:fun` or `quality:transfer` label.
- Owners: the conformance suite [#64](https://github.com/omkarbhale/flickline/issues/64), the feel checklist [#65](https://github.com/omkarbhale/flickline/issues/65) and feel tuning [#67](https://github.com/omkarbhale/flickline/issues/67), the fun criteria [#66](https://github.com/omkarbhale/flickline/issues/66) and fun tuning [#68](https://github.com/omkarbhale/flickline/issues/68), the transfer checklist and research (`docs/transfer-checklist.md`, `docs/research/transfer.md`, from [#128](https://github.com/omkarbhale/flickline/issues/128)) with the first habit review [#160](https://github.com/omkarbhale/flickline/issues/160) and the transfer pilot [#158](https://github.com/omkarbhale/flickline/issues/158); the playtests are [#29](https://github.com/omkarbhale/flickline/issues/29) and [#56](https://github.com/omkarbhale/flickline/issues/56).

---

## 15. Scope

### First playable (the earliest build that proves the thing)
A build someone can play from a link that demonstrates the loop: Range map; weapons Pace and Kestrel using the spec's numbers; Posts and Beacons; Cold Start and Orbit; the Placement run and the skill model v1 with persistence; the full per-shot feedback of section 7.1 (excluding medals and surge); live stat strip; basic results card with the one-thing-to-fix stub (moving shots, time to shot); crosshair editor; sensitivity in the reference scale; first-run flow; synthesised sounds for shots, hits, headshots, kills; instant restart; a perf harness and an automated bot playtest; the conformance suite and the feel and fun checklists; a looked-at playtest pass reporting numbers, feel and fun separately.

### First release
Everything in sections 4–13: all eight modes, four maps, four weapons (Pace, Kestrel, Vane, Rill), seven enemy types, damage and slow-on-hit, the full feedback set including callouts and medals, results breakdown with the fix engine and spray trace, skill profile, ranks and PBs, the Daily Baseline and reference check-in, Mix runs, settings, post effects, viewmodels, UI kit, accessibility options, balance, performance and legal passes, a full playtest, and the transfer pilot.

### Later (not scheduled)
Longnail sniper and scoped sensitivity; shotgun; more maps (Stack and others); an in-browser map editor; replays and ghost runs; shareable seeds and daily seeds; online leaderboards (needs a backend); generative music; gamepad; desktop wrapper; localisation.

### Explicitly out
Multiplayer, teams, rounds, an objective to plant, abilities, economy and buy phases, accounts, monetisation, mobile and touch input, console, VR, anti-cheat, any aim assist or bullet magnetism, and any content copied from existing games.

---

## 16. Identity and legal line

Flickline copies **mechanics and feel only**: movement speeds and acceleration, counter-strafe timing, accuracy rules, recoil behaviour, damage and slow-on-hit rules, field of view, sensitivity scale. It copies **no** names, characters, abilities, maps, art, audio, logos or interface look from any existing game. Specifically:

- All names are original: Flickline, Echoes, Post, Beacon, Strafer, Peeker, Rusher, Bulwark, Gnat, Pace, Kestrel, Rill, Longnail, Range, Lane, Elbow, Foundry, Sweep, Surge, the tier names, the medal names, the mode names. Any contributor who adds a name must check it is not a protected name from a known game.
- All art is procedural and original; no textures from any source. All fonts are open-licence and listed in `docs/credits.md` with their licences.
- All audio is synthesised from code written for this project.
- UI is the project's own: dark panels with a single trim colour and thin borders, no resemblance to the reference game's layout, icons, fonts or typographic style.
- References to "the reference game" or "the reference tactical shooter" in project docs are for explaining where numbers come from; the product never names or alludes to it in-game.
- A legal and identity audit (backlog) re-checks all names, assets and licences before the first release.

---

## 17. Backlog

The work is tracked in GitHub issues on `omkarbhale/flickline`; every issue states its goal, the design section it implements, acceptance criteria, dependencies and what is out of scope. Design and backlog tracking: [#8](https://github.com/omkarbhale/flickline/issues/8).

- Prerequisites outside this backlog: code foundation [#6](https://github.com/omkarbhale/flickline/issues/6) (merged), mechanics spec [#7](https://github.com/omkarbhale/flickline/issues/7) (merged), architecture and conventions [#54](https://github.com/omkarbhale/flickline/issues/54).
- Phase tracking issues: [#9 first playable](https://github.com/omkarbhale/flickline/issues/9), [#10 first release](https://github.com/omkarbhale/flickline/issues/10), [#11 later (parked ideas)](https://github.com/omkarbhale/flickline/issues/11).
- Quality tracking issues (long-lived, section 14.7): [#61 numbers conformance](https://github.com/omkarbhale/flickline/issues/61), [#62 feel similarity](https://github.com/omkarbhale/flickline/issues/62), [#63 fun](https://github.com/omkarbhale/flickline/issues/63), [#149 transfer](https://github.com/omkarbhale/flickline/issues/149).

### First playable

- [#12](https://github.com/omkarbhale/flickline/issues/12) research: human performance baselines and skill-transfer evidence for the dial and the drills
- [#13](https://github.com/omkarbhale/flickline/issues/13) feat(sim): run state machine, event log and stat tracker
- [#14](https://github.com/omkarbhale/flickline/issues/14) feat(weapons): generic weapon simulation with Pace and Kestrel
- [#15](https://github.com/omkarbhale/flickline/issues/15) feat(enemies): enemy framework, humanoid hit zones, Post and Beacon
- [#16](https://github.com/omkarbhale/flickline/issues/16) feat(maps): map data format, loader, lint CLI and the Range map
- [#17](https://github.com/omkarbhale/flickline/issues/17) feat(skill): difficulty dial, adaptive staircase and grid-posterior skill model
- [#18](https://github.com/omkarbhale/flickline/issues/18) art: Echo humanoid models, Beacon and Gnat meshes, and the Echo shader
- [#19](https://github.com/omkarbhale/flickline/issues/19) art(render): Lightline environment look — palette, trim lines, grid floor, sky, fog
- [#20](https://github.com/omkarbhale/flickline/issues/20) feat(audio): Web Audio engine and the feedback sound set (hit, headshot, kill ladder, miss, moving shot)
- [#21](https://github.com/omkarbhale/flickline/issues/21) feat(ui): crosshair renderer, editor and share codes
- [#22](https://github.com/omkarbhale/flickline/issues/22) feat(modes): mode framework — scheduler, scoring table and dial application
- [#23](https://github.com/omkarbhale/flickline/issues/23) feat(modes): Cold Start, Orbit and the Placement run
- [#24](https://github.com/omkarbhale/flickline/issues/24) feat(feedback): per-shot visual feedback — hitmarkers, tracers, impacts, kill shatter, screen pulse
- [#25](https://github.com/omkarbhale/flickline/issues/25) feat(ui): live HUD — score, multiplier, counters, stat strip, ghost-pace and edge meter
- [#26](https://github.com/omkarbhale/flickline/issues/26) feat(ui): end-of-run results card with stats, rating delta and restart flow
- [#27](https://github.com/omkarbhale/flickline/issues/27) feat(ui): sensitivity in the reference scale, raw input, and the first-run flow (shooting in ≤ 10 s)
- [#28](https://github.com/omkarbhale/flickline/issues/28) feat(infra): headless bot playtest harness and frame-time perf harness
- [#64](https://github.com/omkarbhale/flickline/issues/64) test: spec conformance suite and generated conformance table (numbers quality)
- [#65](https://github.com/omkarbhale/flickline/issues/65) research: reference-feel checklist for recoil, movement, sounds, hit response and timing (feel quality)
- [#66](https://github.com/omkarbhale/flickline/issues/66) research: fun criteria and playtest protocol (fun quality)
- [#160](https://github.com/omkarbhale/flickline/issues/160) review: first transfer habit review of Cold Start, Orbit and the Placement run (transfer quality)
- [#29](https://github.com/omkarbhale/flickline/issues/29) playtest: first playable pass — reports numbers, feel and fun separately

### First release

- [#30](https://github.com/omkarbhale/flickline/issues/30) feat(weapons): Rill SMG and Vane precise rifle, weapon swapping and loadouts
- [#31](https://github.com/omkarbhale/flickline/issues/31) feat(sim): player health, taking damage, slow-on-hit, kill-heal and the damage arc data
- [#32](https://github.com/omkarbhale/flickline/issues/32) feat(enemies): Strafer and Peeker behaviours, including enemy shooting with tells
- [#33](https://github.com/omkarbhale/flickline/issues/33) feat(enemies): Rusher, Bulwark and Gnat with waypoint navigation
- [#34](https://github.com/omkarbhale/flickline/issues/34) feat(maps): Lane and Elbow maps with anchors, checkpoints and peek spots
- [#36](https://github.com/omkarbhale/flickline/issues/36) feat(maps): Foundry map for Sweep (three lanes, catwalk, six gates, nav graph)
- [#37](https://github.com/omkarbhale/flickline/issues/37) feat(ui): skill profile screen — radar, tiers, confidence bands, trends
- [#38](https://github.com/omkarbhale/flickline/issues/38) feat(skill): persistence, medals, ranks, personal bests and ghost pace
- [#39](https://github.com/omkarbhale/flickline/issues/39) feat(ui): results breakdown — fix engine, one-thing-to-fix card, spray trace and plots
- [#40](https://github.com/omkarbhale/flickline/issues/40) feat(feedback): chain and streak callouts, medal toasts, Surge and rank-up moments
- [#41](https://github.com/omkarbhale/flickline/issues/41) feat(audio): weapon sounds, enemy tells, damage, near-miss, footsteps and UI sounds
- [#42](https://github.com/omkarbhale/flickline/issues/42) feat(ui): settings menu — keybinds, audio, graphics, gameplay, data, accessibility
- [#43](https://github.com/omkarbhale/flickline/issues/43) feat(ui): menu shell — mode select cards, pause menu, today's session, UI kit and fonts
- [#44](https://github.com/omkarbhale/flickline/issues/44) feat(render): post effects — cheap bloom, vignette, damage vignette, chromatic pulse
- [#45](https://github.com/omkarbhale/flickline/issues/45) art: procedural weapon viewmodels, muzzle flashes and recoil animation
- [#46](https://github.com/omkarbhale/flickline/issues/46) feat(modes): Strafe Track mode
- [#47](https://github.com/omkarbhale/flickline/issues/47) feat(modes): Stop & Pop mode (counter-strafe and stance discipline)
- [#48](https://github.com/omkarbhale/flickline/issues/48) feat(modes): Spray Wall mode
- [#49](https://github.com/omkarbhale/flickline/issues/49) feat(modes): Switchboard mode (target switching)
- [#50](https://github.com/omkarbhale/flickline/issues/50) feat(modes): Corner Clear mode (peeking and clearing angles)
- [#51](https://github.com/omkarbhale/flickline/issues/51) feat(modes): Sweep flagship mode and its encounter director
- [#52](https://github.com/omkarbhale/flickline/issues/52) research: audio and visual cue design — hit, headshot and tell cues that players learn in a minute
- [#53](https://github.com/omkarbhale/flickline/issues/53) balance: tune dial end-points, scoring, medals and Sweep pressure against bot and human data
- [#55](https://github.com/omkarbhale/flickline/issues/55) perf: first-release 144 fps pass on Range, Lane, Elbow and Foundry
- [#67](https://github.com/omkarbhale/flickline/issues/67) balance: feel tuning pass — recoil, movement, sounds, hit response and timing against the checklist (feel quality)
- [#68](https://github.com/omkarbhale/flickline/issues/68) balance: fun tuning pass — pacing, reward cadence, restart friction and the flagship's game feel (fun quality)
- [#150](https://github.com/omkarbhale/flickline/issues/150) feat(modes): Daily Baseline run — fixed item sets, levels, daily shuffle and reference-like presentation
- [#151](https://github.com/omkarbhale/flickline/issues/151) feat(skill): Baseline estimate, series and trend — progress beyond the player's own noise
- [#153](https://github.com/omkarbhale/flickline/issues/153) feat(ui): Baseline on the results card and as the profile headline — verdict, warm-up gap, Retained medal
- [#154](https://github.com/omkarbhale/flickline/issues/154) feat(ui): reference check-in — weekly, local-only reference-game numbers beside the Baseline trend
- [#157](https://github.com/omkarbhale/flickline/issues/157) feat(modes): Mix runs and the interleaved Today's session
- [#158](https://github.com/omkarbhale/flickline/issues/158) playtest: transfer pilot — two arms, two weeks, cold reference-game test before and after (transfer quality)
- [#159](https://github.com/omkarbhale/flickline/issues/159) playtest: practice-schedule experiment — interleaved Mix against blocked drills, Baseline retention
- [#56](https://github.com/omkarbhale/flickline/issues/56) playtest: first release pass — reports numbers, feel and fun separately
- [#57](https://github.com/omkarbhale/flickline/issues/57) audit: identity and legal check — names, assets, fonts, licences, no copied content
