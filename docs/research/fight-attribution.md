# Fight attribution: telling the player whether a fight was lost to mechanics or to the situation

Research and recommendation for the open question **#110**, which came out of **#74 (information and engagement scenarios)** and touches **#70 (player-like enemies)**. Companion documents: `docs/research/engagement-information.md` (which fights happen and what each side knows), `docs/research/player-like-enemies.md` (how an enemy behaves inside a fight), `docs/research/human-performance.md` (time-to-shot and flick-time baselines), `docs/research/cues.md` (cue perception budget).

- Research date: 2026-11-14. Reference game: Valorant ("the reference game"); Counter-Strike and other games are labelled.
- Evidence tags as in the companion documents: **High** (primary source text read), **Med** (abstract, or a secondary source pointing to a primary one), **Low** (coaching, vendor or forum content without a method), **DERIVED** (arithmetic shown), **HYPOTHESIS (n%)** (no evidence; a stated design assumption with my confidence and the test that settles it, section 8).
- This document proposes; it does not edit `docs/design.md`. Changes to existing issues are posted as comments (section 10.2). Issue #110 stays open until the readout is built and judged in play.

---

## 1. Summary

**The question (#110).** Varied, asymmetric fights pull against instant feedback, because they are slower and less clean than a drill and a player can lose one through no mechanical fault. The game has to tell the player which it was (out-positioned, or missed the shot), or the feedback loop gets noisy.

**Findings**

1. **No shipped game or review tool found writes a cause of death.** In-game recaps (the reference game's combat report, League of Legends' Death Recap, Overwatch's kill cam, Apex's recap, Counter-Strike's damage report) list damage and its source and leave the judgement to the player. Review tools for Counter-Strike (Leetify) measure the parts of a fight precisely (time from spotting to damage, crosshair placement, counter-strafe share, traded deaths) but never label a death mechanical or situational. Coaching checklists do label deaths, by hand, minutes per death (section 4).
2. **The closest models of "skill versus luck" judge the decision against a reference in one currency**: chess.com labels a move by expected points lost, with thresholds that depend on rating; poker's luck adjustment replaces the outcome with its expectation once the player's choices are made; expected goals rates the chance before the shot (section 4.3).
3. **Feedback research gives clear constraints** (section 5): over a third of feedback interventions make performance worse, mostly when they point attention at the self (Kluger and DeNisi 1996, Med); controllable, unstable causes keep people trying and stable ones discourage them (Weiner, High; Rascle 2015, Med); people already blame losses on circumstances (d ≈ 0.6–1.0, Med); constant feedback can create dependency while summary and bandwidth feedback help retention (guidance hypothesis, Med–High); a player reads about four words a second at best (Brysbaert 2019, High).
4. **The simulation can measure nearly everything a coach asks about a fight exactly** (section 3): who saw whom first and through which channel, whether the enemy expected the player, who created the line of sight, the aim error before spread, the window before damage. Only "did the player notice an enemy that was technically visible" needs an estimate.

**Recommendation** (sections 6 and 7)

1. **Attribute each fight that cost HP to at most one of three plain causes**: **Aim** (your execution: late, missed the first shot, shot while moving, crosshair far off the angle, spray fell apart), **Play** (your decision: it heard you run, you swung into two angles, you peeked a held angle, same peek twice, stayed after the kill, reloaded in the open, wrong gun for the range) and **Dealt** (the situation, not you: a quick enemy, an unavoidable crossfire, a hit from out of sight). Aim and Play are both the player's to fix; only Dealt says "nothing to fix". Three buckets, not two, because "out-positioned" is usually the player's own decision, and calling it "the situation" would teach the wrong lesson.
2. **Decide with one counterfactual: "your normal self".** For each duel, compute the time *you* normally need to land a first hit from the moment you could see the enemy (your own median time-to-shot plus a flick time from your own throughput, the **par**). Compare it with when the enemy actually hit you. If your normal self would have hit first, the fight was **winnable** and the loss goes to the Aim cause that cost the most milliseconds. If even your normal self would have lost, the window was too short, and the loss goes to the Play cause that shortened it, or to Dealt if nothing the player did shortened it. Inside a ±50 ms band it was a **close fight** and the game says so, or says nothing. Because par is the player's own, the readout is matched to skill level: a new player is not told "late" for being exactly as fast as they normally are.
3. **Flickline can measure what review tools for the reference game have to guess**, because it is the simulation: it knows the enemy's real perception, expectation and reaction draw (mind rule F8), who created the line of sight, and the aim ray before spread. Real-game tools have to infer all of that from demos. Every fact the model uses is either exact ground truth or a stated estimate with its confidence.
4. **Present it at three speeds, and never on top of the per-shot feedback.** Per shot: unchanged (hitmarkers, sounds and the amber moving-shot cue stay the only thing near the crosshair). Per fight: a six-word **cause line** beside the HP bar, shown only when a fight cost real HP or was won against the odds (bandwidth feedback), colour plus glyph per bucket, no new sound. Per run: death cause as the first line of the results card, a **"where your HP went"** bar split Aim / Play / Dealt, and the fix engine's one thing to fix drawn only from Aim and Play.
5. **Validate it before anyone plays it**: fault-injected bots in the bot harness (a bot that always shoots while moving must be told "shot while moving", a perfect-aim bot that runs loudly must be told "it heard you run", a perfect bot thrown into a forced crossfire must get Dealt). Then a playtest that asks testers *why* they died before showing the line, and measures agreement.

---

## 2. Why varied fights make feedback noisy

In a drill, outcome and mechanics are almost the same thing: a Post at a known spot dies if the first bullet hits the head. The per-shot feedback (design §7) can therefore say "you missed" and that *is* the lesson.

In the fights `engagement-information.md` deliberately samples (holds, takes against an expecting enemy, breaches, crossfires, flanks, trades; the clean symmetric duel capped at 5% of Sweep), outcome and mechanics separate in both directions:

| Case | What happened | What the player concludes without help | What they should learn |
|---|---|---|---|
| Perfect flick, still dead | The enemy heard the player run, pre-aimed the spot, reacted 35 ms faster (mind §5.3) and needed no flick. | "My aim is too slow" → plays Orbit. | Walk the last metres, or jiggle before swinging. Aim was fine. |
| Clean kill, sloppy play | The enemy was looking away (`take-unaware` card); the player's first two shots missed while moving. | "Nice, I won." | Shot while moving; a holder would have killed you. |
| Two angles | A second enemy hit the player while they were dueling the first. | "That was unfair" or "I was too slow". | You swung into two angles; isolate one. |
| Really dealt | A matched enemy drew a reaction in its fast tail and hit a well-timed peek. | "I'm bad." | Nothing; that happens (Riot: duels are decided by 20–50 ms, High). |

Two numbers make the noise concrete. Matched difficulty targets a 70% success rate (design §9.3), so even a player playing at their exact level loses about three fights in ten through ordinary variance. And on a take against an expecting holder, the reference game's own design gives the holder the advantage (Riot: "a player holding territory should, on average, have an advantage over a player taking territory", High; engagement-information §1). A loss there says little about aim unless something tells the player which part of it was aim.

The design already reaches for this in two places, without a model behind them: Sweep's results line "the single biggest HP loss ('you lost 40 HP to Rushers while reloading')" (design §4.8), and the honest death recap (#94, mind rule F8) that shows the enemy's side. This document turns those into one model.

---

## 3. What the simulation can measure about a fight

### 3.1 Units: contact, duel, damage

- **Contact**: what the Sweep director sends (one to four enemies, design §4.8) or one Corner Clear angle. Begins at the first information either side has about the other; ends when every enemy in it is dead, or when no enemy has seen the player or been seen for 2 s (HYPOTHESIS 50%: long enough for a re-peek to count as the same contact, short enough that the next contact is separate).
- **Duel**: the player against one enemy inside a contact, from the first moment either could see the other until one dies or line of sight is broken for more than 1 s.
- **Damage instance**: one `playerDamaged`. Each is assigned to the duel of its source, so HP lost can be split by cause even in a multi-enemy contact.

Because Sweep and Corner Clear end at 0 HP, most fights the player "loses" without dying are **bloodied wins** (killed everything, lost a lot of HP) or **unresolved** contacts (the enemy retreated); a real loss happens once per run, at death. The model therefore attributes *HP cost*, not only deaths.

### 3.2 The facts

"Exact" means the simulation knows it as ground truth; "estimate" means a model of the human is involved.

| # | Fact | Definition | From (events; **new** fields in bold) | Exact? |
|---|---|---|---|---|
| F1 | **Who perceived whom first, and by what channel** | Player: first `targetVisible` (in frustum, unoccluded) of the enemy; first enemy sound audible to the player (running footstep, landing, shot, reload inside the symmetric radius); callout stand-in. Enemy: the mind's first perception of the player and its channel (sight, sound, shared sighting) and whether it was *expecting* the player. `Δsight = tEnemySaw − tPlayerSaw` (positive: the player saw first). | `targetVisible`; `footstep` with **`audibleToPlayer`**; **`enemyPerceived { id, channel, expected }`** from mind perception (#89) | Enemy side exact. Player side exact for "could have seen", estimate for "did notice" (a 0.3° head at 40 m in the corner of the screen may be visible and unseen). |
| F2 | **Time from first information to first shot** | `infoLead = tPlayerSaw − tPlayerFirstInfo` (how long the player knew before seeing), `timeToShot = tFirstShot − tPlayerSaw` (design §3 "RT", renamed time-to-shot per human-performance P1). | `shotFired`, F1 | Exact |
| F3 | **Crosshair distance from the head at first sight** | Design §3 pre-aim error: angle between the aim ray and the enemy's head centre at `tPlayerSaw`, split into horizontal and vertical. | Camera aim at `targetVisible`; already a design §3 stat computed by the stat tracker (#13) | Exact |
| F4 | **Moving when firing** | `shotFired.moving` (above the weapon's deadzone or airborne, design §3). Share of the duel's shots; whether the first shot was moving. | `shotFired.moving` (exists) | Exact |
| F5 | **Exposure to several enemies** | `nExposed` = number of enemies with line of sight to the player and the player inside their field of view, sampled at each `playerDamaged` and at the player's first shot. Damage from an enemy other than the one the player was aiming at (aim ray within 5° of it) is **off-target damage**. | Mind perception state; **`playerDamaged.exposedTo`** (count) | Exact |
| F6 | **Angle advantage: who peeked whom** | `initiator`: whose movement created the first line of sight. Test: re-cast the first-sight ray with the player at their previous-tick position; if line of sight disappears, the player peeked, otherwise the enemy did. Plus: was the enemy holding still and pre-aimed (enemy aim error at the player's head < 2° at its first sight), and the scenario card's role (#97). | One extra ray at first sight; mind aim state; `card` on the contact | Exact |
| F7 | **Distance against weapon role** | Distance at the duel's first shot against each side's weapon. Out of role when a perfectly aimed, stationary first shot of the player's weapon would hit a head with probability < 0.5 at that distance (from the spec's first-shot cone and its centre-biased distribution, spec §3.3 and §5.1: the 0.25° rifle cone already exceeds a head's radius at 50 m) or when the enemy's weapon needs fewer bullets to kill at that distance (spec damage tables). | `shotImpact.distance`, weapon ids, spec tables | Exact given the spec model |
| F8 | **Shots against the ideal** | For each shot: aim error = angle from the aim ray *before spread* (with recoil applied as the player countered it) to the nearest point of the enemy's head and of its body. Classify: **aim miss** (aim ray off the target), **spread miss** (aim ray on the target, bullet off it: stationary = luck, moving = the moving-shot cue already told them), **hit**. For sprays, the per-bullet required pull against the actual pull (design §3 spray trace). | `shotFired.dir` minus the spread draw: **`shotFired.aimDir`** (or the spread offset) | Exact |
| F9 | **Time available before damage** | `window = tFirstHitOnPlayer − tPlayerSaw` (negative when the player was hit by an enemy they never saw). Also from the enemy's tell start, which is the real aiming phase (mind F5). | `playerDamaged`, `enemyTell`, F1 | Exact |
| F10 | **The enemy's side** | Reaction drawn and its percentile in the enemy's own profile, expectation bonus applied, peek pattern, tell length, whether it was moving when it fired. This is #94's payload. | **`enemyReacted { reactMs, expected, pct }`**, `enemyPeeked`, `enemyTell` (mind §5.8) | Exact |
| F11 | **Player's state** | HP at duel start, reloading at the enemy's first sight or at damage, tagged (slowed) when firing, weapon equipped, footsteps the player made in the 3 s before the enemy perceived them. | `playerDamaged`, `playerSlowed`, reload events, `footstep` | Exact |
| F12 | **Repetition and trades** | Same peek: the player re-exposes to the same enemy from within 1 m of the previous spot within 4 s of breaking line of sight. Stayed after the kill: the player is killed or hit within 3 s of a kill (the trade window, engagement-information §1, Med–Low) by an enemy whose perception channel was the teammate's death, while still within 1 m of where they got the kill. | Positions on `shotFired`/`playerDamaged`; mind channel | Exact |

New event fields are few, and all are values the simulation already computes: the aim direction before spread on `shotFired`, `audibleToPlayer` on `footstep`, an exposure count on `playerDamaged`, and the mind's perception and reaction events (already planned in player-like-enemies §5.8 and #94). The fight ledger itself is a pure function of the log, like every other stat (design §14.3).

### 3.3 The player's par

The model needs one thing that is not in a single fight: what this player normally does. **Par** is the time the player's normal self needs to land a first hit on this enemy from the moment it became visible:

```
par = T0 + ID / TP + extraShots × interval
  T0          the player's median time-to-shot on pre-aimed targets (pre-aim error < 2°), from history
  ID          log2(preAimError / targetWidth + 1)   (Fitts, human-performance §2.3; targetWidth = head width at that distance)
  TP          the player's flick throughput, from Orbit flick times (fallback: the dial's 4.5–7 bits/s, human-performance §2.3)
  extraShots  (1 − h) / h, capped at 2, where h is the player's first-bullet hit rate (body or head) at that distance band
  interval    the weapon's shot interval (the spec's fire-rate table)
```

Before enough history exists (fewer than about 30 kills in matching conditions), par uses the dial's values from human-performance §2.3 and the readout shows a bucket only, never a number (section 6.5). Par is an estimate, and its accuracy is hypothesis H2 (section 8).

Par makes the readout skill-matched in the same sense as the dial (design pillar 3): it compares the player with themselves, not with a professional. A Chalk-tier player whose 0.55 s time-to-shot is normal for them is not told "late"; they are told what else lost the fight. Their absolute speed is the dial's job, not the attribution's.

---

## 4. How games and coaching tools attribute a death

The headline: **no shipped game or review tool found here writes a cause of death.** In-game recaps list *damage and its sources* and leave the judgement to the player. Review tools for Counter-Strike measure the mechanical parts of a fight very precisely, but never label a death as mechanical or situational. The analogues that come closest to "separating skill from luck" are from chess, poker and football analytics. A cause readout would therefore be new design; the pieces it is built from are not.

### 4.1 In-game death information

| Game | What it shows, and when | Attributes a cause? | Evidence |
|---|---|---|---|
| **Reference game: combat report** | After death: damage dealt to and received from each enemy; a detail panel since patch 9.04, reorganised in 10.04. Some post-death data was moved to after the round because the report was "leaking information to you that you otherwise would have had no way of knowing" (patch 9.10). | No: source only. | High that it exists and for the quote; Low for its exact layout (no official layout page found) |
| **Reference game: replays** (patch 11.06) | Full match from every player's view, kill and death markers on a timeline, combat report at any moment. Purpose: "a complete view of your recent matches", to "better understand what happened during a moment, round, or game". | No: the player reviews it. | High |
| **League of Legends: Death Recap** (2019 redesign) | Damage type wheel (physical, magic, true) in percentages, per-champion bars split by spell and auto-attack, fight length, time spent crowd-controlled. Stated aim: to "help players understand – in a quick and easy way – what type of damage killed them" and to "make sure this information is reliable and understandable". The 2011 version was criticised by its own engineers for lacking the data "to figure out where the damage actually came from". | No: damage type and source. | High |
| **Overwatch: kill cam** | Replays the killer's view after death; a GDC session describes it as helping players "understand how your hero died". | No: shows, does not explain. | Med–High for intent |
| **Counter-Strike 2** | Post-round damage given and taken (e.g. "80 in 3"), made "more legible" in 2024. | No. | Low–Med (patch text from search snippets) |
| **Apex Legends** | A death recap after the match summary with the last fight's damage. Players report it shows only the last few shots and sometimes credits the wrong killer. | No. | Low |

Two lessons from this table. First, **every recap is about the enemy's damage, none about the player's decisions or execution**; they answer "what killed me", not "what should I change". Second, **trust is the failure mode they all worry about**: Riot's 2011 engineers lacked the data, Apex players report wrong credits, and the reference game pulled information that leaked what the player could not have known. Flickline must never show a cause it cannot back with the log, and must never reveal information that changes the next fight (section 6.6).

### 4.2 Review and coaching tools

| Tool | Metric (exact definition where found) | Attributes a cause? | Evidence |
|---|---|---|---|
| Leetify (CS2) | **Spotted**: the moment the attacker first had the enemy in its field of view, computed from all player positions. Every timing stat starts there. | No | High |
| Leetify | **Time to damage**: median time from spotting to first damage, times of 1 s or more excluded "to account for trigger discipline plays"; explicitly "NOT reaction time" because it mixes accuracy, crosshair placement, fire rate and reaction. | No | High |
| Leetify | **Crosshair placement**: degrees the crosshair moved from first sighting to hitting the enemy. | No | High |
| Leetify | **Proper counter-strafing**: rifle shots at a spotted enemy fired below 34% of the weapon's maximum speed; crouched shots excluded. | No | High (threshold Med) |
| Leetify | **Traded deaths**: opportunities, attempts and successes ("did at least one teammate have a chance to trade you when you died?"). | Context, not blame | High |
| Leetify | **Rating**: zero-sum, built on each kill's change in round-win probability (economy, players alive, who got the previous kill); reward split between killer, damagers, flash assist and trader. Aim, Utility and Positioning ratings are z-scores against a benchmark; which stats feed Positioning is not published. | No | High (Positioning inputs not found) |
| CSSkill | **Untraded death**: you die and your killer survives the next 3–5 s; tied to spacing. | Implicitly (spacing) | Med |
| Refrag | Named habits that lose fights: crosshair not at head height, over-crouching. | Habits, not per death | Low–Med |
| Coaching checklists (e.g. Boostroom) | Per death: "Was my death tradeable?", "Did my death gain something?", "Did I re-peek a pre-aimed angle?", "Did I ignore the minimap?". Untradeable within 1–2 s is "probably a bad fight or bad spacing". | Yes, by a human reviewer, minutes per death | Low |

What Flickline takes from these: Leetify's **spotted** anchor (F1), its **time to damage** (F2 plus F9), its **crosshair placement** (F3), its **counter-strafe threshold** (F4: Flickline's is the spec's deadzone, 27.5% of run speed), its **traded death** idea (F12), and the coaches' questions, which map almost one to one onto the Play causes in section 6.3. What none of them can do, and Flickline can, is read the enemy's mind: whether it heard you, whether it was pre-aimed, what reaction it drew. A demo parser has to guess that; the Flickline simulation logs it (F1, F10).

### 4.3 Separating skill from luck elsewhere

| Analogue | Method | What Flickline borrows | Evidence |
|---|---|---|---|
| chess.com Game Review | Each move is labelled by **expected points lost** against the engine's best move, where expected points is the winning chance given rating and evaluation: Best 0.00, Excellent ≤ 0.02, Good ≤ 0.05, Inaccuracy ≤ 0.10, Mistake ≤ 0.20, Blunder > 0.20; thresholds depend on the player's rating. The label judges the *decision*, not the result. | Judge execution against a reference, in one currency, with rating-dependent thresholds: Flickline's currency is milliseconds against the player's own par (section 6.2). | High |
| Poker luck adjustment (all-in EV, AIVAT) | Replace the realised outcome with its expectation at the moment the player's decisions ended; AIVAT reports needing 44 times fewer games to measure skill. | Separate what the player controlled (their timings and shots) from the draw (the enemy's reaction draw, spread): the counterfactual "your normal self" test. | Med (AIVAT abstract), Low–Med (all-in EV) |
| Expected goals (football) | The quality of a chance from similar past shots (distance, angle, keeper position, pressure); goals minus xG is treated as finishing skill plus variance. | A per-card prior: how often a player at this dial wins this kind of fight (#104's stats), used to recognise a fight that was bad before anyone fired. | High |

---

## 5. What feedback research says about this kind of readout

Seven findings set the constraints for the model (section 6) and the presentation (section 7). Two caveats: no study was found of attributing a loss to "the situation" in an aim trainer or any practice tool, and none of icons against text during live shooter play; the constraints below are transferred from motor learning, feedback and attribution research and are hypotheses for Flickline until the playtest (section 8).

| # | Finding | Evidence | Constraint for Flickline |
|---|---|---|---|
| S1 | **Feedback can make performance worse.** In a meta-analysis of 607 effects (23,663 observations) the mean effect was d = 0.41, but over a third of feedback interventions *lowered* performance; effectiveness falls as feedback moves attention from the task towards the self. Feedback that implies a fixed ability ("you're a great player") made children cope worse with later negative feedback than feedback about the attempt ("those kicks were very good"). | Kluger and DeNisi 1996 (Med, abstract); Chiviacowsky and Drews 2014 (High) | Lines describe the **fight**, never the person: "First shot missed", never "You're slow" or "Bad aim". No comparison with other players. |
| S2 | **Causes that are controllable and unstable keep people trying; stable, uncontrollable ones lower expectancy.** Effort is internal, unstable and controllable; aptitude is internal, stable and uncontrollable; luck is external, unstable and uncontrollable. Feedback that framed failure as controllable and unstable raised expectations and persistence in novices for four weeks and carried over to a new task. | Weiner 2018 (High); Rascle et al. 2015 (Med) | Aim and Play are phrased as **controllable and specific to this fight** (what to do differently). Dealt is phrased as **unstable** ("this time", "nothing to fix"), never as a trait. No cause ever implies talent. |
| S3 | **People credit wins to themselves and blame losses on circumstances**: mean d = 0.96 across 266 studies; SMD 0.62 in organised sport (10,515 athletes); League of Legends players at lower ranks blamed others or luck, and that optimism went with overestimating their own skill. | Mezulis et al. 2004 (Med); Allen et al. 2020 (Med); Aeschbach et al. 2023 (Med, summary) | The player already leans towards "the situation". The model must not feed that: **Dealt is rare and earned** (6.4: Play beats Dealt), and the fix engine never picks it. |
| S4 | **Constant, immediate feedback can create dependency** (the guidance hypothesis): practice looks better, retention worse. Summary feedback over 5–15 trials gave worse practice but better retention. Bandwidth feedback (only when the error is outside a band) is effective but its threshold matters, or learners chase noise. For complex tasks frequent feedback can reduce load, and frequent feedback that points *outside the body* (at the effect) helped learning rather than hurting it (100% beat 33% of trials). | Salmoni et al. 1984 via Sigrist et al. 2013 (Med; review text High); Schmidt et al. 1989 (Med); Sigrist et al. 2013 (High); Wulf et al. 2010 (High) | Per-shot feedback stays as it is: it is external-focus, about the effect (the hit), and the design's core. The **fight line is bandwidth feedback** (only when HP cost ≥ 30, H7), and the **run summary** (ledger, one thing to fix) carries the pattern. Close fights get no line, so the player does not chase noise. |
| S5 | **Feedback after good trials helps learning** (feedback on the three best of six trials beat feedback on the three worst on delayed retention), probably through motivation. | Chiviacowsky and Wulf 2007 (Med) | A **praise line** for fights won against the odds (6.2). It is rare by construction, which keeps it meaningful. |
| S6 | **Reading during play is slow.** Silent reading averages about 238–260 words a minute (about 4 words a second) at full attention; real rates during interruptions are lower. A central bottleneck in choosing actions makes even simple concurrent tasks interfere. | Brysbaert 2019 (High); Pashler 1994 (Med) | **Six words or fewer**, shown for 1.8 s, and **never during a fight** (hidden when an enemy appears or a tell starts). The glyph and colour carry the bucket before the words are read. |
| S7 | **Deaths feel fair when the player had the information and the control**; unseen threats feel unfair (Spelunky's and Death's Gambit's designers). Players reject losses that contradict their sense of the odds (Sid Meier: losing at 2-to-1 was fine, at 20-to-10 was not). Shooter players blame tick rate when what they saw differs from the server (Overwatch director), and gunfights are decided by 20–50 ms (Riot). | Shafer 2013, Kubodera 2022 (Low); Meier 2010 (Med–Low); Kaplan 2016 (Med); Riot 2020 (Med–High) | Attribution must be **checkable**: the fight timeline shows exactly what each side saw and when (7.4). A "Hit from out of sight" verdict is treated as a fairness bug, not a message (6.3). Close fights are called close, because at 20–50 ms that is the truth. |

---

## 6. The attribution model

### 6.1 Three buckets

| Bucket | Meaning to the player | Fixable? | Colour, glyph |
|---|---|---|---|
| **Aim** | You had time; your execution cost the fight. | Yes: drills | `warn` amber (already the moving-shot colour, design §7.1), crosshair glyph |
| **Play** | Your decision shortened the window before you could aim. | Yes: how you take and hold fights | `trim` cyan, path glyph |
| **Dealt** | The situation, not you. Nothing to fix. | No | neutral text colour, dash glyph |
| (praise) **Won against the odds** | Your normal self would have lost this; you won. | — | `ok` green, the bucket glyph that won it |

Colour is never the only cue (design §11; cues.md §6 found gold and amber inseparable under deuteranopia): each bucket has its own glyph and its own words.

Why three and not two. The question was put as "out-positioned, or missed the shot". But in the reference game, being out-positioned is almost always the player's own decision: running into earshot, swinging into two angles, re-peeking the same way, staying on the angle after a kill. Every coaching checklist in section 4.2 treats those as the player's mistakes. Filing them under "the situation" would hand the player an excuse for exactly the habits Flickline exists to fix, and attribution research suggests players already lean that way (section 5, S3). So "situation" is split: **Play** (your decision, fixable) and **Dealt** (not you).

### 6.2 The verdict: "your normal self"

For each duel that cost the player HP, and for each duel the player won, compute:

- `tSee`: when the player could first see the enemy (F1).
- `tHitEnemy`: the enemy's first hit on the player (F9). If the enemy never hit, the duel was a clean win and no verdict is needed.
- `tHitPlayer`: the player's first hit on the enemy.
- `margin = tHitEnemy − tHitPlayer` (positive: the player hit first).
- `parMargin = tHitEnemy − (tSee + par)` (positive: the player's normal self would have hit first).

Then, with a close-fight band `B` = 50 ms (Riot: duels "often came down to 20–50 ms", High; HYPOTHESIS 50% for the value, H9):

| Case | Condition | Verdict |
|---|---|---|
| **Winnable, lost** | `parMargin > B` and the enemy hit first | **Aim**: the Aim cause with the largest time cost (6.3) |
| **Unwinnable** | `parMargin < −B` and the enemy hit first | **Play** if any Play cause explains at least half of the shortfall `−parMargin`; else **Dealt**, with its Dealt cause |
| **Close** | `parMargin` within ±`B` | **Close fight**: shown only as a neutral line on death, never mid-run |
| **Won against the odds** | `parMargin < −B`, and the player hit first and won the duel | **Praise** with what made it possible (a fast time-to-shot, a pre-aimed crosshair) |
| **Bloodied win** | Player killed the enemy, lost ≥ 30 HP in the duel | Same rules as a loss, applied to the damage |

Off-target damage (F5: hit by an enemy the player was not dueling) is its own duel with `tSee` = the moment that enemy became visible, which is often never; it resolves to "swung into two angles" (Play) when the player created the exposure (F6), or "crossfire" or "out of sight" (Dealt) when the card or the enemy did.

**Why first hit and not kill.** The first hit tags the other side (spec §4.3: speed capped to 27.5%) and, with a rifle, usually decides the duel; using it keeps the model simple and stops a long trade of hits from blurring the cause. That first-hit order predicts the duel's winner is hypothesis H1, checked in the bot harness.

**Why the player's own par.** A fixed standard would tell a new player "late" every time and an expert never, and both would stop reading. Par makes the line about *this* fight against *your* normal, which is what the per-shot feedback already does with its green time-to-shot when it beats the run median (design §7.1). The dial, not the attribution, is what moves the player's normal upward.

### 6.3 The cause catalogue

Every cause has a detector over the facts of section 3.2, a time cost in milliseconds (the common currency for choosing between causes), and the line the player reads. Lines are six words or fewer, fact first, so they can be read in a glance; numbers appear only where they are the lesson.

**Aim** (only on winnable fights)

| Cause | Detector | Time cost | Line |
|---|---|---|---|
| Late on the trigger | `timeToShot` exceeds `T0 + ID/TP` by more than `B` | the excess | "Late: 0.52 s (you: 0.38)" |
| First shot missed | First shot was an aim miss (F8), not a spread miss, while stationary | time from first shot to first hit | "First shot missed — 0.9° high" |
| Shot while moving | Any shot before the first hit was `moving` (F4) and missed | time from first moving shot to first hit | "Shot while moving" |
| Crosshair off the angle | Pre-aim error (F3) above the player's own median for this card and anchor by more than one MAD, *and* the enemy appeared where the player had information (inside ±30° of a heard or called direction, or at a common anchor) | `MT(actual) − MT(median)` | "Crosshair 24° off the angle" |
| Spray fell apart | In a spray of 5+ bullets, required versus actual pull diverged by more than 1.5° (design §8.2's spray-trace threshold) before the bullet that would have killed | time from divergence to the end of the burst | "Spray lost it at bullet 6" |

**Play** (on unwinnable fights, and as secondary causes)

| Cause | Detector | Time cost (how much it shortened the window) | Line |
|---|---|---|---|
| It heard you | The enemy's perception channel was sound from the player's own footsteps or reload (F1, F11) within 3 s before it saw the player, and it was `expected` | the expectation bonus actually applied (mind §5.3: 35 ms) plus the flick it did not need (enemy pre-aim error < 2°: its Fitts time at its profile's throughput) | "It heard you run" |
| Peeked a held angle | The player initiated the line of sight (F6) into an enemy that was stationary and pre-aimed (< 2°) | the enemy's saved flick time (as above): what a jiggle or a wide swing past the pre-aimed spot would have made it spend | "Peeked a held angle — jiggle first" |
| Swung into two angles | Player-initiated exposure (F6) to two or more enemies (F5), and the damage came from the one not being aimed at | whole window of the off-target duel | "Swung into two angles" |
| Same peek twice | F12 same-peek rule | the enemy's expectation and pre-aim, as for "It heard you" | "Same peek twice" |
| Stayed after the kill | F12 trade rule | the trader's whole window | "Stayed after the kill" |
| Reloaded in the open | Reloading when the enemy first saw the player, outside cover (F11) | remaining reload time at the enemy's first sight | "Reloaded in the open" |
| Wrong gun for the range | F7: the player's weapon out of role at that distance, with the alternative weapon available (Sweep loadout) | difference in expected time to kill between the two weapons at that distance (spec tables) | "Out-ranged: Rill at 28 m" |

**Dealt** (only when no Play cause explains the shortfall)

| Cause | Detector | Line |
|---|---|---|
| Quick enemy | The enemy's reaction draw was in its profile's fastest 10% (F10), or its first shot hit at the edge of the spread cone, and the player executed within par | "Quick enemy — nothing to fix" |
| Crossfire | Two or more enemies exposed at once, created by the card or the enemies' movement (F6), not by the player | "Crossfire — nothing to fix" |
| Out of sight | Hit by an enemy the player never saw and could not have heard (F1, F9 `window < 0`) | "Hit from out of sight" |
| Low on HP | The duel would have been won at full HP (the hits taken would not have killed) and HP was lost in an earlier contact | "Low HP from the last fight" (and the earlier fight's cause is what the ledger records) |

Two of these are also **signals to the developers**, not only to the player. "Hit from out of sight" should be nearly impossible under the honesty rules (player-like-enemies F1–F3, engagement-information §4.2): every occurrence is logged against signature S9 and the scenario playtest (#105). And a card whose losses are more than 30% Dealt is mis-tuned (H4), which goes to balance (#53).

### 6.4 Choosing one line

1. Compute every detector that fires, with its time cost.
2. Choose the bucket by the verdict table (6.2). Inside the bucket, choose the cause with the largest time cost.
3. **Precedence across buckets** only matters on unwinnable fights where both Play and Aim causes fire: Play wins if it explains at least half the shortfall. Rationale: the Play cause is what made the fight unwinnable; the Aim cause would not have saved it.
4. The other detectors that fired become **secondary causes**: never shown mid-run, listed in the fight timeline on the results card (7.4), and counted in the run's ledger.

### 6.5 Confidence, and when to say nothing

Most facts are exact (section 3.2), so confidence comes from three places only:

1. **Margin.** A cause is shown only if its time cost is at least `2B` (100 ms) and at least 1.5 times the next cause's. Otherwise only the bucket is shown ("Mostly aim").
2. **Par quality.** With fewer than about 30 kills of history in matching conditions, par uses dial defaults; the line shows the cause without numbers, and Aim verdicts that depend on `T0` ("Late") are suppressed.
3. **Estimated facts.** "Could have seen" is not "did notice" (F1). When the enemy's visible part was smaller than 0.3° or more than 40° off the crosshair at `tSee` (HYPOTHESIS 40%; the mind's attention cone is ±15°, a peripheral onset is captured in about 100 ms, player-like-enemies §5.3), `tSee` is moved to when it entered that region, and the verdict is computed both ways; if the two disagree on the bucket, only the shared part is shown, or nothing.

**Say nothing when**: the fight was close (`|parMargin| ≤ B`) and the player survived; the duel involved an enemy without a mind (drills, Gnats); more than two enemies hit the player within 0.5 s (the damage cannot be split cleanly; the ledger records it as "contact" without a cause); or the run is in a drill mode where per-shot feedback already says everything. Silence is a valid answer, and should be the most common one in clean play.

### 6.6 Guards

- **Against excuses.** Dealt is reserved for causes outside the player's control and must stay rare: target ≤ 15% of HP lost across the card mix (H4). When Play and Dealt both explain a loss, Play wins (6.4). The fix engine never chooses a Dealt cause (7.4).
- **Against blame.** A loss inside the close band is "close", not "late". Par is the player's own, so the readout never measures them against a stranger.
- **Against leaking information.** Lines describe what *already* happened and never name information the player could not have gathered and would use in the next contact (an enemy's position, a gate, a route). "It heard you run" tells the player about their own noise, not where the enemy is. This follows the reference game's own fix to its combat report (section 4.1).
- **Against lying.** Every line is computed from the event log by a pure function; the fight timeline (7.4) shows the facts behind it, so a player who disagrees can check, and a wrong line is a reproducible bug with a seed.
- **Rating stays separate.** Attribution never changes the skill model's update. Card difficulty is already an item property (engagement-information §4.6), which is the right place to account for hard situations; attribution only explains.

---

## 7. Presenting it instantly without breaking flow

The readout works at three speeds. Each is slower and coarser than the one before, and none of them touches the per-shot channel.

### 7.1 Per shot: unchanged

The per-shot feedback of design §7.1 stays the only thing near the crosshair and the only thing with sound during a fight: hitmarkers, the headshot tink, the kill ladder, the amber moving-shot tracer and `⇆` glyph, the miss ghost. Attribution never recolours a shot, never adds a sound to one, and never appears while an enemy is visible or a tell is running.

Attribution *sharpens* per-shot feedback by using its words. "Shot while moving" is the same fact as the amber tracer the player already saw; "First shot missed — 0.9° high" is the same fact as the miss ghost. The fight line tells the player *which* of the per-shot signals mattered this time, which is the one thing the per-shot channel cannot say.

### 7.2 Per fight: the cause line

- **When**: at the end of a contact (all enemies dead, or the 2 s no-contact rule of 3.1), and only if the contact cost at least 30 HP, or was a win against the odds. Clean fights and close fights get nothing extra: the kill feedback has already said it. Expected rate: at most one line per 20 s of Sweep (HYPOTHESIS 45%, H7).
- **Where**: beside the HP bar (bottom right), because the line explains HP. Never at the crosshair, never centre screen.
- **What**: glyph plus six words or fewer in the bucket's colour, e.g. `⌖ First shot missed — 0.9° high`, `↱ It heard you run`, `– Quick enemy — nothing to fix`, `✓ Beat a held angle`.
- **How long**: 1.8 s, fading over the last 0.4 s; replaced (not stacked) if another contact ends sooner; hidden immediately when a new enemy becomes visible or a tell starts.
- **Sound**: none (decision). The sound vocabulary is per-event and already near the 5–7 categories people can identify absolutely (cues.md §2, Pollack 1952 / Miller 1956); a fight-level sound would arrive just after the kill chime and blur it. Hypothesis H8 tests whether players notice the line without one; if they do not, the fallback is one soft UI tick on Aim and Play lines only.
- **Motion**: none beyond the fade; respects Reduce flashing (design §13.3).

### 7.3 On death

Sweep and Corner Clear end at 0 HP, so death is also the end of the run. The results card appears over the frozen last frame within 100 ms (design §8.2); the frozen frame, with the damage arc pointing at the killer, is already a free "kill cam" and needs nothing added.

- The card's **first line** (above the score) is the death cause: glyph, bucket colour, the line, and below it in small type the enemy's side from #94 ("It reacted in 0.27 s, pre-aimed. You were moving."). For a close fight: "Close fight — it was faster this time."
- It never delays `Enter` (instant restart, design §2) and adds no animation.

### 7.4 Per run: where your HP went, and the one thing to fix

- **Ledger row** on the results card (Sweep and Corner Clear): one bar of HP lost split Aim / Play / Dealt, with the top cause of each bucket named under it ("Aim 120: first shot missed ×4 · Play 90: heard you ×3 · Dealt 30"). Readable in a second; this is the "where do I lose" summary the per-shot channel cannot give.
- **One thing to fix** (design §8.3, #39) gains the Aim and Play causes as candidates, ranked by estimated points lost like every other diagnostic; **a Dealt cause is never chosen**. When Dealt is more than 40% of the run's HP lost, the card adds a neutral note ("Tough draw this run") and the run is flagged for balance (#53): fairness is a design fact to fix, not something the player should absorb.
- **Fight timeline** (detail panel, #39): one lane per fight with marks for *you heard*, *you saw*, *it saw* (and how), *its tell*, your shots (hit, aim miss, spread miss, moving), its hits, and the par marker. This is the honest "why", available to anyone who disagrees with a line, and the cheapest possible replacement for a kill cam (design §15 puts replays in "later").
- **Fights by situation** (#104) and attribution share the same fight records; #104 groups by card, this groups by cause.

### 7.5 Settings

Gameplay → **Fight causes**: *On* (default), *On death only*, *Off*. Off still keeps the ledger and the fix engine, which are on the results card the player chose to read.

---

## 8. Hypotheses and how to confirm them

Two cheap test beds settle almost everything: the **bot harness** (#28; seconds in CI, ground truth by construction) and a **playtest protocol** (A7, #125; minutes per tester).

**Bot harness, fault injection (A4, #122).** Scripted player bots run seeded Sweep and Corner Clear contacts with exactly one injected fault each, and the attribution must name it:

| Bot | Injected fault | Expected verdict on its HP losses |
|---|---|---|
| Perfect, quiet | none (walks, pre-aims common angles, stops before firing, par timings) | mostly no line, Close or Dealt; ≤ 10% Aim or Play (false blame rate) |
| Runner | runs into every contact (audible) | "It heard you" on most losses |
| Mover | fires while moving | "Shot while moving" |
| Slow | +200 ms on every time-to-shot | "Late" |
| Low crosshair | holds 8° below head height | "Crosshair off the angle" |
| Swinger | swings into every exposed angle at once | "Swung into two angles" |
| Stayer | stays put after every kill | "Stayed after the kill" |
| Perfect in a forced crossfire | none; contacts are crossfire cards with no alternative route | Dealt ("Crossfire") |

Pass: for each faulty bot, its fault is the primary cause of at least 80% of the HP losses where the fault was present, and the perfect bot is blamed (Aim or Play) for at most 10% of its HP losses. The result is a confusion matrix posted on #110.

| # | Hypothesis | Confidence | How it is confirmed |
|---|---|---|---|
| H1 | The side that lands the first hit wins the duel in at least 75% of Sweep duels, so first-hit order is a fair basis for the verdict. | 65% | Bot harness: winner versus first-hit side over 1,000 seeded duels at dials 20, 50, 80. If below 75%, the verdict compares time to lethal damage instead. |
| H2 | Par predicts the player's own time to first hit within ±25% on pre-aimed appearances and ±35% on flicks. | 45% | Playtest logs: par against actual on fights the player won cleanly. If worse, par gains a per-card correction from the player's history. |
| H3 | Testers agree with the death line in at least 70% of deaths after their first three runs, and a reviewer reading the fight timeline agrees in at least 80%. | 50% | Playtest protocol: in a test build, after each death and before the card, the tester says in a few words why they died; then the line is shown and they rate it *agree / partly / disagree / don't understand*. A reviewer later labels the same deaths from the timeline. |
| H4 | Dealt is at most 15% of HP lost across the Sweep card mix; no card exceeds 30%. | 50% | Bot harness with the perfect bot and the dial-matched bot across all cards; then playtest ledgers. A card above 30% goes to #53. |
| H5 | The line does not hurt flow: no tester reports it covering anything or delaying them; key-to-ready time on the results card unchanged; the line is read in under a second. | 70% | Playtest question set (fun criteria, #66) plus the existing restart timing measurement. |
| H6 | Seeing causes changes behaviour: a Play cause's rate falls across a session (for example, "It heard you" per contact in runs 4–6 lower than in runs 1–3) more than in a control session with lines off. | 40% | Within-tester A/B across two sessions (lines on, lines off), counting causes from the ledger, which exists either way. |
| H7 | With the 30 HP bandwidth rule, a typical Sweep run shows at most one line per 20 s. | 45% | Bot harness at matched dial; playtest logs. If too frequent, raise the HP threshold; if too rare, lower it to 20 HP. |
| H8 | Players notice at least 80% of lines without a sound. | 50% | Playtest: after the run, ask which lines they remember; compare with the log. Below 80%: add the soft UI tick (7.2). |
| H9 | A close band of 50 ms separates "close" from "decided": inside it, testers judge the fight a coin flip at least as often as not. | 50% | Playtest protocol answers on close-band deaths. Adjust `B` within 30–80 ms. |
| H10 | The noticing rule (0.3° size, 40° off-crosshair) avoids blaming players for enemies they could not reasonably have seen. | 40% | Playtest disagreements on "Late" lines, reviewed against the timeline. |

Every number marked HYPOTHESIS in this document is a tunable in the attribution rules file (data, not code), so each confirmation is a data change.

---

## 9. Recommendation

Build the readout as specified in sections 6 and 7, in this order, and treat #110 as answered only when the playtest (A7) passes:

1. **Facts first** (A1, A2): the few new event fields and a pure fight ledger. They are useful on their own: #104 (fights by situation) and #94 (honest death recap) read the same records.
2. **The engine** (A3) with every threshold in data, then **prove it on bots** (A4) before any player sees a line. A readout that blames a perfect bot more than one time in ten is not shipped.
3. **Presentation** (A5, A6): the cause line and death line, then the ledger, timeline and fix-engine rules.
4. **Judge it in play** (A7), posting the verdict on #110 and #63.

What this answers, in one paragraph: the game tells the player which it was by comparing the fight with *their own normal*. If their normal self would have won, the line names the execution error that cost the most time (Aim). If not, it names the decision that made the fight unwinnable (Play), or says plainly that it was not their fault (Dealt). It says it in six words beside the HP bar after the fight, never during it and never at the crosshair, and only when the fight cost real HP; it says nothing after clean or close fights. Per-shot feedback is untouched and becomes sharper, because the fight line tells the player which of the per-shot signals mattered.

What it deliberately does not do: no kill cam or replay (design §15 later; the frozen frame and the fight timeline cover the need), no new sound, no effect on ratings, no "luck" excuses for decisions, and no information that would help in the next fight.

---

## 10. Build backlog and changes to existing issues

### 10.1 Build backlog (filed as issues, listed on #110)

| Id (issue) | Issue | Depends on |
|---|---|---|
| A1 (#119) | feat(sim): attribution facts on the event log — aim before spread, audible-to-player sounds, exposure count and first-sight initiator | #13, #31, #89, #99 |
| A2 (#120) | feat(feedback): fight ledger — contacts, duels and damage from the event log | A1, #13, #97 |
| A3 (#121) | feat(feedback): player par and the attribution engine — verdicts, causes, confidence and silence rules as data | A2, #17, #38 |
| A4 (#122) | test(feedback): attribution fault-injection suite in the bot harness | A3, #28, #91 |
| A5 (#123) | feat(hud): fight cause line and death cause line | A3, #25, #26, #31, #94, #42 |
| A6 (#124) | feat(ui): where your HP went — ledger row, fight timeline and fix-engine attribution rules | A3, #39, #104, #26 |
| A7 (#125) | playtest: fight attribution pass — agreement, noticing, behaviour and flow | A5, A6, A4, #50, #51 |

A1 and A2 can start as soon as their interfaces exist; A3 can be built against synthetic fights. Nothing here blocks the first playable: every dependency is a first-release issue.

### 10.2 Changes to existing issues (posted as comments)

- **#26** results card: reserve a one-line **cause slot** above the score, rendered only when a cause is provided (no logic in #26; A5 fills it). First-playable modes never fill it.
- **#39** fix engine: expose a **diagnostic extension point** (a registry of candidates with estimated points lost), so A6 adds the Aim and Play causes without editing #39's twelve; the rule "a Dealt cause is never the one thing to fix" is A6's. The detail panels gain a fight timeline lane (A6). Its "over-peek damage" diagnostic overlaps "Peeked a held angle" and "Swung into two angles"; once A6 lands, over-peek defers to the attributed cause where one exists.
- **#94** honest death recap: its overlay becomes the **enemy-side detail under the death cause** on the results card (A5), not a separate overlay; its payload acceptance criterion stays; its fix-engine rules ("seen first in 6 of 8 deaths") move to A6 so there is one rule set.
- **#104** fights by situation: shares A2's fight records; the card-keyed fix rules stay in #104, the cause-keyed ones in A6.
- **#74, #70, #62, #63**: linked to #110 (done when #110 was filed).

---

## 11. Open questions and default answers

| # | Question | Default |
|---|---|---|
| 1 | Should drills show causes? | No. In drills the per-shot feedback already *is* the cause; attribution runs only where enemies shoot (Sweep, Corner Clear, Vigil). |
| 2 | Should a Dealt death reduce the rating penalty? | No. Card difficulty is already an item property in the skill model (engagement-information §4.6); attribution explains and never changes the maths (6.6). |
| 3 | Should the line name the enemy's position or route? | No: that leaks information into the next contact (6.6, section 4.1). |
| 4 | What if the player strongly disagrees? | The fight timeline shows the facts; a reproducible wrong line is a bug with a seed. A disagree button is a playtest-build feature only (A7), not a shipped one. |
| 5 | Why not a kill cam? | Replays are "later" (design §15); a camera replay costs seconds of the instant-restart budget and shows *what*, not *why* (section 4.1: every shipped recap leaves the judgement to the player). Revisit with replays. |
| 6 | Should Play and Aim causes on wins be shown (a sloppy win)? | Only as bloodied wins (≥ 30 HP lost); a clean but lucky win is left to the per-shot feedback, so wins are not spoiled by nagging. |
| 7 | Is "Peeked a held angle" too harsh on take cards, where the holder is meant to be ahead? | It is shown only when the fight was unwinnable at par *and* the player initiated into a pre-aimed enemy; the line includes the fix ("jiggle first"), which is the card's lesson. If playtests read it as blame (H3), it moves to Dealt on `take-expected` cards. |

---

## 12. Sources

Fetched 2026-11-14 by two research passes; pages were read through a fetch tool that returns an extracted or summarised page, so wording not marked as a quote is paraphrase. Quotes above are as extracted.

**Games and tools**
- Riot, reference-game patch notes 9.04, 9.10, 10.04: https://playvalorant.com/en-us/news/game-updates/valorant-patch-notes-9-04/ ; https://playvalorant.com/en-us/news/game-updates/valorant-patch-notes-9-10/ ; https://playvalorant.com/en-us/news/game-updates/valorant-patch-notes-10-04/
- Riot, *Replays: everything you need to know*: https://playvalorant.com/en-us/news/dev/replays-everything-you-need-to-know/
- Riot, *Peeking into VALORANT's Netcode* (2020): https://www.riotgames.com/en/news/peeking-valorants-netcode
- League of Legends Death Recap redesign (2019): https://blogoflegends.com/2019/07/01/league-of-legends-updated-death-recap-pbe ; 2011 engineer note: https://www.surrenderat20.net/2011/11/polishing-up-death-recaps.html?m=0
- Overwatch GDC session listing (kill cam): https://gdcvault.com/play/1024053/contactUs ; Overwatch director on "shot through walls" (2016): https://gameinformer.com/b/news/archive/2016/06/07/overwatch-director-explains-why-you-think-youre-getting-shot-through-a-wall
- Leetify stats glossary: https://leetify.com/blog/leetify-stats-glossary ; *Enemy (actually) spotted*: https://leetify.com/blog/enemy-actually-spotted/ ; metric guidelines: https://leetify.com/blog/performance-metric-tool-guidelines ; rating: https://leetify.com/blog/leetify-rating-explained ; benchmarks: https://leetify.com/blog/cs2-benchmarks/
- CSSkill, untraded deaths: https://csskill.com/blog/the-silent-killer-of-your-premier-rating-the-untraded-death
- Refrag, bad habits: https://refrag.gg/blog/cs2-bad-habits-and-how-to-fix-them
- Boostroom, VOD review checklist: https://boostroom.com/blog/vod-review-checklist-fix-your-gameplay-in-20-minutes
- chess.com, move classification: https://support.chess.com/en/articles/8572705-how-are-moves-classified-what-is-a-blunder-or-brilliant-move
- AIVAT (poker luck adjustment): https://ar5iv.arxiv.org/html/1612.06915
- The Analyst, expected goals: https://theanalyst.com/articles/what-is-expected-goals-xg

**Feedback, attribution and fairness**
- Sigrist, Rauter, Riener and Wolf 2013, augmented feedback review (covers Salmoni et al. 1984, Wulf et al. 1998): https://moodle.umontpellier.fr/mod/resource/view.php?id=115859
- Schmidt, Young, Swinnen and Shapiro 1989 (summary KR); Lee and Maraj 1994, Ugrinowitsch et al. 2010 (bandwidth KR); Chiviacowsky and Wulf 2005, 2007 (self-controlled feedback, feedback after good trials): abstracts via Europe PMC, https://www.ebi.ac.uk/europepmc/
- Wulf, Chiviacowsky, Schiller and Ávila 2010, *Frequent external-focus feedback enhances motor learning*: https://www.frontiersin.org/articles/10.3389/fpsyg.2010.00190/full
- Kluger and DeNisi 1996, *The effects of feedback interventions on performance* (abstract): https://pluto.huji.ac.il/~mskluger/files/Download/Kluger%20&%20%20DeNisi%20abstract.doc
- Chiviacowsky and Drews 2014, generic versus non-generic feedback: https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0088989
- Weiner 2018, *The contributions of an attribution approach to emotion and motivation*: https://www.czasopisma.pan.pl//Content/103937/PDF/PPB%201-18%202%20Weiner.pdf
- Rascle et al. 2015, attribution-based feedback after failure (abstract): https://eprints.bournemouth.ac.uk/22591/
- Mezulis et al. 2004 and Allen et al. 2020 (self-serving bias; abstracts via Europe PMC); Downs and Sundar 2011: https://pure.psu.edu/en/publications/we-won-vs-they-lost-exploring-ego-enhancement-and-self-preservati/ ; Aeschbach et al. 2023 (summary): https://blogs.tuni.fi/playlab/game-research-highlights/do-league-of-legends-players-overestimate-their-skills-the-elo-hell-phenomenon/
- Shafer 2013, fairness in Spelunky: https://gamedeveloper.com/design/fairness-discovery-spelunky ; Kubodera 2022, readability in action RPGs: https://www.gamedeveloper.com/game-platforms/designing-for-difficulty-readability-in-arpgs
- Sid Meier, GDC 2010 keynote (report): https://gameinformer.com/b/news/archive/2010/03/12/sid-meier-gamers-arent-logical
- Brysbaert 2019, *How many words do we read per minute?*: https://www.Gwern.net/doc/psychology/linguistics/2019-brysbaert.pdf
- Pashler 1994, dual-task interference (abstract via Europe PMC, PMID 7972591)

**Searched and not found** (stated as gaps): an official layout or purpose statement for the reference game's combat report beyond patch 9.10; Valve's own note on the Counter-Strike damage report; any Overwatch death recap or Apex/Fortnite design statement; which stats feed Leetify's Positioning rating; any shipped per-death cause readout; any study of situational loss attribution in a practice tool; any controlled study of icons against text during live shooter play; full texts of Salmoni et al. 1984 and Kluger and DeNisi 1996 (the "38%" figure sometimes quoted for the latter could not be confirmed and is not used).
