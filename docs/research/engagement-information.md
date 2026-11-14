# Engagement and information: who knows what before a fight, and how Flickline samples fights

Research and design decision for issue #75, part of the long-lived module **#74 (Tracking: information and engagement scenarios)**. Companion document: `docs/research/player-like-enemies.md` (#71, how an enemy behaves *inside* a fight). This document decides *which* fights happen and what each side knows going in.

- Research date: 2026-11-14. Reference game: Valorant ("the reference game"); Counter-Strike evidence is labelled. Evidence tags as in the companion document (High, Med, Low, DERIVED, HYPOTHESIS with confidence).
- Constraint from the design (§1, §15): no rounds, teams, sides, objectives or economy. The pressures those create in the reference game must come from Flickline's own structure.
- This document proposes; it does not edit `docs/design.md`. Changes to existing issues are posted as comments (section 7).

---

## 1. Summary

**Findings**

1. **Fights in the reference game are asymmetric by design.** Riot: "a player holding territory should, on average, have an advantage over a player taking territory"; attackers "typically have to peek from a single entry point" while holders "can watch from multiple angles"; a 10 ms change in peeker's advantage swung one internal matchup to a 90% win rate for the holder (Riot netcode post, High). Who sees whom first, and who expected whom, decides duels more than raw aim.
2. **Someone is always forced to move.** Attackers must take space before the timer (pro teams plant 52–60 s into a 100 s round, Riot VCT 2023 data, High); after a plant the defenders must move in, and retakes mostly fail (22.8–46.4% success by bombsite in CS:GO, Leetify, Med). Movement under pressure, not standing duels, is where most fights start.
3. **Information is coarse and comes from sound, sight and teammates.** Footsteps are tuned "to be heard, not to portray distance", stereo only, with a radius meant to give the listener time to react (Riot, High). Reloads and footsteps are the sounds Riot chose to spatialise (patch 2.06, High). Information tells you *someone is near, roughly where*, rarely the exact spot.
4. **Numbers matter a lot.** One extra player moves round-win probability by about +20 points (CS:GO matchmaking, 400k+ rounds, Med); trades are judged within ~3–5 s windows (Med–Low). Fights are often sequences, not single duels.
5. **Unknown, by search**: opening-duel win rate by role, share of kills from flanks, number of angles per entry, how long players spend in each situation, and any controlled study showing that scenario practice transfers. The ranking in section 3 is therefore reasoned from mechanics evidence, not measured, and is marked as such.

**Decision** (section 4)

- Every fight Flickline presents is described by a **scenario card**: what the player knows, what the enemy knows, how predictable the timing is, who is forced to move, how many enemies and in what arrangement. Modes and the Sweep director **sample** cards from a target mix with coverage and anti-repetition rules; a symmetric, both-know-everything duel is capped at 5% of Sweep fights.
- Information is given and denied only through **honest channels** both sides share: sight, positional sound (running footsteps, landings, shots, reloads; walking is silent) and a coarse, delayed **callout stand-in** that replaces a teammate's call. No markers that the real game does not give.
- Forced movement without objectives comes from **tempo** in Sweep: the arena is cut into sectors; taking the next sector within its tempo window keeps the run's multiplier and decides whether the next contact meets you as a holder (you arrived first) or as a breach (they set up first). Nobody plants anything, there are no sides, and standing still is allowed; it simply makes the next fight harder, exactly as waiting does in the reference game.
- A new drill, **Vigil**, trains the holder's side (the mirror of Corner Clear), and the existing drills gain information variants where they help transfer (cued trials in Orbit and Switchboard, informed and uninformed angles in Corner Clear).
- Results report **fights by situation** so the player sees *where* they lose (for example, "you win 80% of holds but 35% of takes against an expecting enemy").

---

## 2. The variables that define a fight

