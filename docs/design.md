# Flickline — Game Design

Status: v2 of the design. v2 (#187) replaces the aim-trainer structure of v1 (drills, a Placement run, a Daily Baseline) with one game you replay, Sweep, under vision principle 10; section 4.10 records the fate of every v1 mode. Decisions are made here, not offered as menus. If a rule in this document conflicts with `docs/mechanics-spec.md` on a *number* (speeds, damage, spread, fire rate, FOV, sensitivity scale), the spec wins. If it conflicts with the "Architecture and conventions (read first)" issue (#54) on a *module boundary or event name*, that issue wins. Section numbers of the spec are cited as `spec §x.y`. Everything else here is normative.

Vision: [`docs/vision.md`](vision.md) states what Flickline is for. This design is how we currently pursue it, and every section here is checked against it.

Contents: 1 Pitch and pillars · 2 Core loop · 3 Skills and stat definitions · 4 Sweep: the run · 5 Enemies and targets · 6 Weapons · 7 Instant feedback · 8 Results and progression · 9 Skill matching · 10 Maps · 11 Look · 12 Sound · 13 Interface · 14 Technical contracts (incl. 14.7 quality tracks) · 15 Scope · 16 Identity and legal line · 17 Backlog

---

## 1. Pitch and pillars

**Pitch.** Flickline is a free browser first-person shooter whose shooting, movement, damage and field of view are modelled on a modern tactical shooter, so everything you learn transfers. It is **one game, Sweep**: a run through a chain of compact sectors held and patrolled by Echoes, enemies that see, hear, peek, hold, trade and make mistakes like players of your level. Your health carries from fight to fight, every sector is drawn fresh from the run's seed, you choose your route at every gate, and the stakes climb until the Finale. A run takes five to nine minutes and the next one starts in under a quarter of a second. Every shot answers you instantly with sight, sound and a number; every fight tells you why you won or lost it; the game measures you while you play and keeps every fight at the edge of your ability.

There are no drills. Nothing in Flickline is a routine you repeat for the improvement (vision principle 10). The mechanics the reference game demands (first-bullet precision, flicks, tracking, counter-strafing, spray control, switching and clearing angles) are practised the way a match asks for them: inside fights whose information, timing and stakes differ every time (section 3, `docs/research/replay-not-drills.md`).

**Pillars, ranked.** When two pillars conflict, the higher one wins.

1. **Mechanical truth.** The gun, the body and the camera behave like the reference game's, in numbers *and* in feel, which are tracked separately (section 14.7). A situation or reward that teaches a habit that fails in the real game is a bug. Numbers come from `docs/mechanics-spec.md`; we never "game-ify" them (no aim assist, no bullet magnetism, no slow-motion, no hit-box inflation beyond the spec). Game layers (route choice, score, stakes) sit *around* the mechanics and never change them.
2. **A game you replay.** Every run must differ from the last in ways that matter to how you fight: where the enemies are, what they know, what you know, what you are carrying, and what you chose. Variety comes from systems (enemy minds, scenario cards, routes, conditions, stakes), never from hand-authored set pieces a player can memorise (section 2.4).
3. **Feedback is the product.** The feedback that makes a shot feel good and informative (hit confirmation, headshot distinction, kill reward, moving-shot flag, time to shot, miss offset, sound, screen response) is product design, not polish. It is specified in section 7 and built with the core, not at the end.
4. **At the edge of your ability.** A new player and an expert should both be winning roughly seven fights in ten and stay there as they improve. Difficulty is a measurement we show, not a rubber band we hide (section 9).
5. **Zero friction.** Shooting within ten seconds of opening the link; a new run in under 250 ms; nothing between you and the next run that you did not ask for.
6. **Readable at 144+ fps.** Echoes have strong silhouettes and the brightest saturated colour on screen; effects are cheap and short; the frame budget (section 14) is a hard constraint on every visual.
7. **Its own identity.** Original names, shapes, sounds and interface (section 16). Polish, in the narrow sense of atmosphere that does not inform play, is last and never costs a frame or a millisecond of input latency.

**Not goals.** Teamplay, economy as a shop, abilities, narrative, monetisation, realism of ballistics beyond the reference's rules, and any drill, exercise menu or fixed routine.

---

## 2. Core loop

### 2.1 Second by second (inside a fight)

1. You move through a sector. An Echo becomes visible, or you hear one first (running footsteps, a reload, a shot), or it hears you. What either side knows decides the fight (section 4.4).
2. You stop, aim and fire. The crosshair ticks and the target answers within one frame: hitmarker, sound, flash. A miss answers just as clearly. An Echo that has you in sight answers back with real, aimed shots; its hits slow you exactly as the reference game's do.
3. A kill pays out in the same frame: shatter, pitched chime, floating points, chain and streak counters; the time to shot and time to kill float near the crosshair for 0.6 s while the cues are on (section 7.4).
4. When the fight (the **contact**) ends, it settles: cleared, reset (you left a fight you were losing and lived) or died, with points for the health you kept and a six-word cause line if it cost you real HP (sections 7, 8.1).

### 2.2 Minute by minute

| Time | What happens |
|---|---|
| 0:00 | Page loads (no asset downloads; everything is procedural) onto the **Lobby**: the Range, with Beacons drifting in it. |
| 0:03–0:10 | One panel: sensitivity (already filled in), the four self-report chips and **Play**. You can shoot the Beacons before you click; nothing there is scored. |
| 0:10 | **Play** starts a Sweep run. The first sector, the **Opener**, is gentle and also places a new player (section 9.2). |
| 0:10–~7:00 | Sectors 1–6: fights, gates and route choices, rising stakes, the **Finale** in sector 6. Health carries throughout. |
| run end | Death, or you leave after the Finale (or later, from **Overtime**). The results card appears over the frozen last frame in under 100 ms. `Enter` starts the next run on a new seed; `Esc` opens the menu. |

### 2.3 Definitions

- **Run**: one Sweep from the Opener to death or exit, on one seed. States: `ready` (0.8 s, enemies not live, crosshair and movement work), `live`, `result`.
- **Sector**: one compact space of a map with its own entry and exit gates, holding one to three contacts (section 4.2). A run is six sectors, then optional Overtime.
- **Contact**: one fight, from the first information either side has to every enemy in it dead, the player dead, or 2 s with no line of sight either way (section 3; `docs/research/fight-attribution.md` §3.1). Every contact is drawn from a **scenario card** (section 4.4).
- **Gate**: the short connector between sectors where the player chooses the next sector by walking through one of two doors (section 4.5). There is no menu and no timer at a gate.
- **Session**: one sitting, expected 15–30 minutes and 2–5 runs. Nothing is suggested or enforced: **Play** always starts a run.
- **Instant restart**: `Backspace` during a run (asks once, because a run is worth minutes), `Enter` on the results card. The world is reset from the new seed (no asset load); target: key press to first frame of the next `ready` ≤ 250 ms on the reference rig. The previous run is saved to history first.

### 2.4 Why the next run is different

A player comes back because the next run will ask something new, not because a counter wants filling. Each of these is drawn from the run's seed or chosen by the player, and each changes how the fights are played, not only how they look:

| Source | What changes | Section |
|---|---|---|
| **Route** | Which sectors of which maps, in what order; the player picks one of two doors at every gate. | 4.2, 4.5 |
| **Scenario cards** | Who knows what before each fight, who must move, how many enemies and in what arrangement. | 4.4 |
| **Enemy minds** | Every Echo draws its own personality around its profile: reaction, aggression, favourite peeks, whether it re-peeks or repositions, whether it trades. | 5, `player-like-enemies.md` |
| **Tempo** | Arriving early meets enemies still moving; arriving late meets enemies set up and expecting you. Running is fast and loud, walking is slow and silent. | 4.3 |
| **Conditions** | A sector's economy (eco, light or full shield and weapons) and loadout, as the reference game's rounds vary. | 4.6 |
| **Stakes** | Health carried from earlier fights, door rewards taken or refused, a depth multiplier, and Overtime's unbanked points. | 4.5, 4.7 |

The same seed replays the same run exactly (section 14.2); the **Daily Route** (section 4.8) gives every player the same seed for a day.

### 2.5 What brings the player back

1. **The run itself.** Short enough to finish, long enough to have a story ("I took the loud door on 40 HP, held the corridor, then lost the Finale to a crossfire").
2. **Choices with consequences.** Route, risk and tempo are the player's; a better player makes better ones, and that is visible in the score.
3. **Enemies worth beating.** Echoes play like people at your level (section 5): you learn to read them, and they keep pace as you improve.
4. **A concrete next goal without a drill.** The results card names one thing to fix and the next run **leans** toward the situations that exercise it (section 8.3); you practise it by playing.
5. **Long arcs.** Best runs, deepest Overtime, the Daily Route, situation records, rank, and the cold-opener trend that says whether you are really improving (sections 8.4–8.5).
6. **Restart cost is zero** and the results card is skippable the instant it appears.

Nothing in the loop rewards time spent: no XP for playing, no daily-login streak, no currency, no unlock gates. Rewards are derived only from mechanics and decisions (section 8).

---

## 3. Skills and stat definitions

### 3.1 The seven measured skills

Skills are what the game **measures and reports**, not things the player selects or practises separately. Every one is exercised inside fights, in the form a match asks for it.

| Skill id | Name | What it is in the reference game | Where a run exercises it |
|---|---|---|---|
| `precision` | Precision | First bullet on the head from a stationary, settled crosshair. | Holding an angle an Echo swings; pre-aimed takes; first shots of every duel. |
| `flick` | Flick | Large, fast, accurate crosshair relocation to a newly seen enemy. | Off-angles, flanks, the second enemy of a trade, enemies first heard and then seen. |
| `track` | Tracking | Keeping the crosshair on a strafing enemy through a burst. | Duels with Strafers and with Echoes that strafe between bursts; Meet contacts. |
| `footwork` | Footwork | Counter-strafe, stop, shoot; shooting from the correct movement state (stand / crouch). | Every fight in which an Echo shoots back: a moving shot is inaccurate exactly as in the reference game. |
| `spray` | Spray control | Counter-recoil during a burst and a full spray. | Close and mid fights against several Echoes, Rushers, Bulwarks; any burst of five or more bullets. |
| `switch` | Target switching | Clearing several enemies without hesitation between kills. | Trades, crossfires, multi-enemy contacts, Gnat swarms. |
| `angles` | Angles | Crosshair placement at head height, pre-aim, peeking and clearing a corner without over-exposing. | Moving through every take sector; clearing order; peeking held angles. |

Each contact produces **trials** for the skills it exercised (section 9.1): the first shot of a duel against a pre-aimed angle is a `precision` trial, a kill that needed a relocation larger than 20° is a `flick` trial, and so on. Trial classification lives in data next to the stat definitions.

### 3.2 Stat definitions (single source of truth for code and UI)

Every stat is computed from the event log (section 14), never from UI state.

- **Accuracy** = shots that hit a target zone ÷ shots fired (only in `live`).
- **Headshot rate** = head hits ÷ all hits.
- **Time to shot (TTS)** of a target = time from `targetVisible` (the first tick the target is in the view frustum and unoccluded from the eye) to the first `shotFired` that is aimed within 5° of it. It includes the aiming movement, so it is **not a reaction time** and is never called one in the UI (research #12 P1; the code identifiers still say `rtMs` until #137). Time to shot is reported per target; the run's is the **median**, not the mean. Context only, never pass/fail: about 0.25–0.35 s pre-aimed, 0.45–0.9 s for a 10–25° relocation, 0.9–1.5 s for a 60–120° flick (#12 §1.2).
- **Time to kill (TTK)** = time from the first shot fired at the target (a shot that hits it or lands within 1° of it) to its death.
- **Time on target** = fraction of `live` ticks where the aim ray is within the target's hit volume padded by 0.5° (reported for duels against a strafing Echo).
- **Moving shot** = a shot fired while the player's horizontal speed is above the accuracy deadzone from the spec (`move.deadzone_fraction`: 27.5% of the equipped weapon's run speed, 15% for the sniper; spec §2.4) or while airborne. It is flagged at the shot, not inferred later.
- **Stop latency** = time from the last movement key release (or counter-strafe key press) to horizontal speed first falling below the accuracy threshold.
- **Pre-aim error** = angle between the aim ray and the centre of the head of an enemy at the tick it becomes visible. Smaller is better.
- **Head-height discipline** = mean absolute vertical angle between the aim ray and the head-centre height (spec `hit.head_centre_stand`, 1.66 m against the 1.62 m eye) at the player's eye position, sampled while no enemy is visible, while moving. Smaller is better. On a map with elevation the reference height is the head centre of the enemy the player is facing: the nearest-to-the-view-line enemy anchor (post, gate, peek, lane end) within 30 degrees of the view direction and 3 to 45 m away, at that anchor's own floor height and distance; with none ahead, an enemy standing on the floor 10 m ahead. It is never the player's own floor or eye level.
- **Flick error** = for a flick, signed overshoot or undershoot (in degrees, along the flick axis) at the first shot relative to the target centre.
- **Spray trace** = for a burst, the ordered list of per-bullet impact offsets (in degrees, relative to the aim point at the first bullet) and the player's per-bullet mouse pull. **Ideal trace** = the same burst with the spec's recoil pattern perfectly countered (every bullet at the first bullet's offset plus only the spec's random spread). The comparison drawn is between required pull and actual pull per bullet index.
- **Clean kill** = a kill on that target with no missed shot at it and no moving shot.
- **Chain** = isolated kills within 1.5 s of the previous one; a kill made while another live enemy had the player in sight from a second angle (more than 30° away) gets no chain credit (#132). **Clean streak** = consecutive clean kills. (Two different counters; both shown.)
- **Contact** = one fight (section 2.3), from the first information either side has to every enemy dead, the player dead, or 2 s with no line of sight either way (`docs/research/fight-attribution.md` §3.1). **Health kept** = 1 − health+shield lost in the contact ÷ health+shield at its start (kill-heal does not reduce the loss).

---

## 4. Sweep: the run

Flickline has one game, Sweep. Section 4.10 records what happened to the drills and modes of the earlier design. A run shares the run state machine, the scoring table (section 8), the difficulty dial (section 9), the event log and the results card with everything else; the run director is data plus a small scheduler and owns no rendering, input or audio.

### 4.1 Shape of a run

| Sector | Name | Dial offset (section 9.3) | Depth multiplier | Notes |
|---|---|---|---|---|
| 1 | **Opener** | −8 | ×1.0 | Gentle; places a new player (section 9.2); the day's first Opener is the **cold opener** (section 8.5). Always a take sector with one or two contacts. |
| 2 | — | −3 | ×1.2 | First gate before it. |
| 3 | — | 0 | ×1.4 | |
| 4 | — | +3 | ×1.6 | |
| 5 | — | 0 (breather) | ×1.8 | Fewer contacts, never a crossfire card. |
| 6 | **Finale** | +6 | ×2.0 | Always a hold sector (section 4.2) with the run's largest contact count, including Rushers and Bulwarks. |
| 7+ | **Overtime** | +6, then +2 per sector | ×2.2, +0.2 per sector | Optional, see section 4.7. |

A matched player reaching the Finale in about half their runs, and clearing it in about a quarter, is the starting tuning target (HYPOTHESIS, settled by the balance pass #53 and the repeat-enjoyment playtest). A full run to the end of the Finale takes five to nine minutes.

Before the Opener the player picks a primary (Kestrel, Vane or Rill) with `1`–`3` on the `ready` screen (default: last pick); the sidearm is always Pace. Magazines and reloads are real. Health (spec values, 100) and the default heavy shield (50) start full, there is no passive regeneration and a spent shield returns only from a door reward. **Kills heal**: a body kill restores 5 HP, a headshot kill 10 HP, capped at maximum and never restoring shield, so clean play sustains you and sloppy play drains you.

### 4.2 Sectors

A sector is a region of a map with an entry gate, an exit gate and placement anchors (section 10.2). Its **role** says who has to move:

- **Take** (the player moves in on enemies): the sector's Echoes are placed **before the player can see them** (as the player passes the previous gate), on hold anchors, with initial beliefs from their contact's card (section 4.4). Lines of sight open because the player moves, one slice at a time; nothing is triggered by stepping on a mark (vision review 1, finding 7). The sector is done when its Echoes are dead or the player leaves through the exit gate; leaving enemies alive forfeits the sector-clear bonus and lets the survivors **follow**: they can arrive in the next sector as a flank or trade card.
- **Hold** (enemies move in on the player): the player enters with the enemies not yet in the sector. One to three contacts **arrive** over 25–45 s along the sector's approach lanes, with honest audio (section 4.4) and real peek patterns. The player may hold one spot, reposition, or push out to meet them; the exit opens when the sector's enemies are dead. There is nothing to defend: the enemies are hunting the player, and the player chooses where to fight them.
- **Meet** (both sides moving): a rotation corridor where an Echo group is crossing the same space. Who stops first and who holds head height while moving decides it.

The Opener is always a take; the Finale is always a hold. Sectors 2–5 are drawn so that a run has at least one of each role and never three of the same role in a row (takes 50%, holds 35%, meets 15% of sectors 2–5; HYPOTHESIS, close to `engagement-information.md` §5 question 5's balance of attacker and holder fights).

### 4.3 Tempo: why you cannot wait forever

In a take sector the Echoes **set up** over time. Until the sector's tempo window ends (12–25 s after the player enters, by dial and depth), placed Echoes are still settling: some are moving to their spot, some face elsewhere, cards resolve to `take-unaware`, `meet` or `clear`. After it, unaware Echoes turn to their angles and resolve to `take-expected` or `breach`. Tempo changes the card before the mix is sampled, and the mix rebalances over the rest of the run (`engagement-information.md` §4.5 rule 4). Running footsteps carry (honest channels, section 4.4), so running in early buys time but tells the Echoes you are coming; walking is silent and slow. This is the reference game's attacker trade-off between tempo and information, made without a timer, a spike or a fail state (`engagement-information.md` §4.3; [#100](https://github.com/omkarbhale/flickline/issues/100)).

What tempo pays: arriving in the window keeps the Surge meter filling and adds the tempo bonus to the sector clear (section 8.1). Missing it never costs HP and never ends the run; it only makes the next fights harder, as waiting does in the reference game.

### 4.4 Fights: scenario cards and honest information

Every contact is drawn from a **scenario card** (`docs/research/engagement-information.md` §3–§4): what the player knows, what the Echoes know, how predictable the timing is, who must move, how many Echoes and in what arrangement. The cards are `take-expected`, `take-unaware`, `hold`, `clear`, `trade`, `meet`, `breach`, `crossfire`, `flank` and `known-duel`; the sector role decides which cards it can hold.

- **Sampling.** The run director samples cards with the coverage, no-streak and cap rules of `engagement-information.md` §4.5: at least six distinct cards in a run that reaches sector 4, the same card never three times in a row, a flank only after a contact the player won, and the symmetric known duel at most 5% of contacts.
- **Honest channels only.** Information reaches either side only through sight, positional sound (running footsteps, landings, shots, reloads; walking is silent) and the coarse, delayed callout stand-in; footstep radii are symmetric. No markers, no wall highlights, no radar (`engagement-information.md` §4.2; [#99](https://github.com/omkarbhale/flickline/issues/99)).
- **Prepared holders** are bound only by the 0.15 s reaction floor and never hold fire for a tell; surprised Echoes keep the full floors (section 9.3, `docs/research/prepared-holders.md`).
- **The lean.** After the first run, the two cards with the player's lowest win rate over their last 20 contacts gain weight (+50%, never above twice their base share), and the card the last results card named gains the same (section 8.3). That is how the one thing to fix gets practised: in the next run, not in a drill.
- **Dial and card are separate.** The dial sets Echo profiles and counts; the card sets the situation. Difficulty and situation stay separate variables in the skill model.

### 4.5 Gates and route choice

Between sectors the player walks through a short **gate** with two doors. Each door shows, in-world and in our own visual language, three honest facts about the sector behind it:

1. its **role** (take, hold or meet) and a silhouette of its sightlines (long or close);
2. what the player can **hear** through it: footsteps and their rough count ("quiet", "one or two", "several"), using the same sound radii as the fights;
3. its **stake**: one of **Shield** (the shield refills to 50 on entry; at most once per two sectors), **Arms** (swap the primary for a named one), **Hot** (one extra contact, sector points ×1.5) or **Plain** (none).

Walking through a door commits; the other closes. A door is never a trap: the information it shows is true. The player who reads the gate well (taking the Shield on 30 HP, taking Hot at full health) scores more and lives longer; that is a decision the reference game also asks (when to take a fight, when to save), not a mechanic it lacks.

### 4.6 Conditions

A sector may carry an **economy condition** (`config/economy.ts`, section 5.2): `full` (heavy shield, rifles; the default), `light` (light shield 25) or `eco` (no shields, sidearms only, for the Echoes and the player alike, the player's primary holstered for the sector). Eco and light sectors are rare (at most one of each per run, never the Opener or the Finale) and announced on the door. They exist because the reference game's fights really do change with them: bullet counts, one-tap ranges and how far you can trust a body shot (vision review 1, finding 5).

### 4.7 Overtime: bank or push

After the Finale the exit gate offers **Leave** (the run ends and every point is banked) or **Overtime**: another sector, harder (+2 dial per sector) and with a higher multiplier. Overtime points are **at risk**: they are banked only when the player leaves at an Overtime exit gate; dying in Overtime loses the unbanked Overtime points (never the points of sectors 1–6). This gives an expert a ceiling to chase and every player a real decision about when a life is worth more than more points, which is the reference game's lesson about saving (`docs/research/survival-rewards.md`).

### 4.8 The Daily Route

One seed per calendar date (local time) gives every player the same route, cards, Echo personalities and doors that day (only the dial differs, because Echo profiles follow each player's own skill). The Daily Route is on the **Play** menu next to **Play**; its best score for the day is kept separately. No backend is needed and nothing is sent anywhere; online leaderboards stay *Later* (section 15).

### 4.9 Run end and scoring summary

The run ends at 0 HP, at a Leave gate, or when the player quits. Scoring follows the standard table (section 8.1): kill points, contact settles, sector clears, tempo bonus, door stakes, all multiplied by the depth multiplier of the sector they happened in; Surge doubles while active. The run contributes to all seven skill ratings through the trials its contacts contain (section 9.1).

### 4.10 What happened to the drills and modes

The earlier design was an aim trainer: seven 60-second drills, a Placement run, a Daily Baseline, Mix runs, Today's session and a flagship. The owner's principle (vision principle 10) retires the drills as things a player chooses. Their code is reused where it measures or builds fights; their routines are not.

| Old mode | Fate | What is kept, and where |
|---|---|---|
| **Cold Start** (merged) | Retired as a mode. | Its first-bullet trial bookkeeping, exposure-from-visibility and item difficulty become the `precision` trial classifier for duels (section 3.1). Posts remain an enemy type for the Lobby and for Echo poses. |
| **Orbit** (merged) | Retired as a mode. | Flick error, flick time and the must-flick trial type become the `flick` trial classifier. Beacons drift in the Lobby as an unscored toy (section 13.4). |
| **Placement run** (merged) | Retired. | The staircase and the self-report prior place a new player inside the Opener (section 9.2). |
| **Stop & Pop** (merged, #185) | Retired as a mode; the stance ring cue is retired with it (it has no counterpart in the reference game). | Stop latency, stance correctness and moving-shot stats are measured in every fight. The Lane map becomes a source of meet and take sectors. |
| **Spray Wall** (merged, #189) | Retired as a mode. | The spray trace and per-bullet-index analysis are drawn from real sprays in fights (section 8.2). |
| **Strafe Track** (merged, #192) | Retired as a mode. | Strafers fight in duels and meet contacts; time on target is reported for duels against a strafing Echo. |
| **Switchboard** (never built) | Retired. | Trades, crossfires, multi-enemy contacts and Gnats; switch time is a stat of every multi-kill contact. |
| **Corner Clear** (never built) | Absorbed: it *is* a take sector. | Elbow's checkpoints and peek spots become take sectors; placed holders and the clearing-order stats of vision review 1 finding 7 apply. |
| **Vigil** (never built) | Absorbed: it *is* a hold sector. | Hold cards, approach lanes and the Finale. |
| **Daily Baseline** (open PR #190) | Replaced by the **cold opener** (section 8.5). | The stored item sets and their generator, the version guard, the levels, keeping its trials out of the matched posterior, the due rule, the noise band and the verdict survive; the separate routine does not. |
| **Mix runs** (not built), **Today's session** (merged) | Removed. | Every run interleaves all seven skills by construction. |
| **Practice this (30 s)** | Removed. | Replaced by the lean (section 4.4). |
| **Sweep** (#51, never built as a mode) | Becomes the whole game. | Its director, kill-heal, Surge, contact settle and tempo become the run's. |
| **Free play** (merged) | Becomes the **Lobby**. | The Range with drifting Beacons behind the menu; nothing is scored or rated there. |

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

Hit detection is hitscan against these shapes in the simulation (the same shapes the renderer's silhouette is built from; the render mesh never decides hits). A **head node** (a slightly brighter emissive core inside the head, drawn *without* enlarging the hitbox) marks the head. Health is 100 HP for players and Echoes. **Shields** (spec §4.1 armour) sit on top of it **in every run**, for the player and for every humanoid Echo alike: a shield absorbs 66% of each hit until it has absorbed its capacity (light 25, heavy 50), the rest goes to health, so the total damage to kill is `100 + shield`. Eco sectors have none, light sectors carry 25 (section 4.6). Orbs (Beacon) and the Gnat carry none. Reversed from the first draft's "no armour in the first release": rifle duels in the reference game are mostly fought by players who bought shields (rifles and full shields are bought together), so training only the unarmoured bullet counts would teach thresholds that fail there (vision review 1, #131).

### 5.2 Roster

| Enemy | Shape | Moves | Threat | Used in |
|---|---|---|---|---|
| **Post** | Standing Echo, idle sway only. | Stationary. | None. | Lobby; also the pose of a placed holder before it is alerted |
| **Beacon** | Head-sized glowing orb on nothing. | Stationary. | None. | Lobby (unscored) |
| **Strafer** | Echo that mirrors a strafing player. | Strafe legs (0.35–1.0 s) → counter-strafe decel (0.16 s) → stand-still (0.25–0.4 s) → strafe, reversing on a seeded coin; speed 2.0–5.4 m/s by dial (spec §5.3). Stops are *real stops* with the spec's braking, so the stand-still is exactly the window where a player's counter-strafed shot is accurate. | Fires in its stop windows. | Sweep: duels, meet contacts |
| **Peeker** | Echo behind low or full cover. | Peek patterns: **shoulder** (exposes 40% of body, 0.3 s), **wide** (full body, 0.8–1.2 s), **jiggle** (shoulder out-in-out), **hop** (rises above low cover for 0.35 s, head and upper body only). | Fires one or two bursts during a wide peek. | Sweep: take and hold sectors |
| **Rusher** | Echo with a forward-leaning stance. | Sprints at the player along nav nodes from ≥ 15 m, slows and fires from 8–12 m, then keeps closing. | Threatens in the open; forces you to leave cover or reposition. | Sweep: hold sectors, the Finale |
| **Bulwark** | Echo with a front plate across the torso. | Walks slowly towards the player. | Fires steadily; the plate absorbs body shots from the front (sparks and a muted tick, no damage), so only the head and legs are valid. | Sweep: the Finale, Overtime, high dials |
| **Gnat** | Small spinning octahedron (hand-sized). | Hovers at head height and darts on a 3D curve (seeded Lissajous with random impulses), 1 bullet kills. | None; its job is vertical tracking and fast re-targeting. | Sweep: mixed contacts |

All Echoes use HP, damage-per-zone, shield and bullet-count rules identical to the player's side of the spec (`health.max` 100 HP). **Unshielded**, a rifle headshot kills and three body bullets kill. **With the default heavy shield (50)** the bullet counts of spec §6 apply: a Kestrel needs four body bullets (a headshot beyond 20 m needs two), a Pace needs two headshots (not one), a Rill six body bullets.

**Economy.** The shield level is a scenario variable (`config/economy.ts`): `full` = heavy shield (50) and the rifle, `light` = light shield (25), `eco` = none and the sidearm. A sector condition (section 4.6) or a scenario card carries `economy`; without one the run uses `defaultEnemyFire` (`full`). The player and the Echoes get the same tier, as in a real full-buy or eco round. Kill-heal restores health only, never shield (section 4.8). Results and the fix engine name the difference when it mattered: "your Pace needed two headshots on an armoured target".

### 5.3 How enemies shoot back (where they do)

Every humanoid Echo in a run shoots back (Posts and Beacons in the Lobby never do). The rules are designed so damage is *readable and mostly your fault*, and so slow-on-hit matters:

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
| **Pace** | `pistol_accurate` | Accurate semi-auto sidearm, one-tap head up close. | Sidearm in every run; eco sectors; first-bullet discipline. | First playable |
| **Kestrel** | `rifle_spray` | Controllable full-auto rifle with a learnable recoil pattern. | Default primary: the controllable spray rifle most fights are fought with. | First playable |
| **Vane** | `rifle_precise` | One-tap rifle: high damage, no falloff, punishes spraying. | Alternative primary (run start or an Arms door); teaches tap and burst discipline. | First release |
| **Rill** | `smg` | Close-range full-auto, fast movement, low recoil. | Close-range alternative primary; teaches range discipline. | First release |
| **Longnail** | `sniper` | Bolt-action sniper (scoped, one-shot body kill, 15% deadzone). | Scoped flicks and holding angles. | **Later** (needs scoped sensitivity; keep out of first release) |

The spec's `pistol_light` and `pistol_heavy` archetypes are unused in the first release (they are the same role as Pace or a later heavy pistol).

Shared rules: the viewmodel never covers the crosshair or the screen centre; tracers are always drawn; magazines are real in runs and infinite in the Lobby; reloading is cancelled by weapon swap exactly as the spec says.

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
| **Contact settled** | `+score` under the score with one word: **Clean** (cleared untouched), **Clear** (cleared, hurt), **Reset** (left a losing fight alive). Nothing for died or left unhurt. Hidden while an enemy is visible or a tell runs. | A short soft resolve, brighter for Clean. | The settle points. |
| **Medal earned** (*FR*) | Toast at the upper centre for 1.2 s, then stored in the results card. | Short fanfare phrase (section 12). | Medal name and what earned it. |
| **Surge ready/active** (*FR*) | Frame glow, brighter tells. | Rising whoosh; sustained shimmer. | Timer. |
| **Taking damage** | Directional red arc towards the shooter, brief screen vignette narrowing, desaturation for 150 ms, slow-on-hit applies exactly as in the spec. | Low, dry thud in the player's ear with a 300 ms low-pass dip. | HP bar flashes. |
| **Near miss against the player** | Tracer past the head. | Directional whiz. | — |
| **Run end** | Last frame freezes, results card slides in (80 ms). | One closing note, resolving the streak pitch. | Section 8. |

### 7.2 Live readouts (all toggleable; default: **minimal**)

Always on: crosshair, ammo, sector and depth ("3 / 6"), score with Overtime's unbanked points apart, multiplier, chain/streak counters, HP and shield (the shield bar sits above the HP bar and is drawn only when the sector has one).

Stat strip (bottom-left, small, default **on** so the feedback is learnable; each item toggleable): **Acc %**, **HS %**, **Median TTS** (time to shot), **Median TTK**, **Moving shots**. A single "pace vs best run" bar sits under the score: ahead or behind your best run's score at the same sector.

In-world: the gate doors and their three facts (section 4.5), a quiet trim pulse on the exit gate once a sector is done; nothing marks an enemy.

### 7.3 Rewards (mechanics-derived only)

- **Streak multiplier** (clean streak ×1.0 → ×3.0 at 20).
- **Contact settle**: pays for surviving a fight, scaled by the health kept (section 8.1).
- **Chain callouts**: `Pair` ×2, `Triple` ×3, `Quad` ×4, `Surge chain` ×5+.
- **Medals** (named in section 8) with thresholds designed to be reachable by the matched player: they are awarded relative to the dial and the run's context, not to account age.
- **Run bests**: best run score per dial band, deepest sector reached, the Daily Route's best for the day; the pace bar compares against the best run.
- **Flawless** (a sector with no miss and no moving shot) — gold sector mark on the card.
- **Rank progress** (section 8).

### 7.4 Fading cues: feedback that goes away as you improve

The augmented cues above (violet moving-shot tracer, `⇆`, "tock", miss ghost, damage numbers, the RT/TTK readout, and the enemy tells of section 5.3) teach what happened, but none of them exists in the reference game. A player who waits for the tell's laser before strafing, or knows they moved because they heard the tock, has built a habit that fails there (vision principle 1). Feedback on every trial also trains learners to lean on it instead of their own senses; reducing its frequency costs a little practice performance and helps retention (guidance hypothesis, Winstein and Schmidt 1990). So the answer stays instant and specific (principle 3) but **stops being constant** (issue #129; `config/cues.ts`, `adaptive/cueFade.ts`, `feedback/cueGate.ts`, `feedback/cuePlanner.ts`).

**Phase per skill.** At each run start the Line rating (section 8.4) is read from the posterior (section 9.1) and put in one phase. Both gates must hold, so a lucky minute that lifts the mean but leaves a wide band does not strip the cues:

| Phase | Enters when (starting values, HYPOTHESIS) | What the player gets |
|---|---|---|
| **Every trial** | default; new players, a wide band, or a low rating | every cue of section 7.1, as designed |
| **Bandwidth** | rating ≥ dial 25 and posterior s.d. ≤ 5.5 (about one run of evidence) | a cue only on a **large error** (rules below) |
| **Summary** | rating ≥ dial 50 and posterior s.d. ≤ 3.2 (two or three runs) | no per-event coaching cue; the results card carries the pattern (moving-shot count, the one thing to fix) |

A player already in a phase stays in it until the rating falls 3 dial points below its gate or the band widens 1 point above it (hysteresis), so one on a border does not see the cues blink on and off between runs. A real decline brings the cues back, because the phase is a function of the posterior only.

**Bandwidth rules.** Moving-shot tracer, `⇆` and tock: only when the shot is at or above 3.5 m/s (the deadzone is about 1.5 m/s, a walk 2.7, a run 5.4: so only near-running shots) or airborne. Miss ghost: only when the shot passed 1.5° or more from the nearest head. Time-to-shot readout: only when slower than 1.3× or faster than 0.75× the run median (a good trial is worth saying too: feedback after good trials helps learning, Chiviacowsky and Wulf 2007). Damage numbers carry no error signal, so they stop at bandwidth; the hitmarker colour already names the zone. Rewards (chime ladder, score, streak, chain) are not coaching cues and never fade.

**Tells are a dial axis.** `axes(dial).tellCue` is 1 up to dial 35 and falls in a straight line to 0 at dial 60. It scales the **added** tell cues (head-node flare, laser line, rising tone). The windup itself, its duration and its floor are untouched, so a fight is not made unfair; what changes is that the player learns to read the real signs. Surge (first release) may bring the tells back as a reward (`FeedbackOptions.surge`).

**The clean opener.** The Opener (sector 1) of a session's first run, once the player has completed three runs ever, has **no coaching cues at all, no added tells, and a reference-like HUD**: the stat strip, edge meter and pace bar are hidden (crosshair, ammo, health and the reward counters stay). Cues return at the first gate. It is spent only when the Opener ends for real (cleared, left or died); quitting during it offers it again. The results card marks the sector as clean. The day's first clean opener is also the cold opener, Flickline's learning measurement (section 8.5).

**Settings (section 13.3).** *Coaching cues* remains the master switch (off = no cue, no added tell, always). *Fade cues as I improve* (default on) off keeps every cue at full forever. *Clean opener each session* (default on).

**Settling experiment (open, tracked in its own issue).** Two groups play Sweep for a week, one with fading off and one on, then compare their cold openers (section 8.5), which are cue-free by construction. If faded cues retain as well or better, fading stays the default; if not, the thresholds in `config/cues.ts` move or the default flips.

Known limits: the posterior is saved in the progress save (§14.5) after every run, so cues resume where they were; a new player starts at full cues; the enemy tell visuals and tone (#32, #41) read `tellStrength()` when they land.

---

## 8. Results and progression

### 8.1 Scoring (single table, all tunable in the `config/scoring.ts` area file)

Per kill: `score = base(enemy) × precision × speed × streak × difficulty`.

| Term | Value |
|---|---|
| `base` | Post 100, Beacon 100, Strafer 150, Peeker 200, Rusher 150, Bulwark 250, Gnat 120 |
| `precision` | ×1.5 if the killing bullet hit the head; ×1.25 if the killing bullet was the first bullet at that target; they stack to ×1.875 |
| `speed` | `1 + 0.5 × clamp((par − TTK)/par, 0, 1)` where `par` is the enemy type's par time at the dial |
| `streak` | `1 + 0.1 × min(cleanStreak, 20)` (×1.0 → ×3.0) |
| `difficulty` | `2^((dial − 50)/25)`, so dial 75 = ×2 and dial 25 = ×0.5 (score is comparable across ability; adapting the dial never gives free points or takes them away) |

No negative scores: missing costs you the clean streak, the first-shot bonus and time, never points directly. Surge doubles the total.

`speed` uses TTK, which starts at the first shot, so it pays for killing efficiently once committed and never for rushing into a fight; it applies on every card, holding cards included (#132). `par` lives in `config/scoring.ts`.

**Run terms** (all tunable, starting values HYPOTHESIS until the balance pass #53):

| Term | Value |
|---|---|
| **Sector clear** | every Echo of the sector dead and the player alive: `3 × kill × kept_sector`, with `kept_sector` = health+shield at the exit ÷ at the entry, capped at 1 |
| **Tempo bonus** | a take sector cleared with its first contact begun inside the tempo window (section 4.3): +25% on that sector's clear |
| **Door stake** | Hot: the sector's points ×1.5. Shield, Arms, Plain: no score change |
| **Depth multiplier** | applied to everything earned in a sector (section 4.1: ×1.0 in the Opener to ×2.0 in the Finale, then +0.2 per Overtime sector) |
| **Overtime** | earned the same way but held **unbanked** until a Leave gate (section 4.7) |

The depth multiplier rewards getting further alive, never time spent: a slow run and a fast run that reach the same sector with the same fights earn the same.

**Contact settle** (every contact, #132; research and settling experiment: `docs/research/survival-rewards.md`). Kills alone would pay "take every fight, fast", the over-aggression the reference game punishes; there survival is the currency. So when a contact ends (section 3) it pays once, on top of its kill points:

| Outcome | Settle |
|---|---|
| Cleared (every enemy dead, player alive) | `2 × kill × kept` |
| Disengaged alive (lost ≥ 30% of the contact's starting health+shield, then left and lived) | `1.5 × kill × kept` |
| Left unhurt, or died | 0 |

`kill` = the mean `base` of the contact's enemies × `difficulty`; `kept` = health kept (section 3). A clear always pays more than a disengage at the same health, and leaving unhurt pays nothing, so the settle cannot be farmed by peeking and leaving. A CI test (`npm run reward-experiment`) checks that this table ranks "isolate angles and disengage when losing" above "always swing", and "back off at the first hit" below both, at every dial.

### 8.2 End-of-run results card

A single screen, readable in under 5 seconds, scannable in 15:

1. **Header**: run score (with Overtime banked or lost shown apart), depth reached ("Sector 5 of 6", "Finale cleared", "Overtime 2"), how it ended (the death cause line, `docs/research/fight-attribution.md` §7.3), seed, and **best-run delta** (green/red). The Daily Route shows its day best instead.
2. **The route**: one strip of the run's sectors, each a small tile with its role, condition, door stake, contacts won and lost, HP in and out, and a gold mark for a Flawless sector. It is the run's story at a glance.
3. **Fights by situation**: the cards the player fought this run with their outcomes, and the running win rate per card (from [#104](https://github.com/omkarbhale/flickline/issues/104)).
4. **Rating**: the Line rating before → after, the tier badge and a progress bar to the next sub-tier; the seven skills' deltas under a fold.
5. **Headline stats**: Accuracy, HS rate, median time to shot, median TTK, moving shots, stop latency.
6. **Medals** earned this run.
7. **One thing to fix** card (section 8.3), ending with what the next run leans toward.
8. **Detail** (collapsible): where your HP went (Aim / Play / Dealt, [#124](https://github.com/omkarbhale/flickline/issues/124)), per-contact timeline, miss map, **spray trace vs ideal** with the per-bullet-index pull curve from real sprays, pre-aim error distribution, flick error histogram.
9. `Enter` = **Play again** (new seed), `R` = **Replay this seed**, `Esc` = menu.

### 8.3 The one thing to fix

A deterministic rules engine (no model needed) picks one weakness per run:

1. Compute 12 candidate diagnostics with an *estimated points lost* for each, from the run's own events and the player's skill profile:
   moving shots (hit rate stopped vs moving); late shot (time to shot above the player's rating-baseline); flick overshoot or undershoot bias; head-height discipline (aim vertical bias); pre-aim error; spray collapse (the bullet index where per-bullet hit rate drops below 50%); tracking lag or lead; switch hesitation (kill → first shot gap); over-peek damage; overkill bullets; reload in the open; accuracy drop after a streak break (tilt).
2. Rank by estimated points lost, counting only the Aim and Play causes of `docs/research/fight-attribution.md` §6 (never Dealt); take the top one, show **one sentence of evidence** and **one sentence of what to do**, and name what the **next run leans toward**: the scenario cards that exercise that weakness gain weight in the next run's sampler (section 4.4). There is no separate practice run.
   Example: *"22% of your shots were fired while moving; those hit 31% of the time vs 74% when stopped. Tap the opposite strafe key and fire only once your speed has dropped (about 0.1 s)."* → *Next run leans: meets and takes against expecting enemies, where the stop decides the fight.*
3. Two secondary findings are collapsed under it. Rules and copy live in data so they can be improved without code.

### 8.4 Progression

Progress is **runs**, **ratings**, **tiers**, **situation records** and **medals** for how you play, and the **cold opener** (section 8.5) for whether you are learning; time played earns nothing and nothing is unlocked by playing.

- **Run records**: best run score per dial band (bands: Chalk/Brass, Steel/Cobalt, Neon, Prism/Zenith, so a best at an easier band does not hide a harder band's), deepest sector and deepest Overtime, Finales cleared, the Daily Route's best per date; each stored with seed, date, score and the route strip, so any best can be replayed.
- **Situation records**: win rate and HP kept per scenario card over the last 50 contacts ("Holds 74% · Takes against an expecting enemy 41%"), the thing a reference-game player most wants to know about their own fights.
- **Rating**: each of the seven skills has a rating 0–3000 (dial × 30). The **Line Rating** shown on the profile is their mean (equal weights, tunable).
- **Tiers** (dial bands): **Chalk** 0–14, **Brass** 14–28, **Steel** 28–42, **Cobalt** 42–58, **Neon** 58–72, **Prism** 72–86, **Zenith** 86–100. Each tier except Zenith has divisions I–III (thirds of the band). Zenith shows the number only. Ranks go up *and down*: no permanent promotion, only a demotion buffer (a tier changes only after the estimate stays across the boundary for two consecutive runs).
- **Medals** (awarded in-run, listed on the card):

| Medal | Criterion |
|---|---|
| **Needle** | 5 headshots in a row (consecutive hits, first bullets). |
| **Cold Open** | 5 first-bullet kills in a row. |
| **Planted** | 10 kills in a run with no moving shot. |
| **Hairline** | A first-bullet headshot within 0.15° of head centre on an Echo that was moving. |
| **Pendulum** | ≥ 85% time on target for 2 s against a strafing Echo. |
| **Thread** | A spray of 8+ bullets in a fight where every bullet after the 3rd lands within the body-or-head zone. |
| **Quick Study** | Median time to shot lower than your 20-run median by 10% (once per run). |
| **Clean Corner** | 5 contacts in one run cleared with no damage. |
| **Untouched** | A contact of 3+ Echoes cleared without taking damage. |
| **Flawless** | A sector with no miss and no moving shot. |
| **Closer** | The Finale cleared. |
| **Cashed** | Left Overtime alive with unbanked points, at least once. |
| **Ascent** | Rank up to a new sub-tier. |
| **Retained** | A cold opener whose trend reports "Improved" (section 8.5); at most once per 7 days. |

(Metronome, a drill-rhythm medal, is retired with the drills.)

- **Persistence**: all progress lives in `localStorage` as one versioned save object with a manual export/import JSON file. No accounts, no telemetry.
- **Ratings and tiers are practice performance**: they say where the Echoes are set and they move within a session. Whether the player *learned* is the cold opener's job (section 8.5).

### 8.5 The cold opener: learning, measured inside play

Ratings are measured inside a session, after warm-up, on an adaptive dial, so they climb within an evening whether or not anything was learned. The progress claim therefore comes from one cold, comparable measurement a day (`docs/research/transfer.md` §3, §5). v1 made that a separate fixed run, the Daily Baseline; under vision principle 10 a routine repeated daily is exactly what Flickline must not ask for, so the measurement moves **inside the first sector of the day**. The player plays a run as always; the game measures the start of it.

- **When**: the Opener of the first run after at least 8 hours without a finished run is the **cold opener**. It is always also a clean opener (section 7.4). Only the first one of a calendar day enters the trend. After the run, one optional key answers "Aimed in any game in the last hour?"; a yes marks it **warm** and keeps it out of the trend.
- **What**: a cold opener is an ordinary Opener drawn from a **calibrated pool** instead of the open sampler: each of six **levels** (dial 15, 30, 45, 60, 75, 90) has a stored set of about 30 opener contacts (sector, card, Echo placements, Echo personality seeds and profile at that level), generated once from a fixed generator seed and checked in as data. Each day the run's seed picks 4 to 6 of them, in a shuffled order and mirrored left or right, from at least two maps. Every cold opener at a level is therefore equally hard on average while no two days look alike and none can be memorised; it plays like any other Opener and leads straight into sector 2. No adaptation inside it. Its level moves only after 3 of 5 cold openers above 85% or below 35% contact wins (as `transfer.md` §5.3).
- **The number**: per skill, an estimate from the cold opener's trials alone (flat prior, `s = 9`), independent of the matched posterior; the **cold score** is their mean on the rating scale, plus the raw facts kept for comparison within a level (first-bullet head rate, median time to shot, moving-shot share, contacts won and HP kept). Fewer and noisier trials than the 40-trial Baseline it replaces, so one cold opener is good to about ±5 dial points (HYPOTHESIS, to be measured by the bot harness before the verdict is shown), and the trend window widens to match (below).
- **The verdict**: the mean of the last `k` valid cold openers against the `k` before (`k` up to 10, at least 4), with a noise band from the player's own day-to-day spread (`transfer.md` §5.6). "**Improved**" only beyond the band, otherwise "**Steady**" or "**Lower**". It is the headline of the profile (section 9.5) and earns the Retained medal.
- **Reference check-in** (optional, weekly, local only): the player types their reference-game shooting-test scores and 20-match headshot % (`docs/research/transfer.md` §6); the profile shows them beside the cold-opener trend and claims nothing about the relationship. Nothing is ever sent anywhere.
- **Guards** (`transfer.md` §5.8, unchanged in kind): a change to the pool or to the dial axes it uses bumps the cold-opener version and starts a new series; "taken X of the last 14 days" is shown; a sensitivity change is marked on the trend; no verdict before 8 valid cold openers.
- Built by re-scoping [#150](https://github.com/omkarbhale/flickline/issues/150) (the pool and the cold opener), [#151](https://github.com/omkarbhale/flickline/issues/151) (estimate, series and trend), [#153](https://github.com/omkarbhale/flickline/issues/153) (results card and profile headline) and [#154](https://github.com/omkarbhale/flickline/issues/154) (reference check-in).

---

## 9. Skill matching

### 9.1 The model

Each skill has a latent ability `θ` on the same 0–100 **dial** scale as difficulty (rating = 30 × dial). Every trial a contact produces (section 3.1) is an **item** with a difficulty `d` that is a function of the dial settings in force when its Echo was placed and of its scenario card. The probability that a player at ability `θ` succeeds on an item of difficulty `d` is `p = σ((θ − d)/s)` with `s = 9` (tunable). We keep a **grid posterior** over θ ∈ {0, 0.5, …, 100} (201 points; a few hundred multiplies per update, irrelevant to performance), updated after every trial with the logistic likelihood. The rating shown is the posterior mean; the posterior standard deviation is the **confidence**, shown as a band.

An item's **trial type** is one of its properties, next to its difficulty: *pre-aimed* (the crosshair is already within about 2° of where the target appears) or *must-flick* (the crosshair has to move). Their feasible times differ, so the model never compares a pre-aimed 0.45 s trial with a 135° flick as the same kind of item (#12 P4). How the type enters the likelihood (a difficulty offset or its own scale) is for the skill model (#17); bait peeks (shoulder, jiggle and hop peeks the player lets pass) are not items at all (#12 P3).

### 9.2 The first run: placing a player inside play

Priors: a one-tap self-report on the first panel ("New to shooters / Some / Experienced / Competitive") sets the prior mean to dial 15 / 35 / 55 / 75 (skippable → 40), standard deviation 25.

There is no placement test. A new player's first **Opener** is longer (four to six short contacts instead of one or two) and is run on an adaptive **staircase** between contacts: the next contact's dial goes up after 2 consecutive contacts won without losing more than half the shield, and down after 1 lost, starting step 16 and halving at each reversal (16 → 8 → 4), the rule that converges near the 70% point. The contacts are the gentlest cards (`take-unaware`, `clear`, `hold`) with single Echoes, so each one is short and readable. The staircase updates the shared posterior through the contacts' trials as every fight does; the correlation prior spreads the estimate to all seven skills (a flick estimate moves precision's prior by 40%), and each skill sharpens as the run exercises it. Expected accuracy after the first run: about ±8 dial points (HYPOTHESIS: fewer, noisier trials than the 45-second Placement run it replaces; checked by the simulated-player harness, section 9.6).

### 9.3 Steady state: keeping the edge without rubber-banding

1. **Target success rate 70%**: the dial for the next stretch is `θ_est − s × ln(0.7/0.3)` ≈ `θ_est − 7.6`, chosen so the *expected* success rate is 0.70. The target is for **contacts won**; trial types may set their own target in data, but it must stay inside the 60–80% flow band (the edge meter's shaded zone, §9.5): the drills' first-bullet-headshot trial was set to 0.55 at first, settled below the band with most failures being timeouts, and was moved to 0.70 (#170).
2. **Difficulty is a function of the posterior and a pre-planned wave curve, never of the last few shots.** A run changes its dial only at **sector boundaries**, by at most ±3 points per sector from the posterior, and the run's depth curve (section 4.1: Opener −8, build, Finale +6, breather in sector 5) is applied around it. A streak of misses does not make the next target easier; a streak of hits does not instantly spike difficulty. The player sees structure, not a fight against their score.
3. **Asymmetric update**: the posterior reacts faster upward than downward (likelihood scale `s` 8 for successes, 10 for failures) so a few lucky hits are not rewarded by a brutal jump, and a bad evening does not collapse the rating.
4. **No hidden handicaps**: the score table's `difficulty` factor means an easier dial does not hand out free points; run bests are per dial band.
5. **Fairness floors** (*adopted from #12 P6 and #52 R8 in #130*): tell ≥ 0.25 s; exposure ≥ 0.45 s for any timed target (the pre-aimed minimum), and any exposure ≥ the minimum feasible time, reaction plus the aiming movement it asks for (about 1.25 s for a 135° relocation, 0.8 s for a small adjustment, #12 §4.1); exposure is measured from when the target becomes visible (`targetVisible`), never from its spawn, so an off-screen spawn does not eat the clock (#143); target size never below the spec's real head size; enemy reaction ≥ 0.25 s; **no target spawns (or becomes armed) closer than 4 m in any direction, and none inside the view cone (±51.5°, half the 103° FOV) closer than 5 m** (no point-blank ambush; a target behind you at 2 m is just as unreactable as one in front). The 4 m rule also binds Echoes that walk closer, such as arrivals in hold sectors (#32, #204). The reaction and tell floors protect the player from an enemy they **surprised**. A **prepared** holder (one that expects the player at this spot) is bound only by a 0.15 s reaction floor and never holds fire for a tell, because flooring it would let a wide swing beat a pre-aimed angle, the opposite of the reference game (#127, `docs/research/prepared-holders.md`).
6. **Pin difficulty** (setting): fixes the run's base dial to a value you choose, for fair comparison with a friend on the same seed; matched adaptation is the default.

### 9.4 Where each difficulty axis goes

The dial 0–100 maps to these axes (linear unless marked geometric ("g")):

| Axis | Dial 0 | Dial 100 | Applies to |
|---|---|---|---|
| Distance (m) | 5 | 35 (g); 50 m only as a fixed-distance option, never a dial value | Every Echo placement |
| Strafe speed (m/s) | 2.0 | 5.4 | Strafer |
| Strafe leg interval (s) / stand-still window (s) | 1.0 / 0.4 | 0.35 / 0.25 (after the 0.16 s decel) | Strafer |
| Exposure, pre-aimed timed targets (s) | 3.0 (g) | 0.45 | Any timed exposure without its own curve (an Echo's peek) |
| Exposure, Peeker wide peek (s) | 1.4 (g) | 0.45 | Sweep |
| Exposure, Gnat (s) | 1.5 | 0.6 | Sweep (axis added with the Gnat) |
| Enemy reaction (s) / tell (s) | 1.2 / 0.7 | 0.3 / 0.30 | Sweep |
| Tell cue strength (head-node flare, laser, tone; the windup is not scaled) | 1 up to dial 35 | 0 from dial 60 | Sweep (section 7.4) |
| Enemy hit chance at standstill | 0.15 | 0.6 | Sweep (a calibration target, §5.3) |
| Density (Echoes per contact) | 1 | 4 (step; the Finale and Overtime may reach 6) | Sweep |

The drill-only axes of v1 (Beacon scale, flick angle range, the Strafer time limit, and the Orbit, Cold Start and Stop & Pop exposure curves) are retired with the drills (section 4.10) and leave `config/dial.ts` in the retirement refactor; the reasoning below still governs the Echo axes. *Adopted from research #12 (§4, P5) and #52 (R8) in #130.* Why the dial-100 values moved: a 50 m head (0.32°) sits inside the first-shot spread cone, so success there measures luck; 90–180° flicks are mostly off-screen, found by sound rather than sight, with no evidence behind them; a 0.20 s stand-still and a 0.18 s tell are shorter than mean simple reaction time (0.218 s); and one 0.45 s exposure for every target cannot cover a flick (a 135° flick onto a real-size head needs about 1.25 s). An item that no ability can pass pushes success towards zero at high dials, so the posterior saturates below the top tiers and strong players are mis-rated. Exposure therefore has one curve per mode, each about 1.3× the minimum feasible time (reaction plus aiming movement for the mode's angles and sizes, #12 §4.1). These end points are starting values; the balance pass (#53) tunes them against human data.

### 9.5 Showing the estimate to the player

- **Before a run**: the Play panel shows "Matched to you: Cobalt II · dial 51", with a one-line explanation on hover: "Echoes are set so you win about 7 fights in 10."
- **After a run**: rating, delta, tier, progress bar (section 8.2).
- **Skill profile screen** (from the menu): headed by the **cold-opener trend** (section 8.5): the verdict line, the noise band, "taken X of the last 14 days", the warm-up gap (today's cold opener against today's best matched rating) and, if the player uses it, the reference check-in beside it. Below it, labelled "matched rating: where your targets are set": a seven-axis radar, each axis with tier badge, rating, a shaded confidence band, and a sparkline of the last 20 runs; the weakest axis is highlighted. Beside it, the **situation records** (section 8.4) and the run records.
- **While playing**: a thin **edge meter** in the HUD corner shows the rolling contact win rate (target zone 60–80% shaded); outside the zone it just shows the number. It is purely informational.

### 9.6 Verification

A pure module with unit tests and a simulated-player harness (backlog): simulated players of known ability must converge to within ±8 dial points by the end of their first Opener and ±4 after three runs, and keep a contact win rate within 60–80% over a 30-minute session at stable ability, with no oscillation larger than ±4 dial points. This runs in CI in seconds.

---

## 10. Maps

Compact, original arenas. Distances are chosen from what actually happens in the reference genre: most duels at 5–25 m, long angles to about 35–45 m, doorways about 2 m wide, lanes 3–6 m wide. Heights come from the spec's body numbers (standing 1.80 m, crouched 1.30 m): **low cover** ≈ 1.0 m (hides a crouched player), **half cover** ≈ 1.3 m (head and shoulders show on a standing player only if they lean), **full cover** ≥ 2.0 m (hides a standing player).

### 10.1 Maps and their sectors

A map is a set of **sectors** (section 4.2). A run's route chains sectors across maps: walking through a gate door moves the player to the next sector's entry, loading that map if it is a different one (maps are small JSON files and procedural meshes; target ≤ 150 ms behind a short fade, measured by the perf harness). More maps mean more routes, so each new map multiplies variety rather than adding one more place.

| Map | Footprint | Sectors | Features |
|---|---|---|---|
| **Range** | 54 × 24 m hall, 8 m ceiling | None: the **Lobby** behind the menu. | Open floor, three pillars, distance ticks every 5 m, Beacons drifting; nothing scored. |
| **Elbow** | 26 × 26 m | 3 take sectors (from its ten checkpoints and six peek spots), 1 hold sector. | L-shaped corridors, three doorways, crate stacks at low/half/full heights, close (5–8 m), mid (12–16 m) and long (22–26 m) angles. |
| **Lane** | 6 × 30 m corridor | 1 meet sector, 1 take sector. | Five alternating half-wall stops; the drill-only start line and "armed" stripe are retired. |
| **Foundry** | 38 × 34 m, 9 m ceiling | 4 sectors (one per lane plus the catwalk), the default Finale. | Three lanes (long flank, mid courtyard with pillars, short flank), a 3 m high catwalk, six approach gates, sightlines 8–22 m typical, 32 m max, cover at all three heights. |

First release: Elbow, Lane and Foundry as sector maps (about 12 sectors, so a six-sector run rarely repeats its route). Later: **Stack** (a container yard) and more; a new sector map is the cheapest way to add replay value.

### 10.2 Maps as data

Maps extend the foundation's `LevelDef` (`src/sim/levels.ts`: `boxes`, `spawn`, `targets`). Each map is one JSON file under `src/sim/levels/` (so the lint CLI runs without a build), loaded through a typed loader into `LevelDef` plus the additions below. A schema validator and a **map lint** CLI run in CI in under two seconds (checks: all anchors inside bounds, nav graph connected, every checkpoint reachable, every `peek` anchor has a line of sight to the checkpoint it serves, no box overlaps larger than a tolerance, sightline length report). Simulation collision uses axis-aligned boxes only (no meshes) plus **ramps**: a box tagged `ramp` with `ramp: {rise: "+x"|"-x"|"+z"|"-z", lowY}` is the box cut by one sloped plane (surface from `lowY` at the low face up to the box's top at the high face). A grounded player steps up ledges and stair risers of at most `movement.stepHeight` (0.35 m), rides ramps at unchanged horizontal speed, and sticks to the ground when it falls away by no more than a step (spec 2.7); enemies use the same movement code. The map lint also checks that every ramp is no steeper than `movement.maxWalkableSlopeDeg`, that its low end meets a walkable floor, that nav edges are walkable over stairs and ramps, and that every raised or sunken anchor, nav node, checkpoint and lane end is reachable on foot from the spawn (stairs: stack one box per step rather than nesting slabs, so boxes do not overlap). The renderer builds instanced meshes from the same boxes plus trim (a ramp is a wedge).

```ts
// Sketch. The architecture issue's types win on naming; the structure stays.
interface MapDef extends LevelDef {           // LevelDef already has boxes (AABB + tag), spawn, targets
  schema: 1; id: string; name: string;
  bounds: { min: Vec3; max: Vec3 };
  anchors: Anchor[];     // where the run director may place things; typed
  nav: { nodes: { id: string; pos: Vec3 }[]; edges: [string, string][] };
  lanes?: { id: string; start: Vec3; end: Vec3; width: number }[];
  checkpoints?: { id: string; pos: Vec3; angleAnchors: string[] }[];
  sectors?: { id: string; role: ('take'|'hold'|'meet')[]; region: { min: Vec3; max: Vec3 };
              entry: Vec3; exit: Vec3; holdAnchors: string[]; approaches?: string[] }[];  // section 4.2; holdAnchors name 'hold' or 'peek' anchors, approaches name `lanes`
  look: { sky: string; fog: [number, number]; palette: string };
}
// BoxDef.tag: 'floor'|'wall'|'cover'|'trim'|'glass'
type Anchor =
  | { id: string; kind: 'post'; pos: Vec3; yaw: number; stance?: 'stand'|'crouch' }
  | { id: string; kind: 'beacon-shell'; centre: Vec3; rMin: number; rMax: number }
  | { id: string; kind: 'strafe-lane'; a: Vec3; b: Vec3 }
  | { id: string; kind: 'peek'; cover: string; hold: Vec3; out: Vec3; pattern: 'shoulder'|'wide'|'jiggle'|'hop' }
  | { id: string; kind: 'gate'; pos: Vec3; yaw: number }      // enemy spawn
  | { id: string; kind: 'drone-volume'; min: Vec3; max: Vec3 }
  | { id: string; kind: 'hold'; pos: Vec3; yaw: number; stance?: 'stand'|'crouch' };  // where a sector places an Echo; separate from 'post' so the drills never pick it up
```

Coordinates are metres, Y up. The run director picks sectors by role and anchors by tag and distance band; nothing else in the code knows a map's contents. The map lint also checks every sector: entry and exit reachable from each other on foot without leaving the region, every hold anchor inside the region, in a take sector every hold anchor out of sight of the entry at standing eye height (so a take sector never opens with an enemy already in view; the Echo's head, torso and legs are all tested, for its stance), every approach lane reaching the region on foot, and sector regions that do not overlap. `npm run map-lint` reports each sector's longest sightline; `__flickline.mapPlan()` draws a top-down plan of a map's sectors (`docs/screenshots/maps/*-sectors.png`).

---

## 11. Look

**Direction: "Lightline."** Dark, cool, low-detail environments drawn with thin bright **lines of light** along edges (the name), and warm, saturated, luminous Echoes that are always the highest-contrast thing on screen. It should look like a clean, glowing training facility at night, and be nearly free to render.

- **Environment**: flat-shaded boxes with vertex-colour gradients (darker at the floor edge, lighter high up); emissive trim lines along box edges (a screen-space-thin bright edge via geometry, not post); a procedural, derivative-antialiased grid floor with 5 m distance ticks; distance fog to the background colour; a gradient sky with a faint horizon glow. One directional light, **no real-time shadows** (a soft blob decal under each Echo and each pillar). No normal maps, no textures: all procedural, so zero asset downloads.
- **Palette tokens** (defined once in a shared `palette` module): `ink #0B0D14` (background), `slate #151A26`, `steel #26304A` (cover), `trim #38E8FF` (accent and UI), `ember #FF7A4D` (default Echo; was #FF5A36, which cannot reach 7:1 against any surface, even pure black gives 6.77:1; see `src/config/palette.ts`), `core #FFF1D6` (head node), `gold #FFD23F` (headshot), `ok #5BF2A5`, `warn #B58CFF` (moving shot; violet, was amber #FFB020, which is nearly identical to gold under deuteranopia: delta E 7.9, #52 R15), `alert #FF3D5A` (damage). All pairs meet at least 4.5:1 contrast for text/hud use and Echoes meet at least 7:1 against every rendered environment surface (the environment is only ever darker than its palette colour, `palette.env`; thin trim and grid lines are dimmer than an Echo). Under all four colour-vision simulations (normal, protan, deutan, tritan) every Echo body stays at least 4.5:1 and every head node at least 7:1 against those surfaces, and `warn` and `gold` stay at least delta E 20 apart (#52 R13/R15, adopted in #130; `src/config/palette.test.ts` runs the check, so `docs/research/cvd_check.py` no longer has to be remembered). R13's brighter Ember (#FF8A5C) is not needed: #FF7A4D with the darkened environment already passes.
- **Echo shader** (custom `ShaderMaterial`, shared by all enemy types): unlit flat colour plus fresnel rim in the Echo colour, a brighter head node, hit flash (60 ms white), a death **dissolve/shatter** (instanced shard quads), and an outline option (inverted-hull, off at Low).
- **Enemy colour presets** (accessibility and personal visibility): Ember (default), Magenta, Lime, Amber, and "Contrast" (white with a black outline). Amber no longer shares a colour with the moving-shot cue (#52 R14 resolved by R15). Silhouette and brightness carry the information; colour is not the only cue (shape differs per type).
- **Effects**: tracers are camera-facing quad strips; impacts are instanced billboards; shards are instanced quads with a vertex shader doing the motion (no CPU per shard); hit pulse is a 3-frame screen-edge shader.
- **Post** (first release, behind the quality preset): a cheap single-pass bloom on emissive (downsample ×4, threshold on a luminance pass; no mip-chain), vignette (stronger on damage), optional 3-frame chromatic aberration on kills (off by default; **Reduce flashing** setting disables it and all pulses). As built (#44): bloom is a 4-tap threshold on the peak channel into a quarter-resolution target (High adds a separable 5-tap blur there), and one full-resolution composite pass adds the clamped bloom, the vignette with its damage mode (which replaces the HUD's CSS damage vignette where it runs, i.e. at High) and the chromatic split. The bloom halo is capped and the vignette corner floored so an Echo keeps ≥ 4.5:1 against every surface under both (`config/post.ts`, tested); the 7:1 guarantee is for un-haloed surfaces. "≤ 1 / ≤ 3 full-screen passes" counts native-resolution passes; quarter-resolution passes are listed separately in the overlay (Medium 1 + 1, High 1 + 3). The chromatic kill pulse is the `chromaticPulse` setting (default off; High only; 50 ms; rate-limited like the other pulses).
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
                  [ Sector 3/6 ×1.4 ]  [ Score ·  ×mult ]  [ pace vs best run ]
                       chain  streak ring
 [stat strip:                          +  (crosshair)
  Acc 74% · HS 38% ·
  TTS 182ms · TTK 0.41s ·                       
  Moving 3]                                    [SH ▮▮▮▮▯▯▯▯ / HP ▮▮▮▮▮▮▯▯]
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
| **Gameplay** | **Coaching cues** (violet moving-shot tracer, `⇆` glyph, miss ghost; on by default for learning, off for a pure reference-like view), **Fade cues as I improve** (default on), **Clean opener each session** (default on; section 7.4), show damage numbers, stat strip items, HUD scale, difficulty pin (section 9.3). |
| **Data** | Export/import save (JSON), reset progress (confirm), reference check-in prompt (on by default; section 8.5). |

Settings persist immediately and apply live.

### 13.4 First-run experience (target: shooting in ≤ 10 s)

1. The page opens on the **Lobby** (the Range) with Beacons drifting ahead and the crosshair visible. A single panel, bottom-centre: **Sensitivity** (prefilled with a sensible default, one numeric field, "reference scale"), **Self-report** chips (New · Some · Experienced · Competitive), and **Play**. Clicking the canvas instead locks the pointer in the Lobby so the player can try their sensitivity on the Beacons; nothing there is scored, and `Enter` starts the run from there too.
2. **Play** enters pointer lock and starts the first run immediately: a long, gentle Opener on a staircase (section 9.2); no countdown and no tutorial text. One in-world hint per new idea, each shown once: "Stop to shoot" the first time a moving shot misses, "Walk to stay quiet" the first time an Echo hears the player, "Pick a door" at the first gate.
3. The first results card shows the run and the player's first rating. `Enter` starts the next run.
4. Pointer lock lost (Esc, alt-tab): the pause menu opens with `Click to resume`, **New run** and **Menu**.
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
contactSettled { contactId, outcome: 'cleared'|'disengaged'|'avoided'|'died', kept, enemies, points, card }
medalAwarded { id }                       skillTrial { skill, itemDifficulty, success, rtMs?, extra }
sectorEntered { sectorId, mapId, index, of, role, condition, stake, dial, depth, contacts, echoes }    sectorEnded { sectorId, index, cleared, keptSector, tempo: boolean, points, clearPoints, reason: 'exit'|'death'|'quit' }
gateChosen { index, door: 0|1, stake, role, heard }               runBanked { points, overtimeSectors }   (a Leave gate)
```

`runEnded.reason` gains `'left'` (a Leave gate; in v0, #201, the last sector's exit); `'timer'` is retired with the drills. A run's `mode` is `sweep`; the cold opener is flagged on `sectorEntered` (`condition: 'cold'`), not as a mode.

Event naming follows the architecture issue: camelCase past-tense facts, plain-data read-only payloads valid only during the callback, no allocation on emit. Each owner declares its event map next to its code and merges it into the open `GameEvents` interface (`core/gameEvents.ts`) with `declare module`; no shared list is edited.

The stat tracker is a pure function of this log; the HUD and the results card render from it; nothing computes accuracy in the UI.

### 14.4 Tunables

All numbers in this document that are marked tunable live in the typed `config/` files composed by `config/tunables.ts` (one file per area; a new area such as `sweep` is a new `config/<area>.ts` that exports `tunableGroups` and merges its type into `Tunables`, with no edit to a shared file). Weapon, movement, view and damage numbers are a data change that applies `docs/mechanics-spec.md` §7 (archetype ids such as `rifle_spray`). A change in the table must never require a code change.

### 14.5 Persistence

One versioned `save` object (`version`, `profile` (self-report, sensitivity), `ratings` (posterior grids per skill, compact), `medals`, `history` (last 200 runs, summary stats only), `coldOpeners` (every cold-opener record, compact) and `coldOpenerLevels` (section 8.5), `runBests` and `situations` (section 8.4), `checkins` (reference check-ins, never sent anywhere), `settings`), stored in `localStorage` under `flickline.save.v1` (separate from the foundation's `flickline.settings.v1`) with a migration function per version and JSON export/import. As built (#38, #217): `progress/` holds the save (`ratings`, `ranks`, `runBests` per dial band (the best run's score, depth, seed, date, route strip and its total at the end of each sector, which is what the pace bar compares with; the deepest run; Finales cleared), `dailyBests` per date, `situations` (the last 50 settled contacts per scenario card: won or not, and the health kept; a contact nobody contested is not recorded, and a disengaged one counts as not won), `drillBests` (the version-2 per-mode bests, read-only history that nothing writes any more), `medals`, `history`, `plays`, `flaggedSkill`, plus empty slots for `coldOpeners`, `coldOpenerLevels`, `checkins`); the settings and profile keep their own keys and the export file wraps them around the save (version 3; the v2 → v3 migration keeps the drill bests, starts the run bests empty and renames the Baseline slots). A quit run records nothing but its contacts. Rank-ups are immediate and demotion needs two runs (`config/progress.ts`); Ascent is a new peak sub-tier.

### 14.6 Where the code lives

Aligned with the layout and layering rule in the architecture issue (#54). Pure directories import no three.js, no DOM, no `Math.random`, no wall clock.

| Part | Directory | Pure? |
|---|---|---|
| Weapon sim, enemy FSMs and hit zones, player damage and tagging, movement, map data and loader | `sim/` (+ `sim/levels/*.json`) | yes |
| Run state machine, mode framework, the run director, sectors, gates and the scenario sampler | `modes/` | yes (add to the architecture test's pure list in the same PR) |
| Stats, scoring, streaks, medals, fix engine | `feedback/` | yes |
| Skill model, dial mapping, staircase | `adaptive/` (implements and extends `DifficultyModel`) | yes |
| Save object, PBs, rank state (injected storage) | new `progress/` | yes |
| Crosshair, HUD, hit markers, callouts | `hud/` | no |
| Menus, settings, results card, profile screen | `ui/` | no |
| Echo shader, look, post, viewmodels, effects | `render/` | no |
| Synthesis and cue wiring | `audio/` | no |
| Bot harness, perf harness | `debug/` (and `scripts/`) | no |
| Spec conformance suite: spec snapshot, rows, `docs/conformance.md` (`npm run conformance`) | `conformance/` (and `scripts/conformance.mjs`) | yes (reads files only in the script and the tests) |

### 14.7 Four quality tracks: numbers, feel, fun, transfer

Four different questions are asked of the game, tracked in four separate long-lived issues and judged in four different ways. They are never merged into one score, because they fail independently: the numbers can match exactly while the recoil, sounds or hit response feel different from the reference game, a game can have exact numbers and a faithful feel and still be dull, and a game can pass all three while the player's reference-game play does not move.

| Track | Question | Judged by | Tracking issue |
|---|---|---|---|
| **Numbers conformance** | Does every implemented mechanic value and measurable behaviour equal `docs/mechanics-spec.md`? | Automated first. A conformance suite and a generated conformance table, `docs/conformance.md`: one row per spec value or behaviour with the spec value and section, the implemented value, the test, and a status (match / deviation with a written reason / not implemented yet / placeholder-or-estimate flagged by the spec). Pass: every in-scope value has a row, zero unexplained mismatches. | [#61](https://github.com/omkarbhale/flickline/issues/61) |
| **Feel similarity** | Independent of the numbers, do recoil, movement, shot sounds, hit and kill sounds, hit response and timing feel like the reference game? | Looked-at and listened-to passes scored against a written checklist, `docs/feel-checklist.md`: items per area (recoil feel, movement feel, shot sounds, hit and kill sounds, hit response, timing, view), each scored 0/1/2 with evidence (frame captures, audio renders and measurements, latency numbers). Pass: a percentage of points, a floor per area, no critical zero. | [#62](https://github.com/omkarbhale/flickline/issues/62) |
| **Fun** | Is it compelling to play: does it pull you into another run, hold you at the edge of your ability, and reward good mechanics clearly? | Playtest passes following `docs/fun-criteria.md`: a fixed human question set, measured proxies (restart friction, edge-of-ability success rate, dead-air gaps, reward cadence) and an explicit **repeat-enjoyment verdict**: do players start another run because they want to, and come back on another day without being asked (vision principle 10)? | [#63](https://github.com/omkarbhale/flickline/issues/63) |
| **Transfer** | Does skill earned here carry over to the reference game, and does every situation teach only habits that are also right there? | `docs/transfer-checklist.md`: a habit review per situation, sector role, condition and reward (items scored *same* / *different but harmless* / *harmful*, harmful being a bug), the cold opener's bot tests and data (section 8.5), and the transfer pilot's verdict. Pass: per phase, no open critical harmful habit and learning measured honestly; transfer itself is claimed only by a study large enough to show it. | [#149](https://github.com/omkarbhale/flickline/issues/149) |

Rules that keep the four honest:

- **Feel is judged against descriptions, never assets.** The checklist describes behaviours, relationships and timings in our own words. No reference audio, video or image is copied, recorded, ripped, embedded or used as a synthesis target (section 16). Sounds stay synthesised from code and are tuned until the checklist items pass.
- **Numbers belong to the spec, not to the feel pass.** Tuning for feel changes presentation parameters (viewmodel kick curves, hit-marker timing, synthesis parameters, flinch and tagging presentation), never a value that has a row in the conformance table. If feel can only be reached by changing such a value, that is an issue on the numbers track.
- **Conflicts are filed, not silently resolved.** Mechanical truth (pillar 1) outranks fun for everything inside the mechanics; fun outranks feel-polish for everything around the mechanics (pacing, rewards, results flow).
- **A harmful habit is a mechanical-truth defect.** A situation or game layer that rewards a habit that fails in the reference game is fixed where it arises, however fun it is; the mechanics' numbers stay the spec's.
- **Every playtest pass reports the four verdicts separately**, in four sections of its report, each also posted on its tracking issue; every defect is filed with the matching `quality:numbers`, `quality:feel`, `quality:fun` or `quality:transfer` label.
- Owners: the conformance suite [#64](https://github.com/omkarbhale/flickline/issues/64), the feel checklist [#65](https://github.com/omkarbhale/flickline/issues/65) and feel tuning [#67](https://github.com/omkarbhale/flickline/issues/67), the fun criteria [#66](https://github.com/omkarbhale/flickline/issues/66) and fun tuning [#68](https://github.com/omkarbhale/flickline/issues/68), the transfer checklist and research (`docs/transfer-checklist.md`, `docs/research/transfer.md`, from [#128](https://github.com/omkarbhale/flickline/issues/128)) with the first habit review [#160](https://github.com/omkarbhale/flickline/issues/160) and the transfer pilot [#158](https://github.com/omkarbhale/flickline/issues/158); the playtests are [#29](https://github.com/omkarbhale/flickline/issues/29) and [#56](https://github.com/omkarbhale/flickline/issues/56).

---

## 15. Scope

### First playable (the earliest build that proves the game)

Re-scoped by #187: the first playable proves **the game**, not the drills. A build someone can play from a link in which **Play** starts a Sweep run: take sectors on Elbow and Lane with placed, shooting Strafers and Peekers drawn from a first set of scenario cards; health and shield carried from fight to fight with kill-heal; contact settles, sector clears and a run score; the run's results card; the skill model fed by the contacts' trials; a new run on a new seed in ≤ 250 ms. It stands on the foundation already built for v1's first playable: Pace and Kestrel on the spec's numbers, the full per-shot feedback of section 7.1, synthesised sounds, crosshair editor, sensitivity in the reference scale, the live HUD, the bot and perf harnesses, and the conformance suite and the feel and fun checklists. The drills leave the menu. A looked-at playtest reports numbers, feel, fun and transfer separately, and the fun verdict includes repeat enjoyment.

### First release

Everything in sections 4–13: six-sector runs with take, hold and meet sectors, gates and door stakes, tempo, conditions, Overtime and the Daily Route; Elbow, Lane and Foundry as sector maps; four weapons (Pace, Kestrel, Vane, Rill); the enemy mind (#70) with the scenario sampler and honest information (#74); seven enemy types; damage and slow-on-hit; the full feedback set including callouts, medals and Surge; fight attribution (#110); the results card with the fix engine and the lean; the profile with situation records and the cold-opener trend; the reference check-in; settings, post effects, viewmodels, UI kit, accessibility options; balance, performance and legal passes; a full playtest with a repeat-enjoyment verdict; and the transfer pilot.

### Later (not scheduled)
Longnail sniper and scoped sensitivity; shotgun; more maps (Stack and others); an in-browser map editor; replays and ghost runs; shareable seed links; online leaderboards for the Daily Route (needs a backend); **Rivals** (an Echo personality that beat you can turn up again in a later run, HYPOTHESIS that a recurring opponent adds pull); generative music; gamepad; desktop wrapper; localisation.

### Explicitly out
Drills, exercise menus and fixed practice routines (vision principle 10); multiplayer, teams, rounds, an objective to plant, abilities, economy and buy phases, accounts, monetisation, mobile and touch input, console, VR, anti-cheat, any aim assist or bullet magnetism, and any content copied from existing games.

---

## 16. Identity and legal line

Flickline copies **mechanics and feel only**: movement speeds and acceleration, counter-strafe timing, accuracy rules, recoil behaviour, damage and slow-on-hit rules, field of view, sensitivity scale. It copies **no** names, characters, abilities, maps, art, audio, logos or interface look from any existing game. Specifically:

- All names are original: Flickline, Echoes, Post, Beacon, Strafer, Peeker, Rusher, Bulwark, Gnat, Pace, Kestrel, Rill, Longnail, Range, Lane, Elbow, Foundry, Sweep, Surge, Lobby, Opener, Finale, Overtime, Daily Route, the door stakes, the tier names, the medal names. Any contributor who adds a name must check it is not a protected name from a known game.
- All art is procedural and original; no textures from any source. All fonts are open-licence and listed in `docs/credits.md` with their licences.
- All audio is synthesised from code written for this project.
- UI is the project's own: dark panels with a single trim colour and thin borders, no resemblance to the reference game's layout, icons, fonts or typographic style.
- References to "the reference game" or "the reference tactical shooter" in project docs are for explaining where numbers come from; the product never names or alludes to it in-game.
- A legal and identity audit (backlog) re-checks all names, assets and licences before the first release.

---

## 17. Backlog

The work is tracked in GitHub issues on `omkarbhale/flickline`; every issue states its goal, the design section it implements, acceptance criteria, dependencies and what is out of scope. Design and backlog tracking: [#8](https://github.com/omkarbhale/flickline/issues/8); the v2 redesign: [#187](https://github.com/omkarbhale/flickline/issues/187), tracked on [#188](https://github.com/omkarbhale/flickline/issues/188).

- Prerequisites outside this backlog: code foundation [#6](https://github.com/omkarbhale/flickline/issues/6) (merged), mechanics spec [#7](https://github.com/omkarbhale/flickline/issues/7) (merged), architecture and conventions [#54](https://github.com/omkarbhale/flickline/issues/54).
- Phase tracking issues: [#9 first playable](https://github.com/omkarbhale/flickline/issues/9), [#10 first release](https://github.com/omkarbhale/flickline/issues/10), [#11 later (parked ideas)](https://github.com/omkarbhale/flickline/issues/11). Their v1 lists are kept there as history; the v2 order below supersedes them.
- Quality tracking issues (long-lived, section 14.7): [#61 numbers conformance](https://github.com/omkarbhale/flickline/issues/61), [#62 feel similarity](https://github.com/omkarbhale/flickline/issues/62), [#63 fun](https://github.com/omkarbhale/flickline/issues/63), [#149 transfer](https://github.com/omkarbhale/flickline/issues/149).

### The order to a replayable game (v2)

The order puts a replayable game on the live link soonest: after step 3, **Play** starts a seeded run of take sectors against shooting Echoes with carried health and a score, and every run differs. Steps without an arrow between them can run in parallel once their dependencies are merged.

0. [#184](https://github.com/omkarbhale/flickline/issues/184) load a map without a page reload (prerequisite of step 2; can run beside step 1)
1. [#200](https://github.com/omkarbhale/flickline/issues/200) sectors in the map schema, Elbow and Lane sectors
2. [#201](https://github.com/omkarbhale/flickline/issues/201) Sweep run v0: take sectors, placed Echoes, carried health, run score
3. [#202](https://github.com/omkarbhale/flickline/issues/202) Play starts a run; drills leave the menu; the first click starts the first run. **Replayable game on the live link.**
4. [#203](https://github.com/omkarbhale/flickline/issues/203) skill matching inside the run · [#213](https://github.com/omkarbhale/flickline/issues/213) run results card · [#205](https://github.com/omkarbhale/flickline/issues/205) gates and route choice
5. [#204](https://github.com/omkarbhale/flickline/issues/204) hold sectors and the Finale · [#211](https://github.com/omkarbhale/flickline/issues/211) retire the drill code
6. [#97](https://github.com/omkarbhale/flickline/issues/97) scenario sampler with [#98](https://github.com/omkarbhale/flickline/issues/98) Echo setup and [#99](https://github.com/omkarbhale/flickline/issues/99) honest audio · [#100](https://github.com/omkarbhale/flickline/issues/100) tempo in take sectors · [#207](https://github.com/omkarbhale/flickline/issues/207) conditions and the primary pick
7. [#214](https://github.com/omkarbhale/flickline/issues/214) repeat-enjoyment playtest (needs steps 3–5)
8. [#206](https://github.com/omkarbhale/flickline/issues/206) Overtime · [#217](https://github.com/omkarbhale/flickline/issues/217) run and situation records · [#208](https://github.com/omkarbhale/flickline/issues/208) Daily Route
9. [#209](https://github.com/omkarbhale/flickline/issues/209) the cold opener, then [#151](https://github.com/omkarbhale/flickline/issues/151), [#153](https://github.com/omkarbhale/flickline/issues/153), [#154](https://github.com/omkarbhale/flickline/issues/154) on it · [#210](https://github.com/omkarbhale/flickline/issues/210) the lean (with [#39](https://github.com/omkarbhale/flickline/issues/39))
10. [#212](https://github.com/omkarbhale/flickline/issues/212) meet sectors (with the mind's body [#87](https://github.com/omkarbhale/flickline/issues/87) and decisions [#91](https://github.com/omkarbhale/flickline/issues/91)) · [#36](https://github.com/omkarbhale/flickline/issues/36) Foundry sectors · [#33](https://github.com/omkarbhale/flickline/issues/33) Rusher, Bulwark and Gnat

Parallel tracks that the redesign keeps as they were: the enemy mind ([#70](https://github.com/omkarbhale/flickline/issues/70): [#86](https://github.com/omkarbhale/flickline/issues/86)–[#96](https://github.com/omkarbhale/flickline/issues/96)), fight attribution ([#110](https://github.com/omkarbhale/flickline/issues/110): [#120](https://github.com/omkarbhale/flickline/issues/120)–[#125](https://github.com/omkarbhale/flickline/issues/125)), the movement model [#73](https://github.com/omkarbhale/flickline/issues/73), the quality yardsticks and passes ([#64](https://github.com/omkarbhale/flickline/issues/64)–[#68](https://github.com/omkarbhale/flickline/issues/68)), the profile [#37](https://github.com/omkarbhale/flickline/issues/37), callouts and medals [#40](https://github.com/omkarbhale/flickline/issues/40), balance [#53](https://github.com/omkarbhale/flickline/issues/53), performance [#55](https://github.com/omkarbhale/flickline/issues/55), the first-release playtest [#56](https://github.com/omkarbhale/flickline/issues/56), the identity audit [#57](https://github.com/omkarbhale/flickline/issues/57), the transfer pilot [#158](https://github.com/omkarbhale/flickline/issues/158) and the first habit review [#160](https://github.com/omkarbhale/flickline/issues/160) (now of the first playable run).

### Closed by the redesign

Superseded or obsolete, each closed with a comment linking its replacement: Switchboard #49, Corner Clear #50, the Sweep flagship #51 (split into the issues above), Vigil #101, cued drill trials #102, Corner Clear cards #103, Orbit's rare flicks #136, the Daily Baseline run #150, Mix runs #157, the practice-schedule experiment #159, and the Cold Start and Placement follow-ups #171–#174, #193, #196. Merged drill modes (Cold Start, Orbit, Placement, Stop & Pop, Strafe Track, Spray Wall) are retired from the code by #211.
