# Player-like enemies: how real players fight, and an enemy model that does the same

Research and design for issue #71, part of the long-lived module **#70 (Tracking: player-like enemy behaviour)**. Companion document: `docs/research/engagement-information.md` (#75, *which* fights happen and what each side knows going in). This document covers *how an enemy behaves inside a fight*.

- Research date: 2026-11-14. Reference game: Valorant, called "the reference game" as elsewhere in the repo. Counter-Strike evidence (CS:GO, CS2) is used where the reference game has none, and is always labelled.
- This is research plus a proposed design. It does **not** edit `docs/design.md`; changes to existing issues are posted as comments on them (section 9). Numbers for movement, weapons and damage come from `docs/mechanics-spec.md` (`spec §x.y`) and are not repeated. Human baselines already in `docs/research/human-performance.md` (#12, PR #69) are cited, not re-derived.
- Identity: everything here describes *behaviour* of players of the reference game. Flickline copies none of its characters, abilities, maps or assets; all names below (Echo, Strafer, Peeker, the mind, profiles) are Flickline's own.

## 0. How to read this document

### 0.1 Evidence tags

| Tag | Meaning |
|---|---|
| **High** | Primary source (paper, developer post, stats page with a stated method) whose text was read. |
| **Med** | Primary source seen as an abstract, or a secondary source that points to a primary one. |
| **Low** | Coaching or vendor content without a method, a forum post, or a search snippet. A lead, not a fact. |
| **DERIVED** | Arithmetic on tagged inputs; the arithmetic is shown. |
| **HYPOTHESIS (n%)** | No evidence found. A stated design assumption with my confidence that it is roughly right, and the Flickline measurement that would settle it (section 7.3). |

Method note: pages were read through a fetch tool that returns an extracted version of the page, so quoted wording is as extracted. The three figures this design leans on hardest were re-checked against the page by a second fetch (tracker.gg headshot table, Riot's netcode post figures; both matched). The Yoon et al. preprint was read by local text extraction once and could not be re-fetched (file too large), so its numbers are tagged Med.

### 0.2 The honest headline: what exists and what does not

Evidence is **strong** for: the reference game's stop timing and accuracy rules (Riot), peeker's advantage (Riot), headshot rate by rank (tracker.gg, 4.5 M players), lab reaction-time distributions, aimed-movement structure (undershoot and correction), manual-tracking lag, and how shipped shooter bots were built (Counter-Strike bot, Halo, Left 4 Dead, Quake III, BotPrize entrants).

Evidence is **absent** (searched, not found) for: measured exposure times of any peek type; strafe-leg lengths or direction-change rates in duels; crouch frequency by rank; re-peek delays; trader distance and swing latency; kill-while-moving share; spray-transfer rates; Valorant first-bullet, spray, time-to-damage or crosshair-placement statistics by rank; footstep audible distances published by Riot. Every one of these is therefore a **HYPOTHESIS** below, with a test. Because Flickline's enemies are driven by the same movement and input code as the player (section 5.2), most of these hypotheses can be measured on our own players within the first release (section 7.3), which is the plan for replacing them.

---

## 1. Summary

**Findings**

1. Real duels are decided by tens of milliseconds: Riot measured that gunfights "often came down to 20–50ms" and skilled testers detected ~10 ms changes (High). Human reaction is right-skewed, never constant, and its slow tail (not its mean) is what practice shrinks (Böer 2025, High). An enemy with a fixed reaction time is both inhuman and teaches nothing about the real distribution.
2. Players shoot from a stop. Riot: players "often shoot right after counter-strafing" (High); moving shots are near-uniformly random in the cone since patch 6.11 (High); the accuracy gate is reached about 0.10 s after the stopping input (spec §2.5). The low-rank habit is the opposite: amateurs fire while running (Korotin 2019, CS, Med). This is the single most transferable behaviour to model.
3. Aim is not a straight snap: the first (primary) movement usually lands short, a correction follows 100–200 ms later (Elliott 2017, High), speed follows a bell-shaped profile (Flash and Hogan 1985, Med), motor noise grows with speed (Yoon et al., Med), and tracking an unpredictable target lags ~180–220 ms while a predictable one lags ~50 ms (Parker 2021, High). Bots that look robotic violate exactly these (instant, straight, constant, noise-free aim).
4. Headshot rate is the one rank-resolved aim statistic for the reference game: median 11% (lowest rank) → 20% (middle) → 32% (top), all weapons (tracker.gg, 11 Nov 2026, High). It gives each enemy tier a calibration target.
5. Peek types (wide swing, jiggle, shoulder, jump, crouch) and holding habits (head height, distance from the corner, off-angles, not re-peeking the same way) are consistently described by coaches but never measured (Low). They are modelled from movement physics plus key-press timings, so the *exposure* they create is a consequence of the real movement rules rather than an authored number.
6. Shipped bots that read as human all did the same four things: real perception and no cheating (Halo, CS bot, Left 4 Dead), simulated aiming with offset, drift and a spring/damper view (CS bot), accuracy degraded by both sides' movement and range (UT^2, BotPrize co-winner), and per-bot variation in skill, aggression and reaction (CS bot). Even real humans were often judged bots in BotPrize, so "feels human" must be judged with a protocol, not a single opinion (humans averaged only ~40% "human" judgements in 2012, press figures, Low; the least human human scored 35.5% in 2010, High).

**Design decisions** (section 5)

- **The mind** (`sim/mind/`, pure): one behaviour model for every humanoid Echo, layered as *perception → decision → aim and body*. It produces a per-tick **command in the player's own input format** (move keys, look angles, crouch, walk, jump, fire), executed by the *same* movement and weapon code as the player. Enemies therefore stop, peek, spray and miss under the real rules.
- **Enemy shots are aimed, not rolled.** Inside Sweep and Corner Clear, an enemy's shot goes where its simulated crosshair points, through the spec's spread and movement error. Design §5.3's `pHit` becomes a *calibration target* the harness measures, not an input. Strafing, stopping and peek choice then protect or expose the player for the same reasons as in the reference game.
- **Profiles, not difficulty sliders.** A profile is a set of timing distributions and habit probabilities. Four anchors (dial 0, 35, 65, 100: a first-week player, then roughly the lower-middle, upper-middle and top of the reference ladder) are interpolated by the dial, and every enemy draws its own seeded personality around the anchor.
- **Distributions everywhere.** Reaction is ex-Gaussian, durations are lognormal, choices are weighted draws with anti-repetition. Each enemy has its own RNG stream derived from the run seed, so runs replay exactly.
- **Fair by construction.** No knowledge without perception (line of sight within a field of view, or a sound within range), no aiming through occluders, the design's floors (reaction ≥ 0.25 s, tell ≥ 0.25 s per #12's proposal) as hard clamps, the tell drawn over the enemy's *real* aiming phase, and mistakes that are visible and punishable.
- **Judged by a checklist and by signatures**: a looked-at checklist for playtests, a "mirror test" that replays a human's own recorded inputs on an Echo body for blind comparison, and eleven measurable signatures that the bot harness checks in seconds (section 7).

---

## 2. What real players do

Each subsection gives the evidence, the numbers Flickline uses, and **Transfer**: why practising against it carries over to the reference game, and what exactly the player learns.

### 2.1 Peeking

**Evidence.**
- Peek types and purposes (all coaching, Low; Valorant and CS): *wide swing*, committing to the duel at full speed so the holder's pre-aimed point is passed; *jiggle*, "very small and quick strafes" against the wall to test whether an angle is held or to bait a shot; *shoulder*, exposing "only a sliver" of the body (no head) to draw a shot, especially from a one-shot sniper; *jump peek*, a jump across the gap for information or bait; *crouch peek*, a one-off trick that works because holders' crosshairs sit at standing head height, "riskier at lower Elo" because low-rank crosshairs sit low anyway (Dignitas, prosettings, metabot, boostroom).
- The only timing numbers are unsourced coaching heuristics: jiggle exposure ~0.1–0.3 s, shoulder ~0.3–0.5 s, a ~0.5 s gap between double jiggles, a wide-swing burst of 2–4 bullets after a brief stop (metabot, boostroom; **Low**).
- Riot (High): a peeker's shoulders appear before the head; the peeker must "come to a stop before firing ... during which the holder can react"; peeker's advantage is 40–70 ms on average from network and frame delays, ~141 ms under the netcode post's stated assumptions (60 FPS client, 35 ms round trip, 128-tick server) and ~71 ms at 144 FPS. In Flickline there is no network, so this delay does not exist (see 2.5).
- Peek choice by tier (Low, contradictory): low ranks dry-peek and swing wide into several angles; high ranks jiggle for information before committing; "jiggle then wide" exploits a holder who moved their crosshair for the jiggle.

**Flickline model.** A peek is a sequence of *key presses* run through the real movement code, so exposure is an outcome. Example (DERIVED from spec §2.3: acceleration 5.4 m/s ÷ 0.20 s = 27 m/s², braking 39 m/s²): a 0.12 s strafe tap reaches 3.24 m/s and 0.19 m; braking to zero (39 m/s² down to 25% of run speed, 24 m/s² below it) takes about 0.10 s and 0.15 m more, so the body moves ~0.34 m out before coming back: enough to show a shoulder past a corner for roughly 0.2–0.3 s, inside the coaching range. A wide swing is a full-speed strafe that starts at least 1.5 m from the corner line and counter-strafes once the holder's expected position is in view. Peek parameters per profile are in section 5.4.

**Transfer.** Against peekers whose exposure comes from real movement, the player learns (a) to hold a crosshair where a *wide* swing ends, not at the corner edge (2.2); (b) not to waste the first bullet on a shoulder or jiggle, i.e. to tell bait from commitment by the amount of body and the presence of a stop; (c) that a crouch peek arrives below a standing-head crosshair; (d) that a jump peek cannot shoot accurately (spec §2.6: +10° airborne) and is information, not a threat. Each of these is a decision real duels test every round.

### 2.2 Holding angles and crosshair placement

**Evidence.**
- Keep the crosshair at head height on the spot where the enemy will appear (consensus, Low–Med; Dignitas, CSDB). Common angles are pre-aimed by everyone; off-angles "negate the opponent's advantage" because the peeker's crosshair is on the common spot (Dignitas, Med).
- A pro player's guide: against a wide swing aim *further from the corner*; against a close peek or a walk, hold *tighter* to the corner (nAts via OneEsports, Med). The player farther from the angle sees the peeker first (Dignitas, Low); holding close to a corner is "typically unfavourable" (Low). No distance or angle numbers exist.
- Crosshair placement statistics exist only for CS, and only as single-profile snippets: Leetify's median "degrees moved from first seeing the enemy to damage" around 10° for an average player, 7–9° for strong ones (Leetify definition High; values **Low**).
- Low-rank crosshairs sit too low (coaching, Low).

**Flickline model.** A holder picks a hold spot from the map's `peek` and hold anchors (design §10.2) with a distance-from-corner preference by profile, aims at the expected appearance point at a profile-dependent vertical offset from standing head height, and biases horizontally towards where a wide swing ends with probability rising by tier. While holding it is never frozen: a seeded slow drift (Booth's "view drift", 2.8) plus occasional glances to a second angle (attention switching), which open real windows for the player.

