# Transfer: how we know Flickline makes you better at the reference game, and how a player knows they improved

Research and recommendation for the open question **#128**, from Vision review 1 (#115, finding 2). Companion documents: `docs/research/human-performance.md` (skill transfer ranking, §6–§7), `docs/research/fight-attribution.md` (§5 on feedback research), `docs/reviews/vision-review-1.md` (findings 2 and 3). The checklist the new **Transfer** quality track is judged by is `docs/transfer-checklist.md`.

- Research date: 2026-11-14. Reference game: Valorant ("the reference game").
- Evidence tags as in the companion documents: **High** (primary source read), **Med** (abstract, or a secondary source pointing to a primary one), **Low** (guide, vendor or forum content), **DERIVED** (arithmetic shown), **HYPOTHESIS** (a stated design assumption with the test that settles it, section 9).
- This document recommends; the decisions it takes are applied to `docs/design.md` (§2, §8.5, §9.5, §13.3, §14.5, §14.7) in the same pull request. #128 stays open until the answer is built and judged in play.

---

## 1. Summary

**The question (#128).** How does anyone, the project and the player, know that Flickline makes you better *at the reference game*, and that you improved rather than warmed up?

**Findings**

1. **Every number Flickline shows today measures practice performance, not learning.** Ratings, tiers, personal bests and the posterior are all taken inside a session, after warm-up, on an adaptive dial. Motor-learning research has separated performance during practice from learning for decades: learning is what a **retention test** shows after a delay, and several conditions that raise practice performance lower retention and transfer (section 3.1).
2. **Warm-up is real and large enough to fool a rating.** Performance after a rest starts below where it ended and recovers within minutes (warm-up decrement). In aim-trainer data, only about 40–65% of a day's in-session gain is still there the next day (section 3.2). A rating that climbs inside an evening mostly measures warm-up and short-term gain.
3. **Aim-trainer-to-game transfer is still untested in public research.** No controlled study of an aim trainer against in-game performance was found (section 3.5). The project has to produce its own evidence, at pilot scale.
4. **The reference game offers two usable, repeatable measurements:** the practice range's shooting test (30 bots at a fixed speed setting, scored as bots killed out of 30) and headshot percentage over 20 or more matches from a stats site (section 4).
5. **Measurement noise decides what can be claimed.** One 40-trial benchmark run estimates ability to about ±3 dial points (DERIVED, section 5.5), so a single day proves nothing. A 6–12 tester pilot cannot test the promise at all; it can show whether a real study is feasible and whether anything points the wrong way (section 7.4). Both limits set what the game and the project are allowed to say.
6. **Two practice-design effects are weaker than the issue assumed.** Interleaved practice helps retention clearly in the lab but only slightly and not significantly in applied sport studies; reduced feedback frequency is close to no effect in the best recent meta-analysis (sections 3.3–3.4). Both stay hypotheses to test in Flickline, not foundations.

**Recommendation**

1. **The Daily Baseline.** The first run after at least 8 hours away is a short, fixed benchmark: the same item set every day (shuffled and mirrored so it cannot be memorised), at the player's pinned **Baseline level**, with the coaching cues off. Its estimate, not the matched rating, is the progress number on the profile, and the game says "you improved" only when the trend beats the player's own day-to-day noise (section 5).
2. **The reference check-in.** An optional, weekly, local-only prompt where the player types their reference-game numbers (the shooting test on Hard, headshot % over their last 20 matches). Flickline shows them next to the Baseline trend and never sends them anywhere (section 6).
3. **The transfer pilot.** A two-week playtest with 6–12 reference-game players, randomised into Flickline practice or the reference game's own practice for 20 minutes a day, with the same cold reference-game benchmark before and after. It shows whether a real study can be run (recruitment, adherence, whether the measures work) and whether anything points the wrong way; it cannot prove the promise (section 7).
4. **Interleave today's session.** Today's session becomes Baseline (when due) → two **Mix** runs that interleave the session's skills trial by trial → Sweep. A skill the player has barely played gets its own single-skill run first. A separate experiment tests interleaved against blocked on the Baseline (section 8).
5. **A fourth quality track, Transfer**, with the same standing as numbers, feel and fun. It holds the Baseline and pilot measurements and a habit review: "would this habit be wrong in the reference game?" (section 10, `docs/transfer-checklist.md`).

---

## 2. Three levels of "better"

| Level | Question | What measures it | What Flickline has today |
|---|---|---|---|
| **Practice performance** | Are you hitting more right now? | In-session score, accuracy, the posterior after a run. | Everything: ratings, tiers, PBs, ghost pace, rating delta on the results card. |
| **Learning (retention)** | Are you better tomorrow, cold, on the same task? | A fixed test after a delay, before warm-up. | Nothing. |
| **Transfer** | Are you better *in the reference game*? | A reference-game test, before and after a period of Flickline practice, against a control. | Nothing. |

Each level can move without the next. Practice performance rises within an evening from warm-up alone; learning can stay inside Flickline (a player becomes an Orbit specialist); and only transfer serves the vision's one promise. The design needs a number at each level, and must never present a lower level as a higher one.

---

## 3. What the evidence says

### 3.1 Performance is not learning

- Practice performance is a poor index of learning: conditions that lower practice scores can raise delayed retention, and the reverse (Soderstrom and Bjork 2015, review; Kantak and Winstein 2012; abstracts, Med). Only a test after a delay, once the temporary effects of practice have gone, supports a claim about learning.
- The usual delay for a retention test is at least 24 hours (attributed to Schmidt and Lee's textbook in a secondary source, Low-Med). Lee and Genovese (1988) describe the logic: rest after practice, then a short test, so that the temporary effects of the practice conditions "have dissipated" (Med).
- **Consequence for Flickline.** The design needs one number taken cold, after a delay, under fixed conditions; everything else it shows is practice performance and must be labelled as such.

### 3.2 Warm-up decrement

- Warm-up decrement is the temporary loss of performance after a rest, recovered quickly once the task resumes (Adams 1961, review; explained by the activity-set hypothesis, Nacson and Schmidt 1971); it grows with the length of the rest (Verhoeven and Newell 2018). Med for the phenomenon; no standard size or recovery time exists across tasks.
- **Aim-trainer data shows exactly this pattern.** In 682,564 Gridshot runs by 7,174 Aim Lab players, hits per second rose rapidly over the first few runs of each day; about 65% of a day's gain carried over to the next day on day 1, falling to a plateau near 40% after about day 10 (Listman et al. 2021, Front. Hum. Neurosci., observational, Med). Put plainly: more than a third of what a trainer's in-session score shows by the end of a day is gone the next morning.
- No peer-reviewed size for warm-up decrement in first-person aiming was found; the esports warm-up studies located are theses or snippets (Low).
- **Consequence.** A rating that climbs within an evening is mostly warm-up and short-term gain. The benchmark has to come *first*, before any warm-up, and progress has to be read across days.

### 3.3 Practice schedule: blocked versus interleaved

- Random (interleaved) practice usually loses to blocked practice during acquisition and beats it on delayed retention and transfer in the lab (Shea and Morgan 1979, Med). This is the contextual interference effect.
- **In applied and sport settings the effect is small.** Brady (2004, meta-analysis of 61 studies): laboratory d = 0.57, applied d = 0.19. Barreiros, Figueiredo and Godinho (2007, review): a retention benefit in 11 of 27 applied studies, clearer for complex serial tasks (Low-Med). The most recent transfer meta-analysis (Czyż, Wójcik and Solarská 2024, Front. Psychol., 34 studies, delayed transfer only): overall SMD 0.55 (95% CI 0.25–0.86, I² = 86%), laboratory 0.75, applied 0.34–0.37 (p = 0.06, not significant), adults 0.54, youth 0.12; no included study was rated strong (High for the synthesis, weak primary studies). A sport-only meta-analysis by Ammar and colleagues reported SMD 0.24, not significant (seen only as cited, title unverified, Low).
- The benefit depends on the learner and the task: principles from simple laboratory tasks may not generalise to complex skills, and some reverse (Wulf and Shea 2002, Med). The challenge-point idea that novices need less interference follows from this and is widely used in coaching, but was not separately sourced here.
- **Consequence.** Interleaving is a reasonable default with a small expected benefit, not a settled fact. The stronger reason to interleave is specificity: the reference game never presents one skill on repeat (vision principle 7). It has to be tested in Flickline, against retention, and it has to stay fun.

### 3.4 Feedback frequency

- The guidance hypothesis says feedback on every trial makes learners depend on it, and reduced feedback frequency helps retention (Salmoni, Schmidt and Walter 1984; Winstein and Schmidt 1990; Low-Med as read through citations).
- **The best recent evidence is close to null.** A pre-registered meta-analysis of reduced feedback frequency found g = 0.21 at delayed retention and 0.06 at immediate retention, with no reliable difference between the two (McKay et al. 2021, k = 37, N = 1,145, Med); a reanalysis from the same group reports high heterogeneity and severely underpowered studies (preprint, Low).
- **Consequence.** This document does not rely on feedback fading to produce learning. It turns the cues off during the Baseline for a different, firmer reason: a test should be taken under the conditions the skill is meant for (section 5.4). Whether cues should fade in practice stays with #129 and its experiment.

### 3.5 Aim-trainer-to-game transfer

- **No controlled study was found** that tests whether aim-trainer practice changes in-game performance in the reference game, Counter-Strike or Overwatch, 2019–2026. This confirms `human-performance.md` §7. A blog cites a 2026 randomised trial in esports athletes with reaction-time gains; the paper could not be found (Low, not used).
- The closest study trained *inside* a shooter: 21 action-game players, 15 sessions over three weeks, adaptive-difficulty Counter-Strike against the default game; the adaptive group improved more on difficulty-corrected kill/death ratio (time × group F = 4.22, p = 0.017), with no difference in cognitive transfer tests (Neri et al. 2021, Front. Psychol., Med). It supports matched difficulty, not trainer-to-game transfer.
- Aim-trainer tasks are reliable: KovaaK's scenarios had test-retest ICCs of 0.947–0.995 over 3–5 days in 10 players, averaged over 8 attempts, with performance still rising at the last round (Rogers et al. 2024, Front. Sports Act. Living, Med); Aim Lab hits per second had ICC 0.89–0.96 with five runs a day and 0.88–0.94 with three, while hit rate was lower at 0.62–0.86 (Listman et al. 2021, Med). Neither links scores to rank or to in-game results, and Rogers et al. warn against extrapolating to games.
- **Consequence.** Flickline cannot cite anyone's evidence for its promise. It has to make its own, and the first round of that evidence can only be a pilot.

### 3.6 Measurement error and small studies

- The standard error of measurement is `SEM = SD × √(1 − ICC)` and the smallest real change is `MDC95 = 1.96 × √2 × SEM`, the √2 because both measurements of a change carry error (Weir 2005, formula standard, High; citation read second-hand). ICCs of averages are higher than those of single attempts, and speed measures (hits per second) are more reliable than accuracy (Listman et al. 2021). The SEM should come from one's own repeated measurements, not a borrowed ICC.
- A pilot "is not a hypothesis testing study", "does not provide a meaningful effect size estimate", and its results "should not be used for sample size determination"; it is for recruitment, adherence, whether the assessments work, and variance (Leon, Davis and Kraemer 2011, J. Psychiatr. Res., Med).
- For a two-group pre-post comparison, analysis of covariance with the pre-test as covariate needs fewer participants than comparing change scores or post-test scores (Vickers and Altman 2001, BMJ, Med).
- Motor learning does not reverse, so a crossover design (each tester does both arms in turn) is unsuitable; two parallel arms are the only fair design (inference).

---

## 4. What the reference game lets a player measure

Players cannot export data from the reference game without a third-party app and account linking (its developer API requires the player's opt-in through its sign-on, High), and Flickline will never fetch anything. Every reference number is typed in by the player.

| Measure | What it is | Repeatable? | Noise | Use |
|---|---|---|---|---|
| **Shooting test, Hard** | The practice range's shooting test: 30 bots appear and disappear on a countdown; the score is bots killed out of 30. Speed setting Easy, Medium or Hard; separate toggles for strafing bots, bot armour and infinite ammo (guides, Med). Community targets on Hard run from about 5–10 at the lowest ranks to 22–28 at the highest (Low). | The settings are fixed; whether bot order is randomised is not confirmed, so treat single runs as noisy. | Unknown; take the median of 3 runs. | Check-in and pilot (primary). |
| **Headshot % over 20+ matches** | Head hits ÷ all hits, as tracker.gg and most sites define it (some sites use kills; Med). Competitive medians run from 11% (Iron 1) through 20% (Gold 2) and 26% (Diamond 2) to 32% (Radiant), with the middle half of a rank about ±4 points around its median (tracker.gg, 4.5 million players, 28 Oct–11 Nov 2026, High). The same analysis says a single match is too small a sample and that HS% within a rank does not predict winning. | Yes, as a rolling window. | Large per match; the 20-match window is the site's own recommendation. | Check-in (secondary). Too slow for a two-week pilot unless testers play 20+ matches in it. |
| **Free-for-all deathmatch** | First to 40 kills or 9 minutes, up to 14 players (Riot support, High). | Lobby skill varies, so kills per match is not comparable. | Large. | Pilot secondary only: HS% over 3 deathmatches, never kills. |
| Rank, ADR, KAST | Match outcomes. | — | Driven by team, map and opponents; ADR differs between pages of the same site (Low). | Rank is recorded as context only; ADR and KAST are not used. |

Not confirmed: the shooting test's exact end-screen wording, whether its bot order is randomised, and its default armour per speed setting. The check-in therefore records the settings the player used and asks them to keep them.

---

## 5. The Daily Baseline

### 5.1 When it runs

- A Baseline is **due** when the player has not finished any Flickline run in the last **8 hours**. Retention tests in research use at least 24 hours (section 3.1), but for a player who practises daily that would make the benchmark skip every other day; 8 hours makes it "the first run of the day" (HYPOTHESIS: long enough for the previous session's warm-up to be gone). The save records the gap before every Baseline, so H1 (section 9) can test 8 hours against 24 from real data and raise the gap if needed.
- When it is due, the **Play** button's first run is the Baseline. It is never forced: it can be skipped with the same key as any run, and a skipped day is simply a gap in the series.
- At most one Baseline counts per calendar day (local time); a second due Baseline the same day is still played and shown, but only the first enters the trend.
- After the run, the results card asks one optional question with one key: **"Aimed in any game in the last hour?"** A yes marks the Baseline **warm**: it is drawn hollow and left out of the trend. Asking after the run keeps the first shot within the zero-friction budget (design pillar 4).

### 5.2 What it contains

- **Version 1 (the first-playable modes):** a fixed-length hybrid on the Range with the Kestrel, built from the Placement run's trial engines: **40 trials**, 20 Orbit-style (`flick`) and 20 Cold-Start-style (`precision`), alternating. At the modes' paces this takes about 45 s (DERIVED: 20 × 1.3 s + 20 × 0.86 s, from the trials per minute in design §4.1–§4.2). A fixed trial count, not a fixed time, so every player answers the same items.
- **A fixed item set, not a fixed seed.** Each skill has one item list generated once, at each Baseline level, from a fixed generator seed and stored as data: per item the angle from the crosshair, the pitch, the distance (or Beacon scale) and the exposure. Each day the run's seed (shown on the card as usual) shuffles the order and mirrors each item left or right. Every Baseline therefore has exactly the same difficulty while the sequence differs, so the player cannot learn the layout. (The issue proposed a fixed seed; a fixed seed played daily for weeks would let a player memorise where the first targets appear, which is a gain that transfers nowhere.)
- **No adaptation inside the run.** No staircase, no beats, no wave curve: every item runs at the player's Baseline level for that skill.
- **Later versions** add `footwork` and `angles` when Stop & Pop (#47) and Corner Clear (#50) exist. Each content change is a new **Baseline version**; a version change starts a new series on the profile (section 5.7).

### 5.3 Baseline levels

A pinned dial must suit both a new player and an expert, or it floors one and ceilings the other. The Baseline therefore has **six levels per skill**, at dial **15, 30, 45, 60, 75 and 90**, each with its own stored item list.

- **First Baseline:** each skill gets the highest level at or below `θ_skill − s × logit(p_target)` (the matched dial of design §9.3: about θ − 7.6 for flick at 70%, θ − 1.8 for precision at 55%), so the first Baseline is no harder than the player's matched runs.
- **Level up** when that skill's success rate exceeds 85% in 3 of the last 5 valid Baselines; **level down** when it is below 35% in 3 of the last 5 (HYPOTHESIS: keeps the success rate in the range where the estimate is informative).
- Level changes are rare by construction and drawn on the trend as a marker. Because the estimate is on the dial scale (section 5.5), the series stays continuous across a level change as far as the item difficulty model is right; checking that it is right is one of the bot tests (section 9, H4).

### 5.4 Presentation: the reference-like run

A skill is meant to be used in the reference game, so it is tested under the reference game's conditions: a measure taken with Flickline's coaching cues on would include whatever the player has learned to lean on them. During the Baseline the player therefore sees and hears only what the reference game also gives them: the shot, the target's reaction (Posts and Beacons still shatter, so a hit target is gone), and the hit and kill sounds. Off for this run, whatever the settings say: the amber moving-shot tracer, the `⇆` glyph and the tock, the miss ghost, damage numbers, the time-to-shot and time-to-kill readout, the stat strip, the ghost-pace bar and the edge meter. The results card afterwards shows everything. This is also the "clean run" #129 proposes; it does not depend on #129's feedback-fading hypothesis, whose evidence is weak (section 3.4).

### 5.5 The number

- **Estimate.** For each skill, θ is estimated from that Baseline's 20 trials alone: the grid posterior of design §9.1 with a **flat prior** and the symmetric scale `s = 9`, at the level's item difficulty. It does not read or update the player's long-running posterior, so the Baseline is an independent measurement. The **Baseline score** is the mean of the skills' estimates, shown on the rating scale (dial × 30).
- **Raw metrics** stored alongside, comparable directly within a level: first-bullet head rate, Orbit hit rate, median time to shot, flick error. Speed measures are more reliable from one attempt to the next than accuracy measures in aim-trainer data (section 3.6); the success criterion already includes speed through each item's exposure, and the median time to shot is kept so a later version can weight it if the data supports that.
- **Precision of one Baseline** (DERIVED): for the logistic model the information per trial is `p(1 − p)/s²`. At `s = 9` and a 70% success rate, 20 trials give a standard error of about 4.4 dial points per skill; at 55% (precision) about 4.1; the two-skill mean about 3.0 dial points (90 rating points). This is measurement error only; a player's real day-to-day variation adds to it, and the player's own data replaces the estimate (below).

### 5.6 What counts as "improved"

- **Valid Baselines** only: not warm, not a repeat the same day, current version.
- **Trend.** Compare the mean of the last `k` valid Baselines with the mean of the `k` before them, with `k = min(7, floor(n / 2))` and no claim until `k ≥ 3` (6 valid Baselines).
- **Noise band.** The player's own day-to-day spread, estimated from successive differences so that a steady trend does not inflate it: `σ = √(mean((x_i − x_{i−1})²) / 2)`. The band is `1.96 × σ × √(2 / k)` (DERIVED: the 95% interval of a difference of two means of `k` independent values). Until the player has 6 valid Baselines, σ defaults to the measurement error of section 5.5 (3.0 dial points), which gives a band of about 4.8 dial points at `k = 3` and 3.1 at `k = 7`.
- **What the game says**, on the Baseline results card and the profile:
  - beyond the band upward: "**Improved**: +X since last week, more than your day-to-day noise (±Y)";
  - inside the band: "**Steady**: within your day-to-day noise (±Y)";
  - beyond the band downward: "**Lower** than last week" with no further judgement (a bad week is information, not failure, `fight-attribution.md` §5).
- **The Retained medal** (design §8.4): awarded on a Baseline results card that reports "Improved", at most once per 7 days. It is the one reward for learning rather than for performing, and it is derived from mechanics only.

### 5.7 What the player sees

- **Baseline results card.** The standard card (design §8.2) with the Baseline score, its delta from the previous valid Baseline, the trend line above, the warm question, and no matched-rating delta (the Baseline does not change the matched rating).
- **Profile** (#37). The headline is the **Baseline trend**: one point per valid Baseline (hollow for warm ones), the two comparison windows, the noise band and the verdict line. The matched ratings, tiers and radar stay below it, labelled "matched rating: where your targets are set". Each Baseline version is its own series.
- **Warm-up gap.** On the profile, the difference between today's Baseline and today's best matched rating, labelled "warm-up and practice today". It tells the player how much warming up they need, which is useful before a ranked match in the reference game, and shows plainly that in-session gains are not the same as learning.
- **Taken X of the last 14 days** under the trend, so a series built only from good days is visible as such.

### 5.8 Guards

| Risk | Guard |
|---|---|
| Memorising the Baseline | Fixed item set, daily shuffle and mirroring (section 5.2). |
| Warming up elsewhere first | The warm question; warm Baselines are excluded. |
| Skipping bad days | "Taken X of 14" shown; skipped days are not imputed. |
| Changing sensitivity or hardware | A sensitivity change between Baselines is marked on the trend like a level change. |
| Balance changes moving the dial mapping | Any change to the Baseline's item lists or to the dial axes it uses bumps the Baseline version; the conformance suite (#64) gets a test that fails if the stored item lists change without a version bump. |
| Over-claiming | No verdict before 6 valid Baselines; "Improved" only beyond the player's own noise band. |

---

## 6. The reference check-in

- **What.** An optional prompt, at most weekly, on the first Baseline results card at least 7 days after the last check-in. One key dismisses it; a setting (Data → "Reference check-in") turns it off for good.
- **Fields**, all optional, typed by the player:
  1. **Shooting test on Hard**: up to three scores out of 30 (the median is used), with the settings used (weapon, bot armour, strafing bots, infinite ammo), prefilled from the last check-in with "same settings as last time".
  2. **Headshot % over the last 20 competitive matches**, from a stats site, with the site's name (sites define HS% differently, section 4).
  3. **Rank**, optional, for context only.
- **Storage.** In the save object only (`checkins`, design §14.5), exported and imported with it. No network request is ever made with it; the export file is the only way it leaves the browser, and only when the player chooses.
- **Display.** On the profile, under the Baseline trend and on the same time axis: the shooting-test median and the 20-match HS%. Flickline shows the two series side by side and **makes no claim about the relationship** for one player; one player's correlation over a few weeks says nothing about cause. The pilot (section 7) is where the relationship is studied.

---

## 7. The transfer pilot

### 7.1 Design

- **Testers.** At least 6, target 12, who play the reference game every week, roughly from Silver to Diamond (away from the floor and ceiling of the shooting test), and who do not already use an aim trainer daily.
- **Assignment.** Pair testers by their pre-test shooting-test median and toss a coin within each pair: one to **Flickline**, one to **reference practice**. Pairing keeps the arms balanced at tiny numbers.
- **Practice, 14 days, 20 minutes a day, at least 10 of the 14 days.**
  - Flickline arm: Today's session as built at the time (Baseline, Mix runs, Sweep or drills), and nothing else for aim practice.
  - Reference-practice arm: the reference game's practice range (shooting test, bots) and deathmatch, and nothing else for aim practice.
  - Both arms keep playing the reference game as they normally do and log the matches they play, so normal play is the same in both arms and recorded.
- **Tests, before (day 0) and after (day 15 or 16, at least 24 hours after the last practice), each cold, before any other game that day.**
  1. **Primary:** shooting test, Hard, fixed settings for everyone (rifle chosen once per tester and kept, bot armour off, strafing bots off, infinite ammo on), 5 runs, median.
  2. **Secondary:** headshot % over 3 free-for-all deathmatches; 20-match HS% if the tester played 20 matches in the period.
  3. **Near transfer:** one Flickline Baseline in both arms (the reference-practice arm plays only these two Baselines). If the Flickline arm improves on the Baseline but not on the reference test, Flickline teaches something that does not carry over.
  4. A short form: days completed, minutes, "did it carry over?" (1–5), "did you enjoy the practice?" (1–5), and "what would make you skip a day?"
- **Data.** Testers type their numbers into a shared sheet and share their Flickline export file; results are posted on the playtest issue in aggregate and without names.

### 7.2 Analysis

- Per tester: post − pre on each measure, listed in full.
- Per arm: the mean change and its spread; between arms: the difference in mean change, paired by the coin-toss pairs, with its 95% interval reported as a description, not as a test (section 3.6).
- Feasibility: how many testers were recruited and finished, days and minutes completed, whether every test was taken cold and on the fixed settings, how long the tests took, and which measures were too noisy to use.
- The standard deviations and the test-retest spread of the shooting test (from the 5 runs at each test) are reported for planning, with Leon and colleagues' caution that a pilot's numbers do not size the next study on their own.

### 7.3 Verdicts

The pilot decides two things: whether the real study can be run, and whether anything already points the wrong way.

| Result | Verdict on the Transfer track | What happens |
|---|---|---|
| Testers recruited, ≥ 80% completed ≥ 10 of 14 days, all tests taken cold on fixed settings | **Feasible** | Plan the real study (section 7.5). |
| Any of those failed | **Not feasible as designed** | Fix the protocol (shorter, different measure, more reminders) and pilot again. |
| Flickline arm improves on the Baseline but its reference-test change is no better than the other arm's | **Warning: may not carry over** | Not proof, but a reason to run the habit review on every mode the arm played before building more. |
| Reference-practice arm improves clearly more on the reference test than the Flickline arm (every pair, or the interval below zero) | **Warning: worse than the reference game's own practice** | Top-priority finding on #128 and the Transfer tracker. |

A pilot never earns a "transfer shown" verdict; only the real study can.

### 7.4 What a pilot this size can and cannot say

- With 12 testers (6 per arm), a two-sided test at 5% would need a standardised difference of about **1.8** to have an 80% chance of detecting it; with 6 testers (3 per arm), about **3.0** (DERIVED by simulating a two-sample t-test). Training effects are usually far smaller, so a null result says almost nothing, and an apparent effect is too uncertain to rely on.
- Testers know which arm they are in; there is no placebo for practice. Fixed written instructions and the same tests for both arms are the mitigation.
- It is still the first evidence the promise can get, and nothing else checks that the measures and the protocol work.

### 7.5 After the pilot: the real study

If the pilot is feasible, the same protocol runs with enough testers to detect a moderate effect. Analysis of covariance on the post-test needs fewer participants than comparing change scores (section 3.6), but for a moderate standardised difference of 0.5 it still needs about 64 testers per arm with a t-test on the post-test, or about 33 per arm with the covariate if pre and post correlate at 0.7 (DERIVED: the usual two-sample calculation, then n × (1 − r²)). That needs recruitment beyond friends of the project (a public call to the game's players, an opt-in form and the export file) and is filed as its own issue once the pilot has reported.

---

## 8. Practice schedule: interleaving today's session

### 8.1 Today

Today's session (design §2) is three single-skill 60-second warm-up runs (lowest-rated skill, the last flagged skill, a favourite) and then one Sweep run: a block of one skill per run, the condition section 3.3 says tends to look better in practice than in retention.

### 8.2 Change

- **Today's session = Baseline (when due) → Mix → Mix → Sweep.**
- A **Mix** run is a 60-second run on one map with one weapon whose trials are drawn from 2 or 3 skills: the session's chosen skills (the same three picks as today: lowest-rated, last flagged, a favourite) restricted to those that share a map and weapon. The order is random with at most two trials of the same skill in a row. Every trial runs at its own skill's matched dial and is reported on its own skill, exactly as the Placement run already does for `flick` and `precision`, so a Mix needs no new engine, only a scheduler over existing trial engines.
- **Blocked first.** A skill with fewer than 60 trials in its posterior is practised in its own single-skill run first: its matched dial is still a guess from the correlation prior, and the benefit of interference depends on the learner and may not hold for a skill that is new to them (section 3.3). The Placement run already gives every player a mixed first minute on `flick` and `precision`, so in practice this applies to skills the player has not played yet.
- **Single-skill drills stay one key away**: the mode cards and the results card's "Practice this" button are unchanged. Only the default sequence behind **Play** changes.
- **Sweep is already interleaved** (every contact mixes skills) and stays the session's last run.

### 8.3 Test

Interleaving inside a run is a hypothesis for a game, not a settled fact (section 3.3), and it also has to stay fun (vision principle 2). The test is a Flickline-only experiment, so it does not need reference-game measurements and can recruit more testers than the pilot: two groups for one week, interleaved sessions against blocked sessions, same minutes; outcome the Baseline on day 8 (at least 24 hours after the last session) minus day 1, plus restart rate and the fun question set (`docs/fun-criteria.md`). If interleaved retains at least as well and is not less fun, it stays the default; otherwise the session goes back to blocked runs. The session builder takes the schedule as data, so the experiment can assign it.

---

## 9. Hypotheses and how to confirm them

| # | Hypothesis | Test |
|---|---|---|
| H1 | 8 hours away is enough for a Baseline to be "cold". | From saves (pilot and playtest exports): compare Baselines after 8–24 h with those after more than 24 h; if the 8–24 h ones are reliably higher, raise the gap. |
| H2 | One Baseline estimates ability to about ±3 dial points (two skills). | Bot harness: simulated players of known, fixed ability play 50 Baselines each at every level; the spread of their estimates must be within 20% of section 5.5's figure. |
| H3 | A player who only warms up is never told "Improved". | Bot harness: a simulated player whose ability rises 6 dial points within each session and returns to the same cold value each day plays 30 days; the trend must report "Steady" every day. |
| H4 | A player who really learns is told so, and the series survives a level change. | Bot harness: a simulated player whose cold ability rises 1 dial point per day must be reported "Improved" within 14 days, including across a level change, with no step at the change larger than the noise band. |
| H5 | The fixed item set cannot be memorised. | Bot harness: the item order and mirroring of two days' Baselines must differ (seeded), and their item difficulty statistics must be identical. |
| H6 | Interleaved Mix runs retain at least as well as blocked runs and are as fun. | Section 8.3. |
| H7 | Flickline practice transfers at least as well as the reference game's own practice. | Section 7. |
| H8 | The reference check-in is used. | Pilot form and playtest: share of testers who fill in at least two check-ins without being told to. |

H2–H5 run in the bot harness (#28) in seconds and belong in CI with the Baseline's build issue.

---

## 10. The Transfer quality track

Numbers, feel and fun are tracked separately because they fail separately (design §14.7). Transfer fails separately too: the numbers can match, the feel can be right and the game fun, and the reference game still not move. It gets the same standing as the other three: a long-lived tracking issue, a label (`quality:transfer`), a checklist document and a verdict in every playtest.

- **Question.** Does skill earned in Flickline carry over to the reference game, and does every mode teach only habits that are also right there?
- **Judged by** (`docs/transfer-checklist.md`):
  1. **Habit review**, per mode, in every playtest pass: each checklist item scored *same*, *different but harmless* or *harmful* with evidence; harmful items are bugs (vision principle 1) and are filed with `quality:transfer`.
  2. **Measurements**: the Baseline's bot tests (H2–H5) passing in CI, and the Baseline and check-in data from playtests.
  3. **The pilot verdict** (section 7.3), once it has run.
- **Pass rule**, by phase, is in the checklist document.
- **Conflicts.** Mechanical truth already outranks fun inside the mechanics (design §14.7). A harmful habit is a mechanical-truth defect even when the mode is fun; the fix may change the mode, not the mechanics.

---

## 11. Build backlog and changes to existing issues

### 11.1 Build backlog (filed as issues, listed on #128 and on the Transfer tracker)

| Issue | What | Depends on |
|---|---|---|
| [#149](https://github.com/omkarbhale/flickline/issues/149) | Quality track: transfer (long-lived tracker), label `quality:transfer`. | — |
| [#160](https://github.com/omkarbhale/flickline/issues/160) | review: first transfer habit review of Cold Start, Orbit and the Placement run (first playable). | — |
| [#150](https://github.com/omkarbhale/flickline/issues/150) | feat(modes): Daily Baseline run — fixed item sets, levels, daily shuffle and reference-like presentation (section 5.1–5.4). | #23 |
| [#151](https://github.com/omkarbhale/flickline/issues/151) | feat(skill): Baseline estimate, series and trend, with bot tests H2–H5 (sections 5.3, 5.5–5.6, 9). | #150, #38, #28 |
| [#153](https://github.com/omkarbhale/flickline/issues/153) | feat(ui): Baseline on the results card and as the profile headline — verdict, warm-up gap, Retained medal (section 5.7). | #151, #37 |
| [#154](https://github.com/omkarbhale/flickline/issues/154) | feat(ui): reference check-in (section 6). | #151, #38, #37 |
| [#157](https://github.com/omkarbhale/flickline/issues/157) | feat(modes): Mix runs and the interleaved Today's session (section 8.2). | #43, #150 |
| [#158](https://github.com/omkarbhale/flickline/issues/158) | playtest: transfer pilot (section 7). | #150, #151, #153, #157 |
| [#159](https://github.com/omkarbhale/flickline/issues/159) | playtest: practice-schedule experiment (section 8.3). | #157, #150, #151 |

### 11.2 Changes to existing issues (posted as comments)

- **#43** (menu shell, Today's session): the session becomes Baseline (when due) → Mix → Mix → Sweep, built by #157; #43 keeps the Play button and mode cards.
- **#37** (profile screen): the Baseline trend is the headline; matched ratings move below it (built by #153).
- **#38** (persistence, medals): new save fields `baselines`, `baselineLevels`, `checkins`; a 13th medal, Retained.
- **#26** (results card, merged): the Baseline variant of the card is built by #153.
- **#129** (fading cues): the Baseline is its "clean run"; the feedback-frequency evidence is weaker than #129 states (section 3.4).
- **#29, #56** (playtests): each now reports a fourth verdict, Transfer, using the checklist's report template.
- **#61, #62, #63** (quality tracks): linked to the fourth track, #149.
- **#9, #10** (phase trackers): the new issues are listed for their phase.
- **#64** (conformance suite): a test that fails if the Baseline's stored item lists change without a version bump (#150).

---

## 12. Open questions and default answers

| # | Question | Default |
|---|---|---|
| 1 | Should tiers and the Ascent medal move to the Baseline instead of the matched rating? | No. Tiers say where the targets are set, which is what the matched rating is for; the asymmetric update and the two-run demotion buffer (design §9.3, §8.4) already damp an evening's warm-up. The Baseline is the *progress* claim. Revisit if playtests show players reading tiers as progress. |
| 2 | Should the Baseline give score and medals? | Score yes (it is a run, and the score table is dial-adjusted); performance medals yes; no ghost pace or PB comparison during the run, because those are cues. Retained is the only Baseline-specific medal. |
| 3 | What about players who play twice a day, 8 hours apart? | Both runs are Baselines, but only the first of a calendar day enters the trend (section 5.1). |
| 4 | Which skills join Baseline version 2? | `footwork` (Stop & Pop on the Lane) first, because it ranks first for transfer (`human-performance.md` §6.2); `angles` next. Decided when #47 lands; each version is its own series. |
| 5 | Can the check-in feed the skill model? | No. Typed numbers from another game, measured under unknown conditions, must not move difficulty. |
| 6 | Should the Baseline be shared or compared between players? | Not now: no backend, no accounts (design §15). The item sets are fixed per level and version, so a later shared leaderboard would be fair. |

---

## 13. Sources

Read in two research passes on 2026-11-14. Titles in square brackets are descriptions, where the exact title was not captured. "Read" means the page text was retrieved; "abstract" or "cited" means only an abstract, a search summary or a citing source was seen. Items not found are listed at the end.

**Learning, retention and warm-up**

- Soderstrom, N. C. and Bjork, R. A. (2015). Learning versus performance: an integrative review. *Perspectives on Psychological Science* 10(2), 176–199. Abstract.
- Kantak, S. S. and Winstein, C. J. (2012). Learning–performance distinction and memory processes for motor skills. *Behavioural Brain Research* 228, 219–231. Abstract.
- Schmidt, R. A. and Lee, T. D. (2019). *Motor Learning and Performance* (textbook); the 24-hour retention convention, cited in a secondary source.
- Lee, T. D. and Genovese, E. D. (1988). Distribution of practice in motor skill acquisition: learning and performance effects reconsidered. *Research Quarterly for Exercise and Sport* 59(4), 277–287. Abstract.
- Adams, J. A. (1961). The second facet of forgetting: a review of warm-up decrement. *Psychological Bulletin* 58, 257–273. Cited. Nacson, J. and Schmidt, R. A. (1971), the activity-set hypothesis. Cited. Verhoeven, F. M. and Newell, K. M. (2018), via a publisher excerpt. Read (excerpt).
- Listman, J. B. et al. (2021). Long-term motor learning in the "wild" with high volume video game data. *Frontiers in Human Neuroscience* 15. Read.

**Practice schedule and feedback**

- Shea, J. B. and Morgan, R. L. (1979). Contextual interference effects on the acquisition, retention, and transfer of a motor skill. *Journal of Experimental Psychology: Human Learning and Memory* 5(2), 179–187. Cited; PDF linked from `docs/reviews/vision-review-1.md`.
- Brady, F. (2004). Contextual interference: a meta-analytic study. *Perceptual and Motor Skills* 99, 116–126. Cited (effect sizes as quoted in Czyż 2024).
- Barreiros, J., Figueiredo, T. and Godinho, M. (2007). The contextual interference effect in applied settings. *European Physical Education Review* 13, 195–208. Abstract.
- Czyż, S. H., Wójcik, A. M. and Solarská, P. (2024). [Meta-analysis of contextual interference and delayed transfer.] *Frontiers in Psychology*. Read.
- Wulf, G. and Shea, C. H. (2002). Principles derived from the study of simple skills do not generalize to complex skill learning. *Psychonomic Bulletin and Review* 9, 185–211. Abstract.
- Salmoni, A. W., Schmidt, R. A. and Walter, C. B. (1984). Knowledge of results and motor learning. *Psychological Bulletin* 95, 355–386. Cited. Winstein, C. J. and Schmidt, R. A. (1990). Reduced frequency of knowledge of results enhances motor skill learning. *Journal of Experimental Psychology: Learning, Memory, and Cognition* 16, 677–691. Cited.
- McKay, B. et al. (2021). Meta-analysis of the reduced relative feedback frequency effect on motor learning and performance. *Journal of Exercise, Movement, and Sport* 52(1). Read (abstract, pre-registered).
- Donovan, J. J. and Radosevich, D. J. (1999). A meta-analytic review of the distribution of practice effect. *Journal of Applied Psychology* 84(5), 795–805. Abstract (spaced over massed, mean weighted effect 0.46, smaller for complex tasks; supports short daily sessions).

**Aim trainers and shooters**

- Neri, F. et al. (2021). [Adaptive-difficulty training inside a first-person shooter.] *Frontiers in Psychology* 12, 598410. https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8224404/ Read.
- Rogers, Trotter, Johnson, Desbrow and King (2024). [Test-retest reliability of aim-trainer (KovaaK's) scenarios.] *Frontiers in Sports and Active Living* 6, 1309991. Read.
- Donovan et al. (2022). [Flick speed-accuracy assessment and kinematics in professional players.] *Frontiers in Human Neuroscience* 16, 979293. Read (authors largely from the trainer's maker).

**Measurement and study design**

- Weir, J. P. (2005). Quantifying test-retest reliability using the intraclass correlation coefficient and the SEM. *Journal of Strength and Conditioning Research* 19(1), 231–240. Formula via secondary sources.
- Leon, A. C., Davis, L. L. and Kraemer, H. C. (2011). The role and interpretation of pilot studies in clinical research. *Journal of Psychiatric Research* 45(5), 626–629. Read.
- Vickers, A. J. and Altman, D. G. (2001). Analysing controlled trials with baseline and follow up measurements. *BMJ* 323, 1123–1124. Cited.

**The reference game**

- Shooting test, bot settings and community score targets: Dignitas warm-up guide, https://dignitas.gg/articles/blogs/valorant/14416/a-comprehensive-guide-on-warming-up-in-valorant (2020, Med); Strafe range guide, https://www.strafe.com/news/read/valorant-range-map-all-you-need-to-know-guide/ (1 Jul 2026, Med); Switchblade Gaming, https://www.switchbladegaming.com/valorant/aim-training-guide-2/ (29 Apr 2026, Low).
- Practice range patch notes 9.02 and 13.05: https://playvalorant.com/en-US/news/game-updates/valorant-patch-notes-902/ and https://playvalorant.com/en-us/news/game-updates/valorant-patch-notes-13-05/ (High).
- Headshot % by rank and its definition: tracker.gg, "Is your headshot rate actually good for your rank", https://tracker.gg/valorant/articles/is-your-headshot-rate-actually-good-for-your-rank (11 Nov 2026, High for the data).
- Free-for-all deathmatch rules: https://support.riotgames.com/en-us/valorant/gameplay/valorant-game-mode-ffa-deathmatch (High).
- Developer API opt-in policy: https://developer.riotgames.com/docs/valorant (High).

**Searched for and not found**

- Any controlled study of aim-trainer practice against in-game performance (2019–2026); a 2026 randomised trial cited by a blog could not be located.
- A peer-reviewed size or time course of warm-up decrement in first-person aiming.
- Match-to-match variance of headshot % for one player.
- A primary source for the shooting test's bot count, its end-screen wording and whether its bot order is randomised.
