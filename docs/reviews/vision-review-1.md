# Vision review 1

Tracking issue: [#115](https://github.com/omkarbhale/flickline/issues/115). Date: 2026-11-14. Reviewed against [`docs/vision.md`](../vision.md).

This review is a critic's pass over everything that exists so far: the design (`docs/design.md`), the mechanics spec, the four research documents, the issue backlog with its trackers, and the game as it runs on `main` (played at commit `784460c`; every finding re-checked against `45646d9` after #111, #112, #118 and #126 merged). It looks for problems like the three the owner raised unprompted (player-like enemies #70, who-knows-what before a fight #74, attribution of a lost fight #110). It reads everything from the side of a reference-game player who sits down with Flickline for twenty minutes a day to get mechanically better.

Each finding gives its evidence, why it matters for transfer or fun, and either a concrete answer or the experiment that would settle it. Findings are ranked by how much they threaten the vision. They are grouped into three kinds:

- **Gap**: nobody has asked about it.
- **Aimed wrong**: it is planned, but the plan would build the wrong thing.
- **Built short**: it exists, but it falls short of the vision.

## Method

- Read in full: `docs/vision.md`, `docs/design.md`, `docs/research/human-performance.md`, `cues.md`, `player-like-enemies.md` and `engagement-information.md`. From `docs/mechanics-spec.md`, read §1–§6, §8 and §9.
- After it merged mid-review, skimmed `docs/research/fight-attribution.md` (#126) for its summary and baseline sections.
- Read the trackers (#9, #10, #61, #62, #63, #70, #74, #11), the open question #110, and the build issues the findings touch (#23, #30, #51).
- Built `main` with `vite build`, served it with `vite preview`, and played it in headless Chromium through the `window.__flickline` debug hook:
  - the first-run panel;
  - a body hit and a headshot kill on a Post with the Kestrel;
  - a full-speed moving shot.

  I took screenshots of each and looked at them. They are kept with the task data, not in the repo.
- Read the shipped tunables (`src/config/dial.ts`, `src/config/audio.ts`, `src/config/palette.ts`), the movement and collision code, and the open PR #114 (Cold Start, Orbit and the Placement run), which is about to become the first real mode.
- Web checks where a claim needed evidence; they are cited inline.

What `main` is today: a freeplay sandbox on the Range with Posts and Beacons, the Kestrel and the Pace, per-shot feedback and the first-run panel. Its only mode is `test`. While this review was written, player health and damage (#111), the Echo art (#112), the live HUD (#118) and the fight-attribution research (#126) merged. Cold Start, Orbit and Placement (#114) is still an open PR. Most findings are therefore about the design and the plan, which is the cheapest time to fix them.

## What is good (said plainly)

- **The enemy model's backbone is right.** Echoes send commands through the player's own movement and weapon code. They perceive only through honest channels. Their timings are distributions, not constants (`player-like-enemies.md` §5). This is the decision that makes transfer possible at all, and it is better than what most shipped bots do.
- **Scenario cards and honest channels** (`engagement-information.md`) turn the owner's information question into something buildable and measurable, with a sampler, caps and coverage rules.
- **The research is honest about its evidence.** Every number carries an evidence tag, and the gaps are stated as gaps.
- **Per-shot feedback works on `main`.** In the same frame, a hit draws a white hitmarker, the damage number (39) and the thock. A headshot kill draws a gold `+150`, a time-to-shot and time-to-kill readout, and plays the tink, kill chime and sparkle. A moving shot draws a dashed amber tracer and the miss-ghost ring at the head it missed. The audio log shows each cue scheduled on the same tick as its shot.
- **Seeded determinism plus the debug hook** make almost every experiment proposed below a few seconds of scripted bot play rather than a human session.
- **The three quality tracks** (numbers, feel, fun) stop one verdict from hiding another.

## Ranked findings

| Rank | Finding | Kind | Action |
|---|---|---|---|
| 1 | Fairness floors and an always-on tell let the player out-react prepared holders, which teaches dry-swinging held angles | Aimed wrong | [#127](https://github.com/omkarbhale/flickline/issues/127) (open question) |
| 2 | Nothing measures transfer, and the player cannot tell learning from warm-up | Gap | [#128](https://github.com/omkarbhale/flickline/issues/128) (open question) |
| 3 | Augmented feedback on every trial with no fading builds dependence on cues the reference game never gives | Gap | [#129](https://github.com/omkarbhale/flickline/issues/129) (open question) |
| 4 | Research proposals were never adopted: `main` ships dial values the research showed are infeasible | Built short | [#130](https://github.com/omkarbhale/flickline/issues/130) |
| 5 | No armour: every duel uses eco-round damage math | Gap | [#131](https://github.com/omkarbhale/flickline/issues/131) |
| 6 | Rewards pay for kills and speed, never for surviving or for a correct disengage | Gap | [#132](https://github.com/omkarbhale/flickline/issues/132) (open question) |
| 7 | Corner Clear angles are armed by stepping on a floor mark, so enemies appear after you stop | Aimed wrong | Comments on [#50](https://github.com/omkarbhale/flickline/issues/50) and [#103](https://github.com/omkarbhale/flickline/issues/103) |
| 8 | Elevation is impossible: collision has no step-up or slopes | Built short | [#133](https://github.com/omkarbhale/flickline/issues/133) |
| 9 | "Human-like" is calibrated against Flickline players, a circular ground truth | Aimed wrong | Comments on [#95](https://github.com/omkarbhale/flickline/issues/95) and [#96](https://github.com/omkarbhale/flickline/issues/96) |
| 10 | Spotting a target is a pop-out task, so time-to-shot trains on a visual search the reference game never presents | Gap | [#134](https://github.com/omkarbhale/flickline/issues/134) (open question) |

---

## Gaps nobody has asked about

### 2. Nothing measures transfer, and the player cannot tell learning from warm-up

**Evidence.**
- The vision makes one promise: "you get mechanically better at the reference game faster here than by playing it." Principle 1 is "Transfer first."
- The project has quality tracks for numbers (#61), feel (#62) and fun (#63), but none for transfer. No issue plans any measurement outside Flickline.
- `human-performance.md` §7 says that transfer from aim trainers to games is "essentially untested in public research". A fresh search on 2026-11-14 found nothing newer. The closest study is about adaptive training *inside* a shooter, not transfer from a trainer to a game ([Frontiers in Psychology 2021](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8224404/)).
- Every progress number Flickline shows (ratings, tiers, PBs, the posterior) is measured inside Flickline. It is also measured within a session, after the warm-up run, on an adaptive dial.
- Motor-learning research separates *performance during practice* from *learning*, which only a later retention test shows. Conditions that help performance in practice (feedback on every trial, blocked practice of one skill) often harm retention and transfer:
  - feedback frequency: Winstein and Schmidt 1990, as summarised in a [2016 Frontiers review](https://www.frontiersin.org/journals/neuroscience/articles/10.3389/fnins.2016.00251/full);
  - blocked versus random practice: [Shea and Morgan 1979](https://Www.Gwern.net/doc/psychology/spaced-repetition/1979-shea.pdf). Later sport-skill replications are mixed.

  "Today's session" is a block of single-skill 60-second drills.

**Why it matters.** This could fail even if every issue were built perfectly:
- Players get better at Flickline, the ratings climb, and the reference game does not move.
- Nobody would know: not the project, and not the player.

Without a transfer signal, the vision cannot be judged and "Transfer first" can never win a conflict. The player can't tell either. A rating that rises after warm-up within one evening looks like improvement, so the reward loop (principle 3) can reward warm-up instead of learning.

**Proposed answer** ([#128](https://github.com/omkarbhale/flickline/issues/128)):
1. **Cold-open benchmark.** The first run of each day is a fixed-seed, pinned-dial, cues-off run. It is the progress number shown on the profile screen and the input to week-over-week trends. In-session ratings stay as matching inputs, not as the "you improved" claim.
2. **Reference check-in (local only).** An optional weekly prompt where the player types numbers from the reference game: headshot percentage from their stats site, and a time on a fixed routine in the reference game's practice range. Flickline shows the two series side by side and never sends them anywhere.
3. **A transfer pilot as a playtest.** Six or more testers, two weeks:
   - half do 20 minutes of Flickline a day and the other half 20 minutes of the reference game's own practice modes;
   - both groups are measured with the same reference-game benchmark before and after.

   This is small and noisy, but it is the only evidence the promise can get.
4. **A fourth quality track, "Transfer".** It would hold these measurements and the "would this habit be wrong there?" reviews. It would get the same standing as numbers, feel and fun.

### 3. Feedback on every trial, with no fading, builds dependence on cues the reference game never gives

**Evidence.** The design gives augmented feedback on every shot, forever:
- amber moving-shot tracer, the `⇆` glyph and the "tock" (§7.1);
- miss-ghost ring;
- damage numbers;
- the time-to-shot and time-to-kill readout on every kill;
- for enemies, the tell: a flaring head node, a laser line from the muzzle, and a rising tone positioned at the enemy (§5.3).

Settings has one global "Coaching cues" toggle, on by default (seen on `main`: `src/ui/menu.ts`). No plan fades any cue.

The guidance hypothesis says feedback on every trial makes learners rely on it instead of on their own internal feedback. Reducing how often feedback is given tends to improve retention, even though it hurts performance during practice ([review, Frontiers 2016](https://www.frontiersin.org/journals/neuroscience/articles/10.3389/fnins.2016.00251/full)).

The reference game has no amber tracer, no "tock", no miss ghost, and above all no tell. Its first warning of an enemy shot is usually the shot.

**Why it matters.**
- The vision says a drill that builds a habit that fails in the reference game is a bug.
- Waiting for the tell's laser and tone to decide when to strafe or shoot is exactly such a habit. So is knowing you moved because you heard the tock rather than because you felt it.
- Principle 3 ("every shot gets an immediate answer") is right for learning *what* happened. It is wrong if the answer never goes away.

**Proposed answer** ([#129](https://github.com/omkarbhale/flickline/issues/129)):
- **Fade cues with the skill posterior.** A skill's cues go through three stages as its confidence band narrows above a dial threshold:
  - *every trial*;
  - *bandwidth*: the cue fires only when the error is large, for example a moving shot above the deadzone by more than 30%;
  - *summary*: the cue appears only on the results card.
- **Tells are a dial axis.** The laser and tone are present at low dials, fade above a dial threshold, and above it only the true cues remain: weapon raise, stop and muzzle flash. Surge can bring them back as a reward.
- **One "clean" run per session**, with a reference-like HUD and no coaching cues. This doubles as the cold-open benchmark from #128.

**Settling experiment.** Two groups of testers practise Stop & Pop for a week:
- one with 100% cues;
- one with faded cues.

Then both take a cues-off retention test. If faded cues retain as well or better, adopt fading as the default.

### 5. No armour: every duel uses eco-round damage math

**Evidence.**
- Design §5.1: "there is **no armour in the first release**".
- §5.2: "a rifle headshot kills, three body bullets kill."
- Player health merged in #111 with the same decision written into the code: `src/config/player.ts` says "100 HP, no armour in the first release".
- The spec has full shield rules (§4.1) and the time-to-kill table shows what that decision changes (§6):

| Weapon (spec archetype) | Unarmoured (Flickline today) | Heavy shield 50 (reference full buy) |
|---|---|---|
| Kestrel (`rifle_spray`) body, 0–20 m | 3 bullets | 4 bullets |
| Kestrel head, 20–50 m | 1 | **2** |
| Vane (`rifle_precise`) body | 3 | 4 |
| Pace (`pistol_accurate`) head, 0–30 m | **1** | **2** |
| Rill (`smg`) body, 0–15 m | 4 | 6 |

**Why it matters.**
- In the reference game, rifle duels are mostly fought by players who bought shields (no statistic found; this follows from its buy rules, where rifles and full shields are bought together on full-buy rounds). Flickline trains the bullet counts of an unarmoured round, which are a minority of real fights:
  - a "three-tap body kill" fails there;
  - so does a Pace one-tap to the head, and a long-range Kestrel headshot as a guaranteed kill.
- The spec ranks "weapon cadence and damage thresholds... the meaning of 'one more bullet'" fourth for transfer (spec §8). It is cheap to fix because the rules are already specified.
- "Economy" (what each side has) is also a real variable of real fights that the scenario cards do not carry.

**Proposed answer** ([#131](https://github.com/omkarbhale/flickline/issues/131), a work issue, because the answer is clear):
- Echoes and the player get 50 shield by default in modes where enemies shoot (Corner Clear, Vigil, Sweep), using spec §4.1 absorption.
- Scenario cards gain an `economy` field (full / light / eco). It sets the shield level and the enemy's weapon.
- Kill-heal restores health, not shield.
- The results card and the fix engine get one sentence of bullet-count feedback, for example "your Pace needed two headshots on an armoured target".
- This amends design §5.1 and §5.2.

### 6. Rewards pay for kills and speed, never for surviving or for a correct disengage

**Evidence.** Every reward is earned by killing, and faster is better:
- score is computed per kill with a `speed` term (design §8.1);
- chains are kills within 1.5 s;
- Surge fills from chains and clean streaks;
- Sweep heals only on kills;
- tempo windows push the player forward (#100);
- "no negative scores".

Nothing pays for:
- leaving a fight you were losing;
- not swinging into a crossfire;
- holding an angle;
- keeping your health.

The only cost of a bad fight is health, and kill-heal refunds it on the next kill.

**Why it matters.**
- In the reference game, survival is the currency. The coaching sources in `player-like-enemies.md` §2.10 list "over-aggressive" as the upper-middle-rank mistake. `engagement-information.md` names "swinging into multiple angles" as coaching's top low-rank mistake.
- A trainer whose rewards say "take every fight, fast" builds the habit the vision calls a bug.
- It also clashes with Flickline's own crossfire and breach cards, whose lesson is "isolate one angle" or "don't take this fight yet".

**Proposed answer** ([#132](https://github.com/omkarbhale/flickline/issues/132), an open question):
- Score each contact by its outcome: won clean, won after taking damage, **disengaged alive** (broke line of sight while losing and survived), or died.
- Add a health-retained multiplier per contact.
- Count chain credit only for kills that were isolated, so a chain that swung into two angles at once gets no credit.
- Make the speed term apply only to cards where the player is the one forced to move.

**Settling experiment.** Run a bot harness with two scripted policies, "always swing" and "isolate and disengage", over 1,000 seeded Sweep contacts. The reward table should rank "isolate and disengage" higher at every dial. Today it ranks "always swing" higher by construction.

### 10. Spotting a target is a pop-out task

**Evidence.**
- Design pillar 5: "Targets are the brightest, most saturated things on screen."
- §11: Echoes are luminous and always the highest-contrast thing on a dark, low-detail scene.
- On `main`, Beacons are bright orange discs on a near-black floor (first-run screenshot). The Echo art that merged in #112 keeps that look: bright Ember humanoids on a near-black floor (`docs/screenshots/echo/scene-6-echoes-3-beacons-2-gnats.png`).
- A unique bright colour on a dark uniform field is the textbook case where a target "pops out" at once, regardless of how much else is on screen.
- In the reference game, an enemy is often a partly occluded silhouette against a lit, cluttered map. That game adds an enemy highlight colour to help, but detection is still part of the reaction time.

**Why it matters.**
- Time-to-shot, which is the core number of the drills and the feedback, includes the time to spot the enemy.
- Flickline measures it on a detection task the real game does not present. Ratings and personal bests will look better than the player's real-game performance.
- Spotting partial exposures quickly is itself a trainable skill, and Flickline cannot train it.

**Proposed answer** ([#134](https://github.com/omkarbhale/flickline/issues/134), an open question). It conflicts with vision principle 8 ("not target readability"), so the owner should see the trade-off.
- Add a **visibility** axis to the dial: lower Echo body contrast, with a floor of 3:1 instead of 4.5:1. The head node and rim stay at 7:1 or more.
- Allow partial exposures (head and shoulder only).
- Put bright trim behind enemy positions at high dials.

**Settling experiment.** Run Cold Start for testers in two conditions: the current look, and a cluttered background with a low-contrast body. If median time-to-shot differs by less than about 30 ms, close the question as "no change". If it differs more, the axis is worth building.

---

## Planned but aimed wrong

### 1. Fairness floors and an always-on tell let the player out-react prepared holders

**Evidence.** The planned enemy floors are:
- reaction of at least 0.25 s;
- a tell of at least 0.25 s (0.30 s at dial 100) that "holds fire for the floor" even when the enemy is already on target (`player-like-enemies.md` §5.6 F4 and F5).

The research states the result itself: "the floors keep its time from exposure to first shot at 0.55 s or more, about 0.6 s on average" (§8, question 3), "the deliberate fairness cost".

The real comparison:
- A human holder already aimed at the spot needs about **0.25–0.35 s** to shoot (`human-performance.md` §1.2).
- In the reference game, the peeker gets **40–70 ms** of network peeker's advantage on top (Riot, cited in both research documents). Flickline has none. Research question 1 declined to model it: "No... Revisit only if playtesters report that real duels feel faster."
- So a real prepared holder answers a wide swing in roughly 0.3–0.4 s. A Flickline prepared holder at the top dial answers in 0.55 s or more.

**Why it matters.**
- The research's own transfer lesson for this fight is "you cannot out-react a prepared holder; deny the expectation instead" (§2.5).
- With the floors applied to prepared holders, the opposite is true in Flickline. A wide swing into a pre-aimed angle wins, because the player has 1.5–2× the real window.
- The most common attacker fight (card 1, "Take: expected", 16% of Sweep) would reward the habit that gets players killed in the reference game.
- The floors exist for fairness, which is right for an enemy that *was not* expecting you (a flank, an off-angle appearance). A holder that already knows your spot is the case the reference game designs to win.

**Proposed answer** ([#127](https://github.com/omkarbhale/flickline/issues/127), an open question):
- Split the floors by expectation:
  - The 0.25 s reaction floor and the tell floor apply only when the player appears outside the enemy's attention cone, or when the enemy has no information.
  - A prepared holder whose card says it knows your spot fires on a human pre-aimed time-to-shot distribution (median about 0.3 s) with no forced tell.
- The dial controls how many prepared holders appear and how good their settle noise is, not their speed.
- Peeker's advantage is emulated *without adding any latency for the player*: an Echo that peeks starts its reaction timer 40–70 ms early.

**Settling experiment.** A bot-harness duel table:
- A scripted human-timing peeker wide-swings a pre-aimed holder at mind skill 65 and 100, for 1,000 seeded duels each.
- Reference expectation: the holder wins most of them. The research quotes Riot: "a player holding territory should, on average, have an advantage".
- If the peeker wins more than 50%, the floors invert the lesson.

### 7. Corner Clear angles are armed by stepping on a floor mark

**Evidence.** Design §4.7: "Reaching a checkpoint (a floor mark) arms an **angle**: 1–3 Peekers hold it." #103 makes each angle a scenario card but keeps the arming. The enemy appears *because the player arrived*, usually after the player has walked onto the mark and stopped.

**Why it matters.** Clearing in the reference game means:
- the enemies are already somewhere;
- the player's own movement opens each sightline, one slice at a time;
- the order the player clears angles in decides how many are exposed at once.

An arrival trigger teaches "walk to the spot, then fight", with the fight starting at a moment the player chose and from a standstill. Crosshair placement *while moving* through the map is not tested. "Pre-aim common angles in order" has no metric.

**Proposed answer** (scope comments on [#50](https://github.com/omkarbhale/flickline/issues/50) and [#103](https://github.com/omkarbhale/flickline/issues/103)):
- Place the angle's holders at run start, on hold anchors, with beliefs from the card.
- Exposure happens when the player's movement creates line of sight.
- Add two stats:
  - **angles exposed at once**: count of simultaneous lines of sight to holders, from the event log;
  - **clearing order**: did the player slice the nearest angle first?
- Checkpoints become route guidance only.

### 9. "Human-like" is calibrated against Flickline players

**Evidence.**
- #95 replaces every HYPOTHESIS value in the enemy profiles with measurements of "player movement and timing from playtest input logs". Those are Flickline players, playing Flickline, against Flickline's Echoes.
- The mirror test (#96) judges Echoes against clips of the same Flickline players.
- Reference-genre data ("CS2 demos") is called "optional and out of scope" (`player-like-enemies.md` §7.3).

**Why it matters.**
- Flickline players' strafes, peeks and re-peeks are shaped by Flickline's rewards (finding 6), floors (finding 1) and enemies. Measuring them and feeding the result back into the enemies can converge on Flickline's own habits, not the reference game's.
- Testers are also few and mostly new to the game. Early logs are novice behaviour, before adaptation.

**Proposed answer** (scope comments on #95 and #96):
- Anchor the movement and timing rows on reference-genre recordings. Public Counter-Strike 2 demos expose per-tick velocity and view angles through open parsers. They give strafe-leg lengths, peek exposures and shot-after-stop delays offline, in minutes, with no assets copied.
- Record each tester's reference rank and use only their first sessions, before Flickline's rewards could shape them.
- Mirror-test clips should come from testers ranked like the dial they are compared with.

---

## Built but falling short

### 4. Research proposals were never adopted, so `main` ships dial values the research showed are infeasible

**Evidence.** `src/config/dial.ts` on `main` ships the design's values with comments saying the research proposes otherwise and that #53 should adopt the changes:

| Value on `main` (dial 100 unless noted) | Research proposal | Source |
|---|---|---|
| exposure 0.45 s for *every* timed target | per mode: Orbit 1.6 s, Cold Start 1.05 s, Stop & Pop 0.7 s | #12 §4.1 |
| flicks 90–180° | 60–120° (120–180° rare, only above dial 85) | #12 P5 |
| distance up to 50 m | 35 m (a 50 m head is inside the first-shot cone) | #12 P5 |
| tell 0.18 s, floor 0.15 s | 0.30 s, floor 0.25 s | #12 P6, #52 R8 |
| stand-still window 0.20 s | 0.25 s | #12 P5 |

Other proposals were not adopted either:
- `src/config/audio.ts` ships the 220 → 110 Hz thock and a leg cue "a semitone lower and 6 dB quieter", which #52 measured as "not identifiable on its own" (R1–R4).
- `warn` stays `#FFB020`, which is nearly identical to gold (the headshot colour) under deuteranopia (R15).
- The stat is still called "RT" (`rtMs`) although it measures time to shot (P1). On `main`, a kill reads "500 ms · 0.00 s".
- `docs/design.md` still describes seeded `pHit` rolls (§5.3), which #71 replaced with aimed shots.

#53 (balance) is a late first-release pass that needs bot and human data, so it runs after the modes are built. PR #114's Placement run already draws its exposure from the 3.0 → 0.45 s curve, and its Orbit flicks reach 90–180°.

**Why it matters.**
- The Placement run and the first-playable playtest (#29) will calibrate and judge numbers already known to be wrong.
- Items that are infeasible at high dials make success near zero there for *any* ability. The posterior therefore saturates below the top tiers: the players who chose "Competitive" are mis-rated, and "meets every player at their skill" fails at the top.
- Workers build from `design.md`, so the research findings do not reach the code.

**Proposed answer** ([#130](https://github.com/omkarbhale/flickline/issues/130), a work issue): one docs-and-config PR before #29 that:
- moves the accepted research numbers into `design.md` and the config;
- renames the stat to time to shot;
- treats bait peeks as non-trials (P3) and carries the trial type (P4);
- applies the cue changes R1–R4, R13 and R15 and the floors in P6.

#53 then tunes from there. A design doc that stays stale against three research documents is a process gap. The vision's "Change the design freely" rule should include "adopt research before building on it."

### 8. Elevation is impossible: collision has no step-up or slopes

**Evidence.**
- `src/sim/movement.ts` and `src/sim/collision.ts` resolve the player against axis-aligned boxes with no step-up and no slopes. Design §10.2 says "Simulation collision uses axis-aligned boxes only."
- The only way up is a jump (apex 1.0 m, spec §2.6). Foundry's 3 m catwalk (#36) has no specified way to reach it.
- The head-height discipline stat measures the aim against head-centre height at *the player's own* eye level, which assumes everyone stands on the same floor.

**Why it matters.**
- Crosshair placement across height differences is a large part of real crosshair placement: an enemy on stairs, on a ledge, on a catwalk, or below you.
- So is fighting up or down a ramp. With flat maps, the "angles" skill is trained in only its easiest form.
- The habit "keep the crosshair at my eye height" fails the moment a real map slopes.

**Proposed answer** ([#133](https://github.com/omkarbhale/flickline/issues/133), a work issue):
- Step-up of at least 0.3 m and walkable ramps in the movement and collision code. They should be cheap: still boxes, plus ramp primitives.
- A map-lint check that every raised floor is reachable.
- Elevated holds in Elbow and Foundry.
- A head-height stat measured against the head height of the *expected enemy position*, from the map's anchors.

### Smaller observations on `main` (no new issues; already covered)

- The placeholder viewmodel is a large slab covering much of the lower right of the screen at 1600×900. #45 replaces it. Judge its size against the reference game in #29.
- The first-run panel is clean and has no tutorial wall, which is right for principle 2.

---

## Considered and not filed

- **A baseline for fight attribution (#110).** Before #126 merged, it looked as if nothing defined *what was expected* in a fight. A comment on #110 proposed a per-card expected win rate at the dial. `docs/research/fight-attribution.md` (#126) already answers this more fully: a "your normal self" par from the player's own time-to-shot, and a per-card prior modelled on expected goals. Nothing further is needed beyond the dependency it shares with finding 1: the per-card priors are only meaningful once prepared-holder timing is settled (#127).
- **Abilities and utility** (fighting after a flash, through smoke). They are a real share of reference-game fights, but they are excluded on purpose (design §15) and carry the highest risk of copying the reference game's identity. Two cards already cover the mechanical core: "Take: unaware" covers an enemy that is turned away, and Breach covers forced entry. Revisit only if the transfer pilot (#128) shows a gap.
- **Browser input latency and frame cap.** `requestAnimationFrame` cannot exceed the display's refresh rate, so "uncapped" in the settings table (§13.3) can never be faster than the monitor. Input-to-photon latency cannot be measured from inside the page. The feel checklist (#65) already lists input latency; it should note that it has to be measured externally (for example with a high-speed camera), not with the debug hook.

## What to check first when a human plays it

Only a person with a mouse, a monitor and the reference game installed can judge these. Do them in this order in #29:

1. **Sensitivity.** Type your reference-game sensitivity. Is a 360° turn the same physical mouse distance, and does a 90° flick land in the same place?
2. **Stop feel.** Tap A then D and shoot. Does the stop *feel* as snappy as the reference game? Does the amber cue agree with what your hand felt?
3. **Input latency.** At your monitor's refresh rate, does the crosshair feel attached to the mouse, or a frame behind compared with the reference game at the same frame rate?
4. **Hit sounds without looking.** On your own headphones *and* laptop speakers, can you tell a body hit from a leg hit from a headshot by ear alone? (#52 predicts body and leg are confusable.)
5. **Spray.** Does the Kestrel's climb, then sideways break, feel like the reference game's spray rifle, independent of the numbers?
6. **Spotting.** Is spotting a target effortless compared with the reference game? If so, note how much faster your time-to-shot feels than it would in a real match (finding 10).
7. **Cues off.** After a run with coaching cues, play one without them. Do you feel lost, or no different? (finding 3)
8. **Viewmodel.** Does the placeholder gun hide anything you would look at on the right side of the screen?
9. **Restart.** Does `Enter` → next run feel instant, and does the results card ever make you wait?
10. **Orbit at high dial.** Do 90–180° behind-the-back flicks feel like skill or like noise? (finding 4)