**Transfer.** The player learns (a) that a common angle is pre-aimed and costs a first bullet if peeked tight, (b) to swing wide or jiggle first against good holders, (c) to check off-angles, and (d) by watching Echoes hold, what correct head-height placement looks like at each distance. Pre-aim error measured on the player (design §3) is the mirror stat.

### 2.3 Counter-strafing and the stop-shoot rhythm

**Evidence.**
- Riot (High): run to accuracy gate 0.104 s and full stop 0.160 s with a counter-strafe, 0.170 s by release (Phantom, 2020); players "often shoot right after counter-strafing", and this is "the typical muscle memory" (Riot, *On Peeker's Advantage*). Patch 6.11 (High): "shots fired while moving are now almost uniformly random within their spread cone".
- Leetify (CS2, High definition): a "proper counter-strafe" shot is a rifle shot below 34% of max speed; rank-average shares around 75–82% in profile snippets (**Low**). Coaching: "one clean tap, then a settled beat, then the click" (Low).
- No measured stop-to-shot delay exists. The earliest accurate shot is ~0.10 s after the stop input (DERIVED, spec §2.5).

**Flickline model.** Every enemy shot is preceded by a stop decision unless the profile's *moving-shot* habit fires (a mistake whose rate falls with tier, 5.4). After the stop input, the shot is released after the gate plus a *shot-after-gate delay* (lognormal, median 70 ms at mind skill 100, 180 ms at 0; HYPOTHESIS 40%). Calibration: the share of an enemy's rifle shots fired below the gate should be ~78% at mind skill 50 (interpolated; Leetify's rank-average band, Low) and ≥ 92% at 100.

**Transfer.** The player sees, every fight, the exact visual of a correct stop (the Echo decelerates over 0.16 s, then fires) and learns its rhythm; the moment an enemy stops is the moment it becomes accurate *and* easiest to hit, which is the reference game's duel in one sentence. Stop & Pop (#47) trains the player's own stop; this trains reading the enemy's.

### 2.4 Strafing in a duel

**Evidence.**
- Pros use A/D strafing, amateurs often fire while running forward (Korotin et al. 2019, CS:GO, 15 players, qualitative, Med). Running-and-gunning is a low-rank mistake (prosettings, Low).
- No source gives strafe-leg lengths, direction-change rates, or randomisation (searched widely; **gap**). The closest is a pro-movement imitation model that issues commands every 125 ms (Durst et al. 2024, CS:GO, High for the paper, Low relevance).
- Crouching: "instant crouch after shooting" is near-universal (Dignitas, Med as coaching); crouch-spraying is a Bronze–Silver habit (prosettings, Low); a CS pro analysis says a pro can use a crouch on a swing only "twice" before it is read (Dignitas, Low). CS2 data shows crouching tightens inaccuracy 16–25% (csdb, Low–Med); Flickline uses the spec's crouch rules.
- Tracking science gives the *reason* irregular strafing works: an unpredictable target is tracked with ~180–220 ms lag, a periodic one with ~50 ms or less, and humans learn a periodic rhythm within one or two cycles (Parker 2021, High; #12 §3). A reversal costs the tracker 60–110 ms extra (van de Kamp 2013, joystick, High).

**Flickline model.** Duel strafing is a sequence of legs. Leg duration is lognormal per profile; at mind skill 35 the legs are *too regular* (coefficient of variation 0.15, a deliberate mid-tier habit that the player can learn to time), at the top anchor they are irregular (CV 0.45) with occasional double-taps and stop-shoot-stop sequences. A crouch on or right after firing is a habit with a profile probability, at most twice per duel at the top anchor. HYPOTHESIS (35%) for every number; test with the mirror data in 7.3.

**Transfer.** Against a regular strafer the player learns to time the reversal and shoot the stop; against an irregular one the player learns that the stop is the only reliable window. Against enemies that *lead* the player's movement (2.6), the player's own strafes stop working if they are rhythmic, which is the reference game's lesson that predictable ADAD is free damage.

### 2.5 Reaction time

**Evidence.**
- Simple visual RT ~218 ms mean in 18–24-year-olds, within-person SD ~40 ms (Woods 2015, High; #12). Riot quotes ~247 ms and "the 300 ms range" (High that Riot says it). Two-choice visual RT in young adults fits an ex-Gaussian with μ ≈ 320–460 ms, σ ≈ 35–85 ms, τ ≈ 55–160 ms; τ is ~15–26% of the mean (De Jesus Cintron and Yang 2024; Gazzanigo et al. 2025; High, ratio DERIVED). Responses under ~110 ms are anticipations (~3% of trials, Woods 2015).
- Practice shrinks the slow tail: τ was "the only distribution parameter clearly modulated by practice" (Böer et al. 2025, High). Experienced CS players were ~90 ms faster on a decision task (Hyde and von Bastian, press release, Med) and 80–140 ms faster than non-gamers on two-choice RT (Toth 2019, High). In a lab aim task, pros' *gaze* reaction was 132 ms vs amateurs' 170 ms, but their first *mouse* movement was the same (~161 ms) (Yoon et al., Med).
- Expectation: an expected target time saves ~27 ms (variable foreperiod, Woods 2015, High); a valid location cue saved ~47 ms against an invalid one in one study (Piccardi 2025, High, weak population); stimulus-response location compatibility ~19–25 ms (Scerrati 2017, High). Peripheral onsets capture attention in ~100 ms, voluntary shifts take ~300 ms (Carrasco 2011, Med).
- In-game outcome: Leetify time-to-damage (seeing an enemy to first damage, including aim and fire) is ~550–650 ms for typical ranked CS players and ~440 ms for one top player (definition High, values **Low**).
- Peeker's advantage (network) adds 40–70 ms against the holder in the reference game (Riot, High). Flickline has none.

**Flickline model.** An enemy's reaction (first sight of a player hit zone inside its attention to the first aim motion) is an ex-Gaussian draw truncated at the 0.25 s floor (design §9.3) by deterministic rejection, then shifted by expectation (5.3). Anchors in 5.4. With the floors, the top anchor's time from exposure to first shot is ≥ 0.25 s + the tell (≥ 0.25 s; #12 proposes 0.30 s at dial 100), so about 0.6 s: close to a typical ranked player's time-to-damage, slower than the best. That is the deliberate fairness cost (5.6), partly balanced by the player having no network disadvantage.

**Transfer.** Enemies that react faster when they *expect* you and slower when you appear where they are not looking teach the reference game's real lever: you cannot out-react a prepared holder, but you can deny the expectation (an off-angle, a silent approach, a different timing, a re-peek from elsewhere). The distribution also teaches that a slow-tail enemy sometimes gives you a free kill and a fast-tail one sometimes beats a perfect peek, which is how real duels feel.

### 2.6 Aim behaviour: flicks, tracking, first bullet versus spray

**Evidence.**
- Primary movements usually fall short of the target: "it is usually strategically sound to undershoot the target with the primary movement"; in one dataset primary overshoots were ~5% and stayed so with practice, while practised movements were on target ~70% and short ~25% (Elliott et al. 2017, High). Other rapid aiming shows overshoot-then-reverse on 60–78% of trials (Roberts 2024, High): the mix depends on the task, and a mouse at gaming sensitivity is closer to the fast end. Corrections start ~100 ms after an error is visible (perturbation lower bound) to ~180–200 ms (visual RT) (Elliott 2017, High).
- Skilled FPS players are *more* hypometric (land short) on smaller targets and fire earlier in the movement ("swipe" rather than "flick and land"); higher acuity correlates with firing before the movement ends (Donovan et al. 2022, 32 semi-pro and pro players, High; no millisecond values in text).
- Motor noise is signal-dependent: Gaussian noise on angular velocity with SD proportional to speed, perpendicular SD 0.192× the parallel (Yoon et al., Med). Point-to-point movements follow a bell-shaped speed profile (minimum jerk, Flash and Hogan 1985, Med; for a pure minimum-jerk profile the peak is 1.875× the mean speed at mid-movement, DERIVED).
- Tracking: unpredictable targets lag ~180–220 ms, predictable ones ~50 ms (Parker 2021, High). Bot practice: Quake III's skill ladder — aim disturbed by enemy movement below 0.9, linear leading 0.4–0.8, exact leading above 0.8 (`chars.h`, High). UT^2 reduced accuracy with both its own and the target's movement and with range "to make the bot fallible in a human-like manner" (High).
- First bullet versus spray: headshot share of hits by rank (reference game, all weapons): 11.0% at the lowest rank, 19.1% at the middle, 24.7% upper-middle, 31.5–31.9% at the top, with P25–P75 spreads of about ±4 points within a rank (tracker.gg, High; re-checked). Within a rank, higher headshot rate does *not* mean more wins. Rifle spray accuracy ≈ 32–33% rank average (Leetify CS2 snippets, Low); only one tracked CS2 pro exceeds 50% (Nomiun 2024, Med). Riot's data: nearly half of one rifle's kills are within 15 m (High). No Valorant first-bullet or spray accuracy by rank exists.
- Spray transfer: no data (gap).

**Flickline model.** The aim layer is a second-order system steered towards an aim point (5.5): a reaction delay, then a primary submovement whose amplitude error is Gaussian with a short bias, a bell-shaped speed profile and speed-proportional noise, then corrective submovements after a correction delay, then settle noise. Tracking aims at a *delayed* observation of the player, extrapolated with a profile-dependent lead gain; a player reversal therefore produces a real, measurable overshoot. Shots go through the spec's spread and recoil; spray control is a per-bullet compensation fraction; burst length depends on distance. Spray transfer is a target switch with the same flick model while firing. The headshot rates above are calibration targets (signature S7), not rolls.

**Transfer.** The player learns that an enemy's first bullet is the dangerous one when it is stopped and settled, that close-range sprays are lethal while long-range sprays are not, and, through the lead model, that moving *irregularly* makes a tracking enemy miss behind and in front. Watching enemy flicks that land short and correct makes the player's own two-stage aim feel normal rather than a failure.

### 2.7 Repositioning, retreat, re-peek and trade

**Evidence.**
- "Re-peeking the same angle is always very risky" (Dignitas, Valorant, Med); "Do not hold the same angle twice. After one contact, reposition" (CSDB, CS2, Med); keep watching the angle while backing out of it (Dignitas, CS2, Med). No source gives re-peek delays or same-angle re-peek rates (gap).
- Trade windows used by stats sites: 5 s (HLTV Rating 3.0 for trade denials, Med; awpy default, Low), 3–5 s (others, Low). Leetify's average trade-kill success ~45% (profile snippets, Low). Spacing advice: "close enough to swing immediately, far enough to not get collateral damaged" (Low). No measured trader distance or swing latency (gap).
- Diamond-rank players "trade poorly" (prosettings, Low); reloads are audible and Riot chose to position them in 3D (patch 2.06, High), i.e. a reload is an intended information cue.

**Flickline model.** After a contact an enemy chooses *retreat, reload, reposition, re-peek or push* from profile weights and state (HP, ammo, whether it was hit, whether it killed). Re-peek delay is lognormal (median 1.4 s at mind skill 0, 2.4 s at 100) with a 20% share of *instant* re-peeks (< 0.6 s) at 100 as a timing surprise; same-angle-same-way re-peeks fall from 75% (mind skill 0) to 15% (100). Reloading in the open is a low-tier mistake. In contacts of two or more, an enemy whose teammate dies within its perception swings to trade after its reaction plus a lognormal swing delay (median 1.6 s at mind skill 0 down to 0.7 s at 100, 95th percentile ≤ 3 s, inside the 5 s trade window). HYPOTHESIS (35%) for every number.

**Transfer.** The player learns not to stay on the angle after a kill (a trade is coming), to pre-aim where a low-tier enemy will re-peek and to expect a top-tier one elsewhere, and to punish a reload. These are the habits that separate middle and upper ranks in every coaching source.

### 2.8 Pre-fire and common angles

**Evidence.** Common angles are where everyone pre-aims; "if the enemy is playing a common angle, you can peek and pre-fire", and some players pre-fire every jiggle when an enemy "could be there" (Dignitas, prosettings; Med–Low). Bots in Counter-Strike direct their attention at "approach points", "last known enemy location" and "towards enemy noises" (Booth 2004, High). No frequency data (gap).

**Flickline model.** Map anchors carry a `common` flag. A clearing enemy pre-aims common spots in order of a profile-weighted list, and *pre-fires* (starts shooting just before line of sight is established) only when it has information that the player is there (heard or last seen within a memory window, 5.3). Pre-fire is never available without information (fairness rule F2).

**Transfer.** The player learns that standing on a common spot after making noise gets pre-fired, and that an off-angle or silent repositioning makes the enemy's pre-aim wrong. This is the reference game's information-to-position link in miniature.

### 2.9 Sound and information

**Evidence.** Riot: footsteps are tuned "to be heard, not to portray distance" with a deliberately flat attenuation; the footstep radius exists to give the listener time to react; footsteps, reloads and respawn sounds are spatialised with HRTF (Ask VALORANT #6, patch 2.06; High). Riot publishes no audible distance; community figures (run ~50 m, walk ~15 m, crouch ~12 m) have no method and conflict with others that say walking is silent (Low); a CS2 page gives running ~28 m (Low). Shift-walking hides a player's sound circle on the minimap (Dignitas, Med). Counter-Strike bots "randomize" the location of what they hear (Booth, High).

**Flickline model.** The enemy hears the same events the player emits (running footsteps, landing, shots, reloads) within tunable radii that are **symmetric** with what the player hears from enemies; walking and crouch-walking are silent in v1 (decision: the most-cited behaviour, and the one that gives the player a clear rule). A heard sound gives the enemy a position estimate with an error that shrinks with tier and with repetition, which raises its expectation for that sector (faster reaction, pre-aim, possible pre-fire). The full treatment of information is in `docs/research/engagement-information.md`.

**Transfer.** The player learns that running near an enemy gives away the surprise and that walking buys a slower, less prepared opponent, measured directly in the enemy's reaction time. This is one of the highest-value habits in the reference game and one no aim trainer teaches.

### 2.10 Mistakes that characterise each tier

All coaching opinion (Low–Med) except where marked; used as *habit probabilities* in the profiles so that each tier is beatable for the reason real players at that tier are.

| Tier (reference ladder) | Characteristic mistakes (sources) | Profile habit in Flickline |
|---|---|---|
| Lowest (Iron–Bronze) | Crosshair low; firing while running; crouch-spraying; long sprays at range (prosettings; Korotin 2019 CS). Headshot share ~11–15% (tracker.gg, High). | Large vertical placement error; moving-shot rate ~40%; crouch-on-fire ~50%; full sprays beyond 20 m; reloads in the open; re-peeks the same way. |
| Middle (Silver–Gold) | Crouch spray persists; predictable; weak trading (prosettings). Headshot share ~16–21%. | Regular strafe rhythm; wide-swings every angle; holds only common angles; trades late or not at all. |
| Upper (Platinum–Diamond) | Over-aggressive; poor trading; "play for stats" (prosettings). Headshot share ~22–26%. | Mostly disciplined stops; occasional over-peek after a hit; sometimes swings two angles at once; jiggles before swinging. |
| Top (Ascendant–Radiant) | "Few weaknesses"; varied timing, off-angles (prosettings, Dignitas). Headshot share ~27–32%. | Irregular strafes, off-angles, information peeks, retreats when damaged, varied re-peeks, quick trades. |

**Transfer.** Punishing a tier's mistakes is literally how a player climbs past that tier. Because Flickline's dial matches enemy tier to the player (design §9), the mistakes a player meets are the ones they must learn to punish next.

---

## 3. What shipped bots teach about looking human

| Lesson | Source | Use in Flickline |
|---|---|---|
| Aim = target point + skill-dependent offset re-randomised periodically + view drift, steered by a spring/damper whose stiffness rises while aiming. View independent of movement; bots see only their field of view. | Booth, *The Official Counter-Strike Bot*, GDC 2004, slides read (High) | 5.5 aim layer; F1 perception. |
| Difficulty scaled reaction, aim, extra attack delay, weapon proficiency; expert is "very good (but still human)". Per-bot variation in aggression, skill, teamwork, reaction, morale. Never the same phrase twice in a row. | Booth 2004 (High) | Profiles and personality (5.4), anti-repetition (5.7). |
| Real perception, no cheating, can be fooled; communicate intent through posture; discard hidden states and pure randomness in favour of reacting to the player. Tougher enemies were rated smarter in playtests. | Butcher and Griesemer, Halo, GDC 2002 (High) | F1–F3; readable posture and tells (5.6). |
| Imperfect senses, simulated aiming, reaction times are what makes bots feel fair; following a path directly looks robotic; pacing peaks last 3–5 s then relax. | Booth, Left 4 Dead, GDC 2009 (High) | Steering (5.7); director pacing is in the companion document. |
| Accuracy reduced by both sides' motion and by range; always look at the opponent; replay human movement traces; being stuck is the most bot-like tell. Two such bots reached ~52% "human" judgements in 2012, when humans averaged ~40%; in 2010 the least human human scored 35.5%. | UT^2 (Schrum, Karpov, Miikkulainen 2011; poster 2012) (High) | Motion-degraded accuracy via the real spread rules; mirror test (7.2); never-stuck rule. |
| Skill ladder: aim disturbed by enemy movement → linear lead → exact lead; reaction time in seconds; turn-rate caps. | Quake III `chars.h` (High) | Lead gain by tier (5.5); turn-rate and acceleration caps. |
| Signal-dependent noise (σ⊥ = 0.192 σ∥), ~0.2 s reaction delay, 100 ms control cycles fit to pro and amateur players. | Yoon et al. preprint (Med) | Aim noise model (5.5). |
| Aimbot detection uses only view-angle velocity, acceleration, direction and its change over ~1.5 s windows: robotic aim is visible in exactly these. | XGuardian (arXiv 2601.18068, High for features) | Signatures S2–S4 use the same features. |
| "With cheating, perception becomes reality"; random outcomes that favour the computer are perceived as intentional; accuracy should start low and converge as the AI "draws a bead". | Game Developer; Shamus Young (High) | Shots come from visible aim (no hidden rolls); tells over the convergence (5.6). |

---

## 4. Design goals for the enemy mind

1. **Mechanical truth first** (design pillar 1): enemies obey the player's movement, accuracy, recoil and damage rules, because a habit learned against an enemy that breaks them fails in the real game.
2. **Human distributions, not values**: every timing is drawn; every habit is a probability.
3. **Fair and readable**: the enemy knows only what it perceived; the player can always tell why they died.
4. **Matched**: profiles follow the dial so the player meets the mistakes of their own level.
5. **Deterministic and cheap**: seeded, zero allocation per tick, a few microseconds per enemy per tick (budget: all enemies ≤ 0.15 ms of the 0.5 ms sim tick, design §14.1).
6. **Measurable**: every claim of "human-like" maps to a signature the harness checks.

---

## 5. The behaviour model

### 5.1 Overview

```
            ┌────────────── the mind (sim/mind/, pure) ──────────────┐
 world ──▶  │ PERCEPTION      →  DECISION (FSM)     →  AIM + BODY    │ ──▶ EnemyCommand ──▶ shared movement + weapon sim
 events     │ sight, hearing,    hold / peek / duel /   aim point,     │      (same code path as the player's TickInput)
            │ memory, beliefs    disengage / trade ...  submovements,  │
            │                                          key presses     │
            └─── profile (dial anchors × personality) · RNG streams ──┘
```

- **Perception** turns world state into beliefs: which player hit zones are visible from the enemy's eye inside its field of view, what it heard and where it thinks the sound came from, the last known position and its age, whether a teammate died nearby.
- **Decision** is a small finite-state machine on #15's FSM base. It chooses *what* to do: hold, peek, duel, disengage, reposition, re-peek, trade, clear (pre-aim and pre-fire).
- **Aim and body** turns intent into a per-tick `EnemyCommand`: look angles produced by the aim model, move/crouch/walk/jump keys produced by short scripted key sequences (peek patterns, strafes, stops), and the fire button.
- **Execution** is not part of the mind: the command goes through `sim/movement.ts` and `sim/weapon.ts` exactly like the player's `TickInput`. One code path means an Echo's counter-strafe is the player's counter-strafe.

`EnemyCommand` has the same fields as `TickInput` (`moveX, moveZ, yaw, pitch, jump, crouch, walk, fire`). Gnats and Beacons are not humanoid and do not use the mind.

### 5.2 Decision states

| State | Enters when | Does | Leaves when |
|---|---|---|---|
| `hold` | Assigned a hold anchor, or no information | Stands at a hold spot, aims at the expected appearance point (5.4 placement), drifts and glances | Sees the player (`react`), hears the player (`alert`), or the director reassigns it |
| `alert` | Heard the player or a teammate's death | Turns towards the estimated position, raises expectation for that sector, may reposition to an off-angle (top tiers) or pre-aim it | Sees the player, memory expires (back to `hold`), or decides to `clear` |
| `clear` | Director role is "take" or it chose to push on information | Moves through the route, pre-aims common angles in order, peeks with a peek pattern, pre-fires only with information | Sees the player (`react`), route finished |
| `peek` | Chooses to contest a known or suspected angle | Runs a peek pattern (wide, jiggle, shoulder, jump, crouch, walk); takes the shot only on commit patterns | Pattern ends (`hold`/`clear`), sees the player (`react`) |
| `react` | A player hit zone becomes visible inside attention | Waits the drawn reaction time (never < 0.25 s), then starts the aim and the tell | Aim phase starts (`duel`) |
| `duel` | Aiming at or firing on the player | Flick and correction, stop before shooting (unless a moving-shot habit fires), burst by distance, strafe legs between bursts, crouch habit | Player dead, player lost from sight (`disengage` or `alert`), took damage (`disengage` by habit), out of ammo (`disengage`) |
| `disengage` | Hit, losing the duel, reloading, or the profile's retreat habit | Backs out of the angle *while still aiming at it* (top) or turns away (low), reloads behind cover (or in the open, a low-tier mistake) | Behind cover → `reposition` or `repeek` decision |
| `reposition` | After a contact by habit, or on director request | Moves to a different hold or peek spot via the nav graph | Arrives (`hold`/`peek`) |
| `repeek` | Decides to re-contest | Waits the drawn re-peek delay, re-peeks the same way, the same angle another way, or from elsewhere | Starts `peek` |
| `trade` | A teammate died within its perception | Waits reaction + swing delay, swings on the killer's last known position | `duel` or `alert` |

Transitions are evaluated at decision points, not every tick, at intervals drawn per enemy (lognormal median 0.12 s, matching the 100–125 ms command granularity used in published aim and movement models, Yoon et al., Durst et al.) so that enemies do not all decide on the same tick.

### 5.3 Perception, memory and expectation

- **Sight** (F1): an enemy sees the player when at least one sample point on the player's head or upper body has an unoccluded ray from the enemy's eye and lies within its horizontal field of view (the player's 103°, spec §1.1, so both sides share one rule). *Attention* is a narrower cone (±15°, HYPOTHESIS 40%) around its view direction: inside it reaction uses the profile's base draw; outside it but inside the field of view adds an orientation cost (+100 ms, from the ~100 ms peripheral capture time, Carrasco 2011; HYPOTHESIS 45%) plus the flick time to turn.
- **Hearing**: player footsteps (running only), landings, shots and reloads within the same radii the player uses to hear enemies (tunable, design §12), giving an estimated position with an error of `max(1.0, 0.25 × distance)` metres at the lowest anchor shrinking to `max(0.5, 0.10 × distance)` at the top (HYPOTHESIS 30%).
- **Memory**: last known position with a timestamp; it decays (confidence halves every 2 s, HYPOTHESIS) and is never refreshed without new perception. Teammates share a sighting only after a delay (lognormal median 0.8 s, standing in for a human callout; HYPOTHESIS 30%).
- **Expectation** modulates reaction: appearing in the attended sector where the enemy has information and roughly when it predicts (inside a 1.5 s window) subtracts 35 ms (from the 27 ms foreperiod and 47 ms valid-cue effects; DERIVED midpoint, Med) before the floor clamp; appearing behind or far off-axis with no information adds the orientation cost above. The floor (0.25 s) always applies after the modifier.

### 5.4 Profiles: parameters by anchor

A profile is the full parameter set. The dial (design §9) sets a **mind skill** `m` (0–100, equal to the mode's dial unless a mode says otherwise); parameters are interpolated linearly between the four anchors below. Then each enemy draws a **personality** at spawn: multiplicative jitter on reaction (±12%), aim noise (±20%), aggression (±25%) and habit rates (±20%), seeded (the ±20% spread mirrors the P25–P75 width of headshot rate within one rank, ±4 points on ~20%, tracker.gg; DERIVED). The anchors and their reference-ladder equivalents are calibration hypotheses (HYPOTHESIS 45% for the mapping), to be tuned by #53 against the signatures.

| Parameter | m = 0 (below the lowest rank: a first-week player) | m = 35 (lowest–middle ranks) | m = 65 (middle–upper ranks) | m = 100 (top ranks, never superhuman) | Basis |
|---|---|---|---|---|---|
| Reaction, ex-Gaussian μ / σ / τ (ms), before floor and expectation | 430 / 60 / 220 | 330 / 45 / 140 | 270 / 30 / 85 | 235 / 22 / 55 | Lab RT (2.5); τ ≈ 15–35% of mean; τ shrinks most with skill (Böer 2025). Means 650 / 470 / 355 / 290 ms. HYPOTHESIS (45%) for the absolute values. |
| Vertical crosshair offset when holding (° below head centre, mean, SD) | 6, 4 | 3, 2.5 | 1.2, 1.2 | 0.4, 0.6 | "Crosshair low" at low ranks (Low); CS placement 7–12° total (Low). HYPOTHESIS 35%. |
| Wide-swing anticipation (share of holds aimed beyond the corner edge) | 0.05 | 0.15 | 0.35 | 0.55 | nAts guide (Med); HYPOTHESIS 35%. |
| Off-angle hold share | 0.0 | 0.05 | 0.15 | 0.30 | Dignitas (Med); HYPOTHESIS 30%. |
| Flick throughput (bits/s) for movement time `MT = ID / TP` | 3.5 | 4.5 | 5.6 | 7.0 | #12 §2.3 (ESTIMATE). |
| Primary amplitude error: bias, SD (fraction of distance) | −0.04, 0.16 | −0.05, 0.11 | −0.06, 0.08 | −0.06, 0.06 | Undershoot bias (Elliott 2017); gives P(overshoot) ≈ 40 / 33 / 23 / 16%, between Elliott's 5% and Roberts' 60–78%. HYPOTHESIS 40%. |
| Correction delay (ms, lognormal median) | 200 | 170 | 140 | 120 | 100–200 ms (Elliott 2017, High). |
| Settle noise at the aim point (° SD) | 1.6 | 0.9 | 0.5 | 0.3 | Calibrated so S7 (headshot share) lands in band; HYPOTHESIS. |
| Fires during final approach ("swipe") vs after landing | 0.05 | 0.15 | 0.35 | 0.55 | Donovan 2022 direction (High); values HYPOTHESIS 30%. |
| Tracking delay (ms) / lead gain | 260 / 0.0 | 220 / 0.3 | 190 / 0.6 | 160 / 0.85 | Parker 2021 (180–220 ms unpredictable, High); Quake III ladder (High). |
| Moving-shot habit (share of shots fired above the gate) | 0.50 | 0.30 | 0.15 | 0.06 | Leetify rank-average good-shot share ~75–82% (Low); Korotin 2019 (Med). |
| Shot-after-gate delay (ms, lognormal median) | 180 | 140 | 100 | 70 | HYPOTHESIS 40%. |
| Spray compensation (fraction of recoil countered per bullet) | 0.25 | 0.45 | 0.65 | 0.82 | Calibrated against spray accuracy ~32% rank average, ~50% best pro (CS, Low–Med). |
| Burst policy | Full spray at all ranges | Spray ≤ 20 m, bursts of 4–6 beyond | Taps beyond 25 m, bursts of 2–4 at 12–25 m, spray < 12 m | Taps beyond 20 m, bursts of 2–3 at 10–20 m, spray < 10 m | Riot data (half of one rifle's kills < 15 m, High); coaching (Low). |
| Strafe leg duration (lognormal median s, CV) | 0.9, 0.25 | 0.65, 0.15 (regular) | 0.5, 0.30 | 0.42, 0.45 | HYPOTHESIS 35%; deliberate mid-tier regularity (2.4). |
| Crouch on firing (per duel) | 0.55 | 0.45 | 0.25 | 0.15, max twice per duel | Coaching (Low–Med). |
| Peek mix when contesting: wide / jiggle / shoulder / jump / crouch / walk | 0.60 / 0.05 / 0.05 / 0.0 / 0.05 / 0.25 | 0.65 / 0.10 / 0.05 / 0.02 / 0.08 / 0.10 | 0.50 / 0.22 / 0.12 / 0.05 / 0.06 / 0.05 | 0.40 / 0.30 / 0.15 / 0.07 / 0.06 / 0.02 | Coaching (Low); walk peeks "the worst way to peek" (Dignitas, Med). HYPOTHESIS 30%. |
| Retreat after taking damage without a kill | 0.15 | 0.30 | 0.55 | 0.75 | Coaching (Med). |
| Reload in the open (when the magazine is under 30%) | 0.6 | 0.4 | 0.15 | 0.05 | Reloads are audible info (Riot 2.06, High); HYPOTHESIS. |
| Re-peek same angle, same way | 0.75 | 0.60 | 0.35 | 0.15 | Coaching (Med). |
| Re-peek delay (lognormal median s) / instant re-peek share | 1.4 / 0.05 | 1.6 / 0.08 | 2.0 / 0.12 | 2.4 / 0.20 | HYPOTHESIS 30%. |
| Trades when a teammate dies in perception / swing delay median (s) | 0.25 / 1.6 | 0.45 / 1.2 | 0.70 / 0.9 | 0.90 / 0.7 | 5 s trade window (Med); "poor trading" at upper-middle (Low). HYPOTHESIS 30%. |
| Pre-fire on an informed common angle | 0.0 | 0.10 | 0.35 | 0.55 | Coaching (Low–Med). |
| Calibration target: headshot share of the enemy's hits on a standard moving bot (signature S7) | ~9% | ~15% | ~23% | ~30% | tracker.gg medians (High), shifted down a little at m = 0 to sit below the lowest rank. |

Reading the table: the dial still controls the axes of design §9.4 (distance, density, exposure, tell length) through the mode; the mind skill replaces the separate "enemy reaction" and "enemy hit chance" axes for player-like enemies with these human parameters. Fairness floors are applied after interpolation and jitter, always.

### 5.5 Aim model

Per tick, for the current aim target (a point on the player chosen by the aim policy: head centre at the top anchors, upper chest at m = 0, with the vertical offset above):

1. **Reaction**: no movement towards a new target until the reaction draw has elapsed (5.3).
2. **Primary submovement**: planned amplitude = angular distance × (1 + e), e ~ N(bias, SD) from the profile; duration from the Fitts model with the profile's throughput; angular velocity follows a minimum-jerk profile; Gaussian noise added to angular velocity with SD = k × |ω| along the movement and 0.192 × that across it (Yoon et al.); `k` per profile, calibrated with the settle noise.
3. **Correction**: after the correction delay, a new submovement towards the (now updated) target with a smaller amplitude error (SD halves each submovement), up to three.
4. **Settle**: a smooth, seeded low-frequency drift (value noise, period 0.3–0.8 s) with the profile's settle SD. Never zero.
5. **Tracking a moving player**: the target point is the player's position observed `trackingDelay` ago, extrapolated by `leadGain × velocity × trackingDelay`. On a player reversal, the extrapolation is wrong for about one delay, producing the human overshoot-and-recover the player can exploit.
6. **Fire decision**: in `duel`, fire when the crosshair is within the aim zone's angular radius plus a tolerance, the body is under the gate (or the moving-shot habit fires), the tell has completed, and the shot-after-gate delay has elapsed; "swipe" profiles may fire during the final approach.
7. **Caps**: angular speed ≤ 1,500°/s and angular acceleration capped so that a 90° flick is never faster than the profile's Fitts time (HYPOTHESIS: cap set from human flick kinematics, to be checked against the mirror data). No instantaneous view change ever.
8. **Shots** go through `sim/weapon.ts` with the spec's first-shot spread, movement error, recoil and the profile's spray compensation. Damage and tagging use #31's rules unchanged.

Cost: a few dozen multiplies per enemy per tick; no allocation (fixed-size state per enemy).

### 5.6 Fairness and readability rules

| Rule | Statement | Why |
|---|---|---|
| F1 Real perception | No state transition, aim or shot may depend on player data the enemy has not perceived (sight inside its field of view with line of sight, or sound inside its radius, or a shared callout after its delay). | Halo, CS bot, Left 4 Dead: "no cheating", "simulated senses". |
| F2 Information-gated pre-fire | Pre-fire and pre-aim of an exact spot require a memory entry younger than its window; otherwise the enemy pre-aims only map-common angles. | A human pre-fires only what they suspect. |
| F3 No occluded shots | Enemies never fire at a player who is not visible unless pre-firing under F2, and their bullets obey the same wall rules as the player's. | Fairness, transfer. |
| F4 Floors | Reaction ≥ 0.25 s, tell ≥ 0.25 s (≥ 0.30 s at dial 100 per #12 P6), exposure floors per mode, nothing visible within 4 m where enemies shoot (#12 P6). Clamps apply after jitter. | Design §9.3 as revised by #12. |
| F5 The tell is the real aiming phase | The tell starts when the aim phase starts and lasts `max(aim phase, tell floor)`. If the enemy is already on target (a pre-aimed holder), it holds fire for the floor. The tell never adds delay to an enemy that is still aiming. | Readable without lying: it draws what the enemy is doing. |
| F6 Same rules | Enemies use the player's movement, spread, recoil, damage and tagging. Their accuracy falls when *they* move and when *you* move, because both are real. | Mechanical truth; UT^2's motion-degraded accuracy. |
| F7 Readable intent | Posture shows state: weapon raised in `duel`, lowered and turned in `disengage`, crouch visible, footsteps and reloads audible from enemies under the same radii as the player's. | Halo: "communication of intent". |
| F8 Honest deaths | Every `playerDamaged` carries the source's state (reaction drawn, was the player moving, peek type, tell length) so the results card can say why (backlog item M8). | "With cheating, perception becomes reality" — transparency is the antidote. |
| F9 Bounded pressure | The director (#51) limits simultaneous shooters and staggers tells; no two tells may start within 0.15 s of each other unless the dial's density requires it. | Readability under load. |

### 5.7 Not looking robotic

- Every duration is a draw; no enemy repeats the same peek type three times in a row or the same re-peek within 10% of the previous delay (Booth's never-twice rule).
- Personality jitter makes two enemies at the same dial different.
- The view is never still (drift, glances) and never snaps (caps, minimum-jerk profiles, noise proportional to speed).
- Movement uses look-ahead steering, never exact path following (Left 4 Dead), with an anti-stuck watchdog (UT^2: being stuck is the most bot-like tell).
- Decisions happen at jittered intervals so groups do not act on the same tick.
- Deliberate, designed mistakes from the profile (2.10) instead of uniform random inaccuracy ("Intelligent Mistakes").

### 5.8 Determinism and data

- **RNG streams**: each enemy owns an `Rng` seeded by a hash of `(runSeed, enemySerial, stream)`, with separate streams for personality, reaction, aim noise and decisions. Adding an enemy or a draw in one stream never shifts another enemy's draws, so replays and tests are stable.
- **Distributions** (in `core/` or `sim/mind/dist.ts`): normal (Box–Muller, both outputs consumed), exponential, ex-Gaussian (normal + exponential), lognormal by median and CV, truncation by rejection (at most 8 tries, then the bound) and weighted choice with a no-third-repeat rule. No allocation.
- **Config**: `config/mind.ts` holds the anchor table, personality spreads, caps, radii and floors, aggregated into `tunables` (design §14.4). A change in the table never requires a code change.
- **Events**: `enemyStateChanged { id, state }`, `enemyReacted { id, reactMs, expected }`, `enemyPeeked { id, pattern }` added to the vocabulary (design §14.3) for stats, the death recap and the harness.

### 5.9 How it plugs into existing work

| Existing | What changes |
|---|---|
| #15 enemy framework | The mind sits on the FSM base; needs the base to expose per-enemy RNG streams and decision-point scheduling. No change to hit zones. |
| #32 Strafer and Peeker | Both become mind presets. Strafer in drills: the duel-strafe script with fire disabled; leg lengths become lognormal draws instead of uniform 0.3–1.0 s, keeping the §9.4 dial means. Peeker: peek patterns run as key sequences through movement. In Sweep and Corner Clear, the §5.3 seeded `pHit` roll is replaced by aimed shots; `pHit` per dial becomes the harness calibration target. The tell is kept and follows F5. |
| #33 Rusher, Bulwark | Rusher = high-aggression personality with `clear`/push behaviour; it *stops* to fire (counter-strafe) at m ≥ 35 and runs-and-guns at low m, instead of "slows and fires". Bulwark = walking (silent) profile with the plate; it holds and pushes slowly. Gnat stays a scripted drone. |
| #17 dial and skill model | Adds a "mind skill" axis (equal to the dial by default) replacing "enemy reaction" and "enemy hit chance" for mind-driven enemies. Floors unchanged. |
| #51 Sweep director | Chooses roles (hold, take, trade pair) and profiles per contact; limits simultaneous tells (F9). Scenario sampling is specified in the companion document. |
| #53 balance | Tunes the anchor table against signatures S1–S11 and the playtest; the calibration targets replace `pHit` tuning. |
| #28 bot harness | Gains the signature suite (backlog M7) and a "standard moving player" bot used for calibration. |
| #31 damage and tagging | Unchanged; enemy hits drive it. |
| #41 audio | Enemy footsteps and reloads are information cues with radii symmetric to the player's. |

---

## 6. Transfer summary

| Enemy behaviour | What the player learns | Where |
|---|---|---|
| Stops before shooting; first bullet accurate only from a stop | Read the enemy's stop as its danger window; shoot the stop | Sweep, Corner Clear, Strafe Track |
| Leading, delayed tracking | Strafe irregularly; a rhythm is free damage | Sweep |
| Reaction faster when expecting you | Deny information: walk, change timing, use off-angles, re-peek elsewhere | Sweep, Corner Clear |
| Holders pre-aim common spots at head height; good ones anticipate wide swings | Swing wide or jiggle first; clear off-angles | Corner Clear |
| Peek patterns from real movement | Don't shoot bait; hold where wide swings end; expect crouch peeks low | Corner Clear, Sweep |
| Re-peek and trade behaviour | Don't stay after a kill; pre-aim the low-tier re-peek; punish reloads | Sweep |
| Tier mistakes | Punish the mistakes of your own level | All matched modes |
| Undershoot-and-correct aim | Two-stage aim is normal; trust the correction | Watching enemies; Orbit |

---

## 7. Judging "feels like a real player"

### 7.1 Looked-at checklist (for playtests, #56 and the feel track #62)

Watch and answer yes/no with a note; a "no" on any of F-items is a bug, the rest feed tuning.

1. **Earned deaths**: after each death, could you name why (you were stopped in its sight, you ran into a pre-aim, you re-peeked the same way)? (F)
2. **No knowledge without reason**: did any enemy aim at or shoot you when it could not have seen or heard you? (F)
3. **No snapping**: did any enemy turn or lock on faster or more straight than a person could? (F)
4. **Stops**: do enemies visibly stop before their accurate shots, and do low-tier enemies sometimes run and shoot (and miss)?
5. **Peeks**: can you recognise wide, jiggle, shoulder, jump and crouch peeks; does each look like what players do?
6. **Holds**: are enemies' crosshairs at plausible heights; do better enemies hold off-angles and anticipate wide swings?
7. **Strafing**: can you learn the rhythm of a middle-tier enemy and *not* of a top one?
8. **After contact**: do damaged enemies retreat, reload, reposition or re-peek in ways you recognise? Do teammates trade?
9. **Sound**: does running near an enemy make it ready for you, and does walking surprise it?
10. **Variety**: did two enemies of the same type ever feel like clones?
11. **Mistakes**: were low-tier mistakes visible and punishable (reloading in the open, re-peeking the same way, crouch-spraying)?
12. **Nothing stuck**: did any enemy walk into a wall, jitter in place or get stuck? (F)

### 7.2 Mirror test (blind)

Because enemies and the player run the same body and command format, a recorded run can show the *player's own body* as an Echo from a spectator camera, moving exactly as the human moved. Protocol: record a playtester's Corner Clear and Sweep runs (input stream and seed; the sim is deterministic, so the run replays exactly); cut 10 clips of 5–8 s showing the human's body as an Echo in a duel, and 10 clips of a mind-driven Echo at a matched dial in similar situations; shuffle; three viewers label each clip human or bot and give a one-line reason. **Pass**: mind clips are judged "human" at a rate no more than 15 points below the human clips' rate in the same session (human judges misjudge humans too, so the comparison is relative), and no single mind clip is judged "bot" by all three viewers for the same stated reason. Cheap: a spectator camera on an existing replay, minutes per run.

### 7.3 Measurable signatures (bot harness, seconds in CI)

Each signature runs the mind against scripted player bots (standing, regular ADAD, random ADAD, peeking) on a test map and checks a band per anchor. Bands are first estimates to be tightened by #53.

| Id | Signature | Band (pass) |
|---|---|---|
| S1 | Reaction distribution: right skew (mean > median), τ share of mean, coefficient of variation, minimum, no spike | mean − median > 5 ms; τ/mean 0.12–0.40; CV 0.10–0.35; min ≥ 0.25 s; no 5 ms bin holds > 8% of draws |
| S2 | Flick kinematics on flicks > 10° | peak/mean angular speed 1.5–2.2; peak at 35–65% of the primary; ≥ 1 correction on 40–85% of flicks; overshoot share within ±8 points of the profile |
| S3 | No snapping | no tick with angular acceleration above the cap; no view change > 3° in one tick outside a primary submovement |
| S4 | Tracking lag (cross-correlation of player lateral angle vs enemy aim) | random ADAD: 120–300 ms; regular ADAD at m ≥ 65: < 120 ms after two cycles |
| S5 | Stop discipline | share of shots above the gate within ±5 points of the profile; shot-after-gate median within ±25% |
| S6 | Strafe legs | CV within ±0.08 of the profile; no two consecutive legs within 10 ms more than 5% of the time at m = 100 |
| S7 | Headshot share of hits on the standard moving bot | within ±5 points of the anchor target |
| S8 | Re-peek behaviour | same-angle-same-way share within ±10 points of the profile |
| S9 | Information honesty | zero aims within 5° of, and zero shots at, a player who is occluded and unheard with no memory entry; zero pre-fires without memory |
| S10 | Variety | no peek type three times in a row per enemy; peek-mix entropy ≥ 1.2 bits at m ≥ 65 |
| S11 | Determinism and isolation | identical traces for identical seeds; adding a third enemy leaves the first two enemies' traces unchanged |

**Measuring the hypotheses on our own players (the plan for every HYPOTHESIS above).** Flickline records each run's input stream locally. With opt-in export (design §14.5 JSON), the first-release playtests (#56) give: player strafe-leg lengths and CV in duels, peek key-press durations and resulting exposure, shot-after-gate delays, crouch-on-fire rate, re-peek delays and same-angle share, time-to-shot by expectation (expected vs off-angle appearances). These replace the HYPOTHESIS values in the anchor table, row by row (backlog M9). Real reference-game data could be added later from CS2 demos (open-source parsers expose per-tick velocity), but that is optional and out of scope.

---

## 8. Open questions and default answers

| # | Question | Default |
|---|---|---|
| 1 | Should enemies get a simulated peeker's advantage (40–70 ms) to match the reference game? | No. It would be invisible and feel unfair; the player having no network delay is noted as a transfer gap. Revisit only if playtesters report that real duels feel faster. |
| 2 | Aimed shots or seeded `pHit` rolls? | Aimed shots for mind-driven enemies (Sweep, Corner Clear); drills that never shoot keep scripted behaviour. `pHit` becomes a measured calibration target. |
| 3 | Can the dial-100 enemy be as fast as the best humans? | No. The floors keep its time from exposure to first shot at 0.55 s or more, about 0.6 s on average (≈ a typical ranked player's time-to-damage). Top-anchor realism comes from decisions and variety, not speed. |
| 4 | Is walking silent? | Yes in v1 (most-cited behaviour, clear rule for the player); radii are tunables. |
| 5 | Do enemies communicate? | Only through delayed shared sightings (a callout stand-in), never instant team knowledge. |
| 6 | Should the mid-tier strafe really be regular? | Yes by default: it gives the player something learnable at the matching level and contrasts with the top anchor. Flip if the mirror data shows mid-level humans are irregular too. |
| 7 | What if a signature and the playtest disagree? | The looked-at playtest wins for "feel"; the signature band is adjusted and the reason recorded on #70. |

---

## 9. Changes to existing issues (posted as comments)

- **#32**: lognormal strafe legs; peeks as key sequences through shared movement; aimed shots replace `pHit` in Sweep and Corner Clear (calibration target instead); tell follows F5; Strafer and Peeker as mind presets (M5, M6).
- **#33**: Rusher stops to fire above m = 35 and runs-and-guns below; Bulwark walks silently; Gnat stays scripted; nav walker uses look-ahead steering and an anti-stuck watchdog.
- **#51**: director assigns roles and profiles, limits simultaneous tells (F9), sends trade pairs; scenario sampling from the companion document.
- **#53**: tune the anchor table against S1–S11 and the mirror test; `pHit` becomes a check; replace HYPOTHESIS rows with player data (M9).
- **#15, #17, #28** (informational): RNG streams per enemy and decision-point scheduling; a mind-skill axis; the signature suite and the standard moving bot.

## 10. Implementation backlog (filed as issues, listed on #70)

| Id (issue) | Issue | Depends on |
|---|---|---|
| M1 (#86) | feat(enemies): seeded per-enemy RNG streams and human timing distributions | #15 |
| M2 (#87) | feat(enemies): shared kinematic body — enemies driven by `EnemyCommand` through the player's movement and weapon code | #15, #14 |
| M3 (#89) | feat(enemies): enemy perception — sight, attention, hearing, memory, shared sightings | M1, #16 |
| M4 (#90) | feat(enemies): human aim model — reaction with expectation, submovements, tracking with lead, stop-gated fire | M1, M2, M3 |
| M5 (#91) | feat(enemies): mind decision FSM — hold, alert, react, duel, disengage, reposition, re-peek | M3, M4 |
| M6 (#92) | feat(enemies): peek patterns, clearing, pre-fire and trades | M5, #34 |
| M7 (#93) | test(enemies): humanness signature suite (S1–S11) in the bot harness | M4, M5, #28 |
| M8 (#94) | feat(feedback): honest death recap — what the enemy did and why you lost the duel | M4, #31, #39 |
| M9 (#95) | research(enemies): measure player movement and timing from playtest input logs and replace HYPOTHESIS values | M2, #56 |
| M10 (#96) | playtest(enemies): "feels like a real player" pass — checklist and blind mirror test | M5, M6 |
| M11 (#88) | feat(config): mind profiles — anchor table, personality jitter and dial mapping | M1, #17 |

## 11. Sources

Fetched 2026-11-14 (research notes with full quotes are kept with the task data, not in the repo).

**Reference game and stats**
- Riot, *Peeking into VALORANT's Netcode* (2020-07-28): https://www.riotgames.com/en/news/peeking-valorants-netcode
- Riot, *04: On Peeker's Advantage & Ranked*: https://playvalorant.com/en-us/news/game-updates/04-on-peeker-s-advantage-ranked
- Riot dev relay of stop-time tests: https://devtrackers.gg/valorant/p/f29d0021-walking-running-accuracy-too-high
- Riot patch notes 6.11: https://playvalorant.com/en-us/news/game-updates/valorant-patch-notes-6-11/ ; 2.06 (HRTF): https://playvalorant.com/en-us/news/game-updates/valorant-patch-notes-2-06
- Riot, *Ask VALORANT #6* (audio): https://playvalorant.com/en-us/news/game-updates/ask-valorant-6/
- Riot, *Data drop: Phantom vs Vandal*: https://playvalorant.com/en-us/news/dev/valorant-data-drop-phantom-vs-vandal/
- tracker.gg, *Is your headshot rate actually good for your rank?* (2026-11-11): https://tracker.gg/valorant/articles/is-your-headshot-rate-actually-good-for-your-rank
- Leetify stats glossary: https://leetify.com/blog/leetify-stats-glossary/ ; *Enemy (actually) spotted*: https://leetify.com/blog/enemy-actually-spotted/
- HLTV Rating 3.0 (reprint): https://www.dust2.us/news/64901/hltv-launches-rating-30
- Nomiun, CS pro aim (Leetify data): https://nomiun.substack.com/p/which-cs-pros-have-the-best-aim

**Coaching (Low–Med)**
- Dignitas: https://dignitas.gg/articles/how-to-stop-losing-your-gunfights-in-valorant ; https://dignitas.gg/articles/youre-holding-the-wrong-angle-a-valorant-guide ; https://dignitas.gg/articles/perfect-your-peeking-and-angles-in-valorant ; https://dignitas.gg/articles/lining-yourself-up-to-win-an-aiming-and-positioning-guide-for-valorant ; https://dignitas.gg/articles/cs2-the-micro-movements-that-pros-abuses ; https://dignitas.gg/articles/10-small-mistakes-you-re-making-in-cs2-that-are-costing-you-rounds ; https://dignitas.gg/articles/tricking-your-opponent-via-sound-in-valorant
- CSDB: https://csdb.gg/the-cs2-peekers-advantage
- OneEsports (nAts): https://www.oneesports.gg/valorant/nats-crosshair-placement-guide/
- prosettings: https://prosettings.net/blog/how-to-peek-in-valorant/ ; https://prosettings.net/blog/valorant-tips-for-each-rank/
- metabot: https://metabot.gg/en/valorant/guides/valorant-peeking-guide-jiggle-wide-shoulder ; boostroom: https://boostroom.com/blog/peeking-like-a-pro-jiggle-shoulder-and-wide-swings-explained

**Human performance literature**
- Woods et al. 2015: https://pmc.ncbi.nlm.nih.gov/articles/PMC4374455
- De Jesus Cintron and Yang 2024: https://pmc.ncbi.nlm.nih.gov/articles/PMC11504915 ; Gazzanigo et al. 2025: https://pmc.ncbi.nlm.nih.gov/articles/PMC12546761
- Böer et al. 2025: https://pmc.ncbi.nlm.nih.gov/articles/PMC11885344
- Toth, Kowal and Campbell 2019: https://pmc.ncbi.nlm.nih.gov/articles/PMC6932966 ; Dye, Green and Bavelier 2009: https://pmc.ncbi.nlm.nih.gov/articles/PMC2871325
- Scerrati et al. 2017: https://pmc.ncbi.nlm.nih.gov/articles/PMC5736580 ; Piccardi et al. 2025: https://www.frontiersin.org/journals/psychiatry/articles/10.3389/fpsyt.2025.1605608/full ; Carrasco 2011: https://pmc.ncbi.nlm.nih.gov/articles/PMC3390154/
- Elliott et al. 2017 (author manuscript): https://hira.hope.ac.uk/2062/1/Elliottetal2017NBR.doc ; Roberts, Burkitt and Elliott 2024: https://pmc.ncbi.nlm.nih.gov/articles/PMC10973010
- Flash and Hogan 1985: https://pubmed.ncbi.nlm.nih.gov/4020415/
- Donovan et al. 2022: https://pmc.ncbi.nlm.nih.gov/articles/PMC9744923 ; Boudaoud, Spjut and Kim 2022: https://ar5iv.labs.arxiv.org/html/2203.12050
- Parker et al. 2021: https://pmc.ncbi.nlm.nih.gov/articles/PMC7884356/ ; van de Kamp et al. 2013: https://pmc.ncbi.nlm.nih.gov/articles/PMC3536613
- Korotin et al. 2019 (CS:GO sensing study): https://arxiv.org/abs/1908.06403 ; Durst et al. 2024: https://arxiv.org/abs/2408.13934

**Bot design**
- Booth, *The Official Counter-Strike Bot*, GDC 2004 slides: https://media.gdcvault.com/gdc04/slides/making_of_official.pdf
- Booth, *The AI Systems of Left 4 Dead*, 2009: https://cdn.fastly.steamstatic.com/apps/valve/2009/ai_systems_of_l4d_mike_booth.pdf
- Butcher and Griesemer, *The Illusion of Intelligence*, GDC 2002: https://www.jmeiners.com/shamans/papers/ai/the_illusion_of_intelligence.pdf
- Schrum, Karpov and Miikkulainen 2011 (UT^2): https://nn.cs.utexas.edu/downloads/papers/schrum.cig11competition.pdf ; BotPrize 2012 poster: https://people.southwestern.edu/~schrum2/AAAI-BotPrizePoster.pdf
- Yoon et al., aim-and-shoot model (preprint): https://d1qx31qr3h6wln.cloudfront.net/publications/Aim_and_Shoot_preprint.pdf
- Quake III Arena `chars.h`: https://raw.githubusercontent.com/id-Software/Quake-III-Arena/master/code/game/chars.h
- XGuardian (arXiv 2601.18068): https://arxiv.org/abs/2601.18068
- Holden, *Spring-It-On*: https://theorangeduck.com/page/spring-roll-call
- Shamus Young, *AI Follies: Targeting*: https://www.shamusyoung.com/twentysidedtale/?p=4113 ; Game Developer, *Game AI & Our Cheatin' Hearts*: https://www.gamedeveloper.com/game-platforms/analysis-game-ai-our-cheatin-hearts ; *Intelligent Mistakes*: https://www.gamedeveloper.com/programming/intelligent-mistakes-how-to-incorporate-stupidity-into-your-ai-code