| Variable | Values | Evidence |
|---|---|---|
| **Player knows enemy position** | none · area (heard, called, timing) · spot (seen earlier, common angle) · visible | Sound gives coarse area (Riot audio, High); common angles are pre-aimed by everyone (coaching, Med) |
| **Enemy knows player position** | unaware · suspects area · knows spot (pre-aimed) | Same; peeker's advantage and holder design intent (Riot, High) |
| **Timing predictability** | known window · rough window · unknown | Plant timing data (Riot, High); foreperiod effects on reaction ~27 ms (Woods 2015, High) |
| **Who must move** | player takes · player holds · both moving · player must enter held space (breach) · nobody | Timer forces attackers; retakes force defenders and mostly fail (Riot, Leetify; High/Med) |
| **Numbers and arrangement** | 1v1 · 1v2 sequential (trade) · 1v2 crossfire · 1vN | Man advantage ~+20 points (Med); trade windows 3–5 s (Med–Low) |
| **Pressure** | none · tempo · low HP · low ammo or reloading | Kill-heal and no regeneration already make HP a pressure (design §4.8) |

A fight where both sides know each other's spot, timing is known, and nobody must move is the **symmetric known duel**. It removes the variables that, per Riot's own measurements, decide real duels (who sees first, whether the other side expected it), so practice in it is almost pure aim and reaction, which the drills already train, and it builds the habit of expecting the enemy where you look. That is why it transfers poorly (the owner's observation) and why it is capped.

---

## 3. Taxonomy of scenarios and their transfer value

Original card names. Ranked by expected transfer (reasoned from mechanics evidence; HYPOTHESIS 50% for the order of ranks 3–8).

| Rank | Card | Player knows | Enemy knows | Who moves | What the player practises | Why it transfers |
|---|---|---|---|---|---|---|
| 1 | **Take: expected** | area | suspects or knows spot | player takes | Peek choice (jiggle for info, wide swing past the pre-aim), stop-shoot, pre-aim common angles | The most common attacker fight; the holder has the designed advantage (Riot), so peek technique decides it |
| 2 | **Hold: unknown timing** | area or none | none or area | enemy takes | Crosshair placement at head height, patience, reacting to wide swings, not over-peeking | Defender's core fight; teaches using the holder's advantage instead of giving it away |
| 3 | **Clear** | area, not the spot | suspects area | player takes | Checking angles one at a time, pre-aim order, off-angle checks | The standard entry: several possible spots, one real one |
| 4 | **Trade** (1v2 sequential) | area | second enemy hears the first fight | both | Re-positioning or re-aiming after a kill; not staying on the angle | Real fights are sequences; ~+20 points per man advantage |
| 5 | **Take: unaware enemy** | spot or area | unaware (looking elsewhere, or reloading) | player takes | Punishing a timing: swing on reload, swing when it looks away | Rewards information use; teaches to take free fights fast |
| 6 | **Meet** (both moving) | none | none | both | Head-height placement while moving, instant counter-strafe | Rotations and mid-map contacts; who stops first wins |
| 7 | **Breach** (enter held space) | area | knows area, set up | player must enter | Using the order of angles, accepting a trade, not giving up | Retakes are forced and mostly lost; practising them limits the loss |
| 8 | **Crossfire** (1v2 at once) | area | both suspect area | player takes | Isolating one angle at a time, not swinging into two | Coaching's top low-rank mistake (swinging into multiple angles) |
| 9 | **Flank** | none | knows spot (from behind or side) | enemy | Sound awareness, turning to a sound; checking behind after a pause | Real but rare; must be honest (audible before it fires) |
| 10 | **Known duel** | spot | spot | nobody | Pure aim and reaction | Least transfer; kept as a small control and a breather |

The drills (Cold Start, Orbit, Strafe Track, Stop & Pop, Spray Wall, Switchboard) are mechanics practice and stay mostly in "known duel" form on purpose; their information variants are in 4.4.

---

## 4. Design

### 4.1 Scenario cards

```ts
// modes/scenario.ts (pure). Sketch; the architecture issue's naming wins.
interface ScenarioCard {
  id: 'take-expected' | 'take-unaware' | 'hold' | 'clear' | 'trade' | 'meet' | 'breach' | 'crossfire' | 'flank' | 'known-duel';
  playerInfo: 'none' | 'area' | 'spot';          // delivered only through honest channels (4.2)
  enemyInfo: 'unaware' | 'area' | 'spot';        // initial beliefs written into each enemy's memory (mind §5.3)
  timing: 'window' | 'rough' | 'unknown';        // spawn/approach delay distribution
  role: 'take' | 'hold' | 'both' | 'breach';     // the player's role; enemies get the complement
  count: 1 | 2 | 3 | 4;
  arrangement: 'single' | 'sequential' | 'crossfire';
}
```

A card is a recipe the mode or director turns into concrete placements (anchors by tag and distance band, design §10.2), enemy roles and beliefs (the mind's `hold`, `clear`, `alert` states with a pre-filled memory entry and expectation), and player-side cues. The card is recorded on every trial (`skillTrial.extra.card`) and on every contact.

### 4.2 Honest information channels

| Channel | Player receives | Enemy receives | Rule |
|---|---|---|---|
| Sight | Line of sight, field of view | Same (mind F1) | Symmetric |
| Footsteps | Positional (HRTF panner) running footsteps and landings within the radius | Same events from the player, same radius, position error by tier | Running is audible, walking and crouch-walking are silent (v1); radii are tunables, chosen per map so the sound gives roughly 1–2 s of warning at run speed (HYPOTHESIS 40%; Riot states the radius exists to give reaction time, no figure) |
| Shots and reloads | Positional | Positional | Reloads are deliberate cues (Riot spatialises them) |
| Callout stand-in | A coarse, delayed cue that stands in for a teammate's call: a short spoken-style chirp plus a soft edge glow on the side of the contact, ±45° direction, 0.6–1.2 s after the enemy was "seen by a teammate" (no teammate model, just the delay) | Enemies share sightings with each other after a delay (mind §5.3) | Used only by cards with `playerInfo: 'area'` when no sound would carry it; never a precise marker, never on the minimap |
| Prior contact | The enemy revealed itself (a jiggle, a shot, a glimpse) | Same | The card can begin with an enemy information peek |

Nothing else: no wall-highlight, no exact last-seen marker, no radar dots. Information that the reference game gives through abilities is out of scope (design §15: no abilities).

### 4.3 Forced movement without objectives: tempo in Sweep

- **Sectors**: Foundry (#36) is divided into four to six sectors along its lanes. At any time one sector is **next** (shown by a quiet floor trim pulse and the HUD's direction chevron).
- **Tempo window**: the next sector has a window (12–25 s, by dial and wave). Arriving inside it: the next contact is generated as a **hold** or **meet** card (you got there first). Arriving after it: the next contact is a **breach** or **crossfire** (they set up first). Arriving very early with an unfinished contact behind you invites a **flank** or **trade**.
- **What tempo pays**: arriving in the window keeps the Surge meter filling and the score multiplier; missing it never costs HP and never ends the run. A player may hold one sector for a whole run; they will meet set-up enemies more often, which is the reference game's real cost of waiting.
- **Why this is not an objective**: there is nothing to plant or carry, no sides and no rounds. It is a pacing and positioning layer, like the director's waves (design §4.8), that creates the *take* and *breach* pressures players face every round in the reference game.

### 4.4 Information variants in the drills

| Mode | Change | Why |
|---|---|---|
| Cold Start (#23) | None: stays uncued, known position. | Its job is pure first-bullet precision. |
| Orbit (#23) | At dial ≥ 30, 25% of Beacons are **cued**: a positional sound 0.4–0.9 s before the target appears; 80% of cues are valid within ±30°, 20% are on the opposite side (an invalid cue). Cue validity is an item property in the skill model (P4 of #12). | Most large flicks in the reference game are to a sound or a teammate's death; invalid cues teach not to over-commit. |
| Strafe Track (#46), Stop & Pop (#47), Spray Wall (#48) | None. | Mechanics only. |
| Switchboard (#49) | Waves above dial 40 may arrive from a side announced by footsteps 0.5–1.0 s earlier; one wave in five is unannounced. | Switching after information, the way trades happen. |
| Corner Clear (#50) | Each checkpoint's angle is a card: `take-expected` (Peekers heard you: they pre-aim), `take-unaware` (one is looking away or reloading), `clear` (two possible spots, one occupied), `crossfire` at high dials. The player's own footsteps decide expected vs unaware when they run into the checkpoint, so walking is rewarded. | The single biggest lever on whether a take is fair or a death trap. |
| **Vigil** (new drill, `angles`, holder's side) | Player holds a position with one to three approach lanes; Peekers take the angle with mind peek patterns; cards `hold` with and without footstep warning, `trade` pairs, occasional `flank` with honest audio. Success: angle held without taking damage. | The holder's fight has no drill today; it is half of all duels and the side Riot designs to win. |
| Sweep (#51) | Director samples cards from the mix in 4.5, tempo decides some cards (4.3). | The flagship should present the real distribution. |

### 4.5 Target mix and sampling rules

Sweep target mix (share of contacts; HYPOTHESIS 40%, tuned by #53 and the playtest):

| Card | Share | Card | Share |
|---|---|---|---|
| Hold | 22% | Meet | 8% |
| Take: expected | 16% | Breach | 6% |
| Clear | 13% | Crossfire | 6% |
| Trade | 12% | Flank | 4% |
| Take: unaware | 8% | Known duel | 5% |

Rules (all seeded, deterministic):

1. **Coverage**: every Sweep run of 2 minutes or more presents at least six distinct cards; every Corner Clear run at least three.
2. **No streaks**: the same card never three times in a row; a flank never follows a flank.
3. **Caps**: known duel ≤ 5% of Sweep contacts; flank ≤ 5%, and only after a contact the player won (never as a punishment).
4. **Tempo overrides** (4.3) change the card *before* the mix is sampled; the mix rebalances over the rest of the run.
5. **Weakness weighting** (after placement): the two cards with the player's lowest win rate over the last 20 contacts gain +50% weight each (never above twice their base share), mirroring the fix engine's "one thing to fix".
6. **Dial interaction**: the dial sets enemy profiles and counts (mind §5.4, design §9.4), never the card mix, so difficulty and situation stay separate variables in the skill model.

### 4.6 Measuring and showing it

- Every trial and contact records its card. Stats per card: fights, win rate, damage taken, time to first shot.
- Results card: a **fights by situation** row (top three cards played, with win rates) and a fix-engine rule such as "you lose most fights when the enemy expects you: walk the last few metres or jiggle before you swing".
- Skill model (#17): card is an item property alongside dial difficulty, so a win in a breach counts for more than a win in a known duel (extends #12's P4).

### 4.7 How to judge the design

- **Bot harness**: the sampler's mix over 1,000 seeded contacts is within ±2 points of the target; coverage and streak rules never violated; information honesty (mind S9) holds per card.
- **Playtest** (#56 and E8 below): after a Sweep run, testers name at least three different situations they fought without prompting; testers report that deaths came from situations they could have played differently; nobody describes Sweep as "the same duel over and over". Mirror test from the companion document applies to enemies.

---

## 5. Open questions and default answers

| # | Question | Default |
|---|---|---|
| 1 | Is tempo an objective in disguise? | No: nothing to carry or plant, no sides, no fail state; it changes which card comes next. Revisit if playtesters describe it as a chore. |
| 2 | Should the callout stand-in exist at all? | Yes, but rare (only `area` cards without a sound) and coarse. It replaces information that teammates give in the reference game. Off switch in settings for purists. |
| 3 | Should drills be informational at all? | Only where the reference game's version of that skill is usually information-triggered (Orbit, Switchboard, Corner Clear). Precision and mechanics drills stay pure. |
| 4 | Are footstep radii symmetric? | Yes, always: the enemy hears you exactly as far as you hear it. |
| 5 | What share of fights should the player start as holder vs taker? | Roughly balanced, as the reference game alternates sides every half: taker-type cards (take, clear, breach, crossfire) 49%, holder-type (hold, flank, and the second fight of a trade) 38%, neutral (meet, known duel) 13%. Tempo shifts this within a run. |

## 6. Build backlog (filed as issues, listed on #74)

| Id (issue) | Issue | Depends on |
|---|---|---|
| E1 (#97) | feat(modes): scenario cards and the seeded scenario sampler | #22 |
| E2 (#98) | feat(enemies): scenario setup — initial enemy beliefs, roles and expectation from a card | E1, mind perception (M3) |
| E3 (#99) | feat(audio): honest information channels — symmetric footstep, landing and reload radii and the callout stand-in | #41, #20 |
| E4 (#100) | feat(modes): Sweep sectors and tempo windows | E1, #36, #51 |
| E5 (#101) | feat(modes): Vigil — hold-the-angle drill | E1, M5/M6, #34 |
| E6 (#102) | feat(modes): cued trials in Orbit and Switchboard | E1, E3, #23, #49 |
| E7 (#103) | feat(modes): Corner Clear angles as scenario cards | E1, E2, #50 |
| E8 (#104) | feat(feedback): fights by situation on the results card and fix engine | E1, #39 |
| E9 (#105) | playtest: scenario variety and information honesty pass | E1–E4 |

M ids refer to the player-like enemy backlog (`docs/research/player-like-enemies.md` §10: M3 #89, M5 #91, M6 #92).

## 7. Changes to existing issues (posted as comments)

- **#22** mode framework: `ScenarioCard` on trials and the sampler hook (E1); card as an item property for scoring.
- **#23** Cold Start, Orbit, Placement: Orbit cued trials (E6); Cold Start unchanged.
- **#46, #47, #48**: no change (pure mechanics drills); noted for completeness.
- **#49** Switchboard: announced and unannounced waves (E6).
- **#50** Corner Clear: angles as cards; player's own footsteps decide expected vs unaware (E7).
- **#51** Sweep: card mix, sampling rules, tempo (E1, E4); director owns card selection.
- **#32, #33**: enemies initialise beliefs and roles from a card (E2); Rusher is the natural `meet`/`take` aggressor, Bulwark the `breach` holder.

## 8. Sources

Fetched 2026-11-14.

- Riot, *Peeking into VALORANT's Netcode*: https://www.riotgames.com/en/news/peeking-valorants-netcode
- Riot, *Ask VALORANT #6* (audio): https://playvalorant.com/en-gb/news/game-updates/ask-valorant-6/
- Riot, patch notes 2.06 (HRTF): https://playvalorant.com/en-us/news/game-updates/valorant-patch-notes-2-06
- Riot, *VALORANT Data Drop: VCT 2023*: https://playvalorant.com/en-gb/news/dev/valorant-data-drop-vct-2023/
- Leetify, *Which bombsite is the easiest to retake?* (CS:GO): https://leetify.com/blog/which-bombsite-is-the-easiest-to-retake/
- cryptm (smabie), CS:GO win probability by players alive (400k+ matchmaking rounds): https://cryptm.org/posts/2020/06/12/csgo.html
- Abios, Valorant H1 2024 map statistics: https://abiosgaming.com/press/valorant-data-statistics/
- HLTV Rating 3.0 (reprint, trade windows): https://www.dust2.us/news/64901/hltv-launches-rating-30
- vlr.gg forum, first-kill definitions (3 s trade window): https://vlr.gg/277233/different-ways-to-approach-first-kills
- Woods et al. 2015 (foreperiod effect): https://pmc.ncbi.nlm.nih.gov/articles/PMC4374455
- Dignitas, common angles and off-angles: https://dignitas.gg/articles/youre-holding-the-wrong-angle-a-valorant-guide ; sound deception: https://dignitas.gg/articles/tricking-your-opponent-via-sound-in-valorant
- Rogers et al. 2024 (aim-trainer reliability, not transfer): https://pmc.ncbi.nlm.nih.gov/articles/PMC10925653
- Searched and not found (stated as gaps): opening-duel win rate by role; kills from flanks; angles per entry; time spent per situation; a controlled transfer study of scenario practice.
