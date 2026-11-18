# Replay, not drills: what keeps people playing an action game, and how practice can hide inside play

Issue: [#187](https://github.com/omkarbhale/flickline/issues/187). Tracker: [#188](https://github.com/omkarbhale/flickline/issues/188). Date: 2026-11-14.

The owner's statement, which this document serves (now vision principle 10): Flickline is not an aim trainer in the general sense. There are no drills. If a player has to do a routine over and over, like a drill, that is not enjoyable. Flickline wants repeat enjoyment, not one-time or zero-time enjoyment.

Four questions:

1. What gives action games lasting replay value?
2. Why are drills and aim trainers abandoned?
3. How can deliberate practice live inside play so the player never feels drilled?
4. Which games are known to improve a specific skill while being played for fun?

Evidence tags follow the other research documents: **High** (peer-reviewed experiment or meta-analysis, or a designer's own first-hand account read in full), **Med** (observational study, industry telemetry or estimates, a designer account read second-hand), **Low** (community guides, forums, vendor blogs, press opinion). **HYPOTHESIS** marks this document's own inference. Where a source could be seen only as an abstract or a search summary, the finding says so. The search ran on 2026-11-14 with two research passes; their raw notes (about 160 URLs) are kept with the task data, and every source cited below is listed in section 8.

---

## 1. Summary

**Findings**

1. **People come back to games that satisfy autonomy and competence, not to routines that earn rewards.** Need satisfaction (autonomy, competence, relatedness) explains much of a game's appeal and predicts future play (Ryan, Rigby and Przybylski 2006, High). Tangible rewards for doing an interesting task undermine intrinsic motivation (Deci, Koestner and Ryan 1999, 128 studies, High, contested). Points, badges and leaderboards raised output but not intrinsic motivation (Mekler et al. 2017, High), and a leaderboard-and-badges course lowered motivation over a semester (Hanus and Fox 2015, High). Long-term exercise adherence follows intrinsic, not extrinsic, motivation (Teixeira et al. 2012, 66 studies, High).
2. **Aim trainers are tried and dropped by most of the people who download them.** Steam estimates put the median lifetime playtime of Aim Lab at about 1 h 16 min (mean 11 h) and of KovaaK's at about 5 h 18 min (mean 67 h): a large mass who leave early over a small, devoted core (SteamSpy, Med, estimates). No trainer publishes retention curves. Players' own complaints are mostly that the skill does not carry over and that their bottleneck is not raw aim, rather than boredom as such (forums, Low). Ericsson's definition of deliberate practice says it is effortful and "not inherently enjoyable" (1993, High), which is the owner's objection in the field's own words.
3. **Lasting replay in action games comes from systemic variety, decisions with stakes, and a mastery ceiling, in short sessions with long arcs.** Left 4 Dead's Director argues static placement lets players converge on "an optimal strategy that works every time", and that procedural population turns a session into "a skill challenge instead of a memorization exercise" (Booth, GDC 2009, High). Run-based games pair short runs with an opt-in difficulty ladder (Hades' Heat, Med) and a meta layer that makes a failed run still count (Vampire Survivors, Med). Spelunky's one-attempt daily seed raises stakes and "teaches new methods" (essay, Med). Titanfall's designers aimed at easy access with deep mastery (High); Neon White's director says the fun is returning with knowledge to go faster (High).
4. **Sport science has a name for practice that is play: the constraints-led approach and representative learning design.** Behaviour emerges from task, performer and environment constraints, so a coach shapes the task instead of prescribing the movement (Newell 1986; Renshaw et al. 2010, High). Practice must keep the information-movement couplings of the real performance (Pinder et al. 2011, High), which is the formal case against an isolated target range. Game-based approaches (Teaching Games for Understanding, Play Practice, small-sided games) are well liked and improve tactical and technical behaviour, though the reviews rate methodological quality low (Clemente et al. 2021, Med).
5. **Variety helps, but rigid interleaving schedules are not worth building.** Random practice beats blocked practice for retention in the lab (Shea and Morgan 1979, High), but the effect is negligible in applied settings (Brady 2004 meta-analysis, High). Learning is best at a functional difficulty matched to the learner (challenge point framework, Guadagnoli and Lee 2004, High). A game's natural variety is probably enough (HYPOTHESIS).
6. **No public study shows that an aim trainer improves reference-game results, and deliberate practice did not predict esports performance in a registered report.** Aim-trainer tasks are reliable measures (Rogers et al. 2024, n = 10, High) but untested for transfer. In 186 Counter-Strike and 411 League of Legends players, deliberate practice had no meaningful relation to performance (Martončik et al. 2024, registered report, High, read via the registered-report record). An adaptive-difficulty virtual batting simulator did transfer to real batting better than extra real practice (Gray 2017, n = 80, High), the strongest precedent for "a game-like simulator with adaptive difficulty".
7. **Players already practise reference-game mechanics by playing modes, not drills.** Coaches and pro organisations describe deathmatch as more realistic than the range "because enemies shoot back", and a Cloud9 coach says deathmatch helps only with a chosen focus (Low). Rocket League's best-regarded improvement mode is open free play, not training packs (Low). Fighting-game communities warn that hours of offline combo practice do not prepare you for play you have not met (Low).

**Decision** (applied in `docs/design.md` §1–§4, §8.3–§8.5, §9.2)

- **Flickline is one game, Sweep**: a run of about thirteen fights in two to four minutes (design §4.1, #274; first written as five to nine minutes, at a fight pace #248 ruled out) through six sectors of fights against Echoes that perceive, decide and aim like players of your level, with health carried between fights, a route you choose at every gate, stakes that climb to a Finale, and an optional Overtime where you decide when to bank. There are no drills.
- **Each reference-game mechanic is practised as a constraint of the fight, not a routine**: moving shots miss because the spec says so and Echoes shoot back (footwork); placed holders punish a low crosshair (angles, precision); multi-Echo contacts punish hesitation (switch); strafing Echoes and meet contacts demand tracking. The player feels the problem first and gets the explanation after, as Teaching Games for Understanding orders it.
- **Variety is systemic**: scenario cards, enemy personalities, routes across maps, tempo, conditions and stakes, all drawn from a seed. No set piece is authored to be memorised.
- **The one thing to fix is practised by playing**: the next run leans toward the situations that exercise it. There is no "Practice this" button.
- **Learning is measured inside play**: the Daily Baseline becomes the cold opener, the first sector of the day drawn from a calibrated pool; nobody sits a test.
- **Rewards stay mechanical and informational**: no XP, no login streak, no unlock gates. The long arc is run records, situation records, rank and the cold-opener trend.

---

## 2. Why drills and aim trainers are abandoned

### 2.1 What the numbers show

| Finding | Evidence |
|---|---|
| Aim Lab: 2–5 million owners on Steam, mean lifetime playtime 11 h 06 min, **median 1 h 16 min**, median last-two-weeks playtime 22 min. A mean nine times the median means a heavy tail of devoted users over a mass who tried it briefly. | SteamSpy, Med (estimates; the page flags stale values; Aim Lab is free, so it is cheap to try and drop) |
| KovaaK's: 0.5–1 million owners, mean 67 h, **median 5 h 18 min**. The paid trainer keeps a more committed core. | SteamSpy, Med |
| KovaaK's concurrent players rose from about 2,100 to about 3,000 a month on average over the year to October 2026. A devoted niche persists and grows. | SteamCharts, Med |
| No aim trainer publishes day-1/7/30 retention, and no survey of why players quit trainers was found. | Search result (gap) |
| Context: across mobile apps, mean day-30 retention is about 8%; across 16,000 games the median is under 1%, with the top 1% at roughly 10–15%. Sticking is rare everywhere; drills are not uniquely abandoned. | OneSignal 2024, Med; GameAnalytics 2026 via summary, Med |

**Reading.** The data cannot separate "boring" from "did not help" from "free and tried once". It does show the shape the owner fears: for most users an aim trainer is a few hours of use and then nothing (zero-time or one-time enjoyment), while a small group finds it fun for its own sake.

### 2.2 What players say

- The most common complaint is **transfer**, not boredom: "better scores ≠ better aim"; a player who trained four or five days saw raw aim improve and their match play get worse; others name sensitivity feel, movement, spray control and crosshair placement as what the range does not teach (vlr.gg threads, Low).
- The second is **the bottleneck**: "most people are not bottlenecked by their aim but by game sense"; "the range doesn't implement crosshair placement, movement, actually predicting a human player's movement" (Reddit snippets, Low, unverified).
- A minority train because they **enjoy it**: an Immortal-rank player with about 400 hours in trainers keeps going "because it's fun" while calling it mostly useless for rank (vlr.gg, Low).

### 2.3 What motivation science says about routines

- **Need satisfaction drives return.** Four studies applying Self-Determination Theory to games found that appeal and future play are largely explained by autonomy, competence and relatedness (Ryan, Rigby and Przybylski 2006, High; Przybylski, Rigby and Ryan 2010, High). A fixed routine offers competence feedback but little autonomy: the player does not choose anything that matters.
- **Rewards for doing the routine erode the reason to do it.** Tangible rewards for an interesting task undermine intrinsic motivation (Deci, Koestner and Ryan 1999, High; contested by Cameron and colleagues in the same journal issue). Informational feedback is not the problem; rewards contingent on doing the task are. Gamification works in some contexts and backfires in others (Hamari, Koivisto and Sarsa 2014 review, High). Points and leaderboards raised output with no gain in intrinsic motivation (Mekler et al. 2017, High); a leaderboard-and-badges course lowered motivation over 16 weeks (Hanus and Fox 2015, High).
- **Streaks work, which is the trap.** Duolingo raised 7-day retention by 14% with a streak wager and reports streak users far more likely to finish a course (Duolingo, Med). Its own product lead adds that "streaks can't make up for a weak product" (Med). Streak machinery retains people in a routine; the owner has ruled the routine out, so a streak that rewards showing up would keep people doing exactly what they do not enjoy (HYPOTHESIS).
- **Adherence to effortful routines is poor.** Gym dropout reaches about 50% in six months (2025 review, Med); intrinsic motivation predicts long-term exercise adherence better than extrinsic (Teixeira et al. 2012, High).
- **Deliberate practice is defined as not enjoyable.** Ericsson, Krampe and Tesch-Römer (1993, High) describe it as effortful, relevant and not inherently enjoyable, done for its instrumental value; the claim rests mostly on a violinist diary study and is disputed (Matuschak, Low). Boredom is the state of wanting engagement and failing to find it in the situation (Eastwood et al. 2012, High).

**Conclusion for Flickline.** The owner's statement agrees with the evidence on motivation: a routine sustained by rewards for doing it does not keep people, and the people it keeps are those who already enjoy the routine. Flickline's mechanics have to be the thing that is enjoyable, and the reasons to return have to come from play that differs each time.

---

## 3. What gives action games lasting replay value

| Driver | What the evidence says | Source |
|---|---|---|
| **Systemic variety, not authored content** | Static enemy and item placement lets players memorise "an optimal strategy that works every time"; procedural population turns play into "a skill challenge instead of a memorization exercise". The Director runs a four-state pacing loop (build up, sustain peak for 3–5 s, peak fade, relax for 30–45 s) driven by a per-player intensity value. | Booth, *The AI Systems of Left 4 Dead*, GDC 2009 (High) |
| | Deep Rock Galactic generates each mission from handcrafted building blocks plus code, with modifiers independent of mission type; reviewers credit them for its replayability. | Ghost Ship dev blog (Med); Game Informer review (Low) |
| **Meaningful decisions with stakes** | A replayable game needs a "periodic dilemma generator": a core mechanic that keeps presenting meaningful, unpredictable choices, often low-risk/low-reward against high-risk/high-reward. The author offers it as a hypothesis and names the headshot as a shooter's own dilemma. | Game Developer essay (Low, hypothesis) |
| | Risk of Rain 2's difficulty rises with elapsed time, so thoroughness trades against pressure: push on or collect. | Wiki (Low) |
| **Short runs, long arcs** | Vampire Survivors' creator champions short games; its meta layer means a failed run still leaves progress. Hades' Pact of Punishment is an opt-in ladder of conditions, and its top level took leading players years. | GamesRadar interviews (Med); RPG Site, GamesRadar (Low) |
| | An endless mode raised perceived replayability in one student case study. | HAW Hamburg master's thesis (Low) |
| **Shared daily seeds** | Spelunky's daily challenge gives one attempt at one shared seed: the essay says the one life raises stakes, makes players deliberate and "teaches new methods for playing the game"; a critic says the leaderboard pushes risk-averse play. | Game Developer essay (Med); The Ludite (Low) |
| **Mastery ceiling and expressive mechanics** | Titanfall's designers wanted "easy access to powerful abilities" while experts "transform the way the game is played at high levels". Apex left wall-running out to avoid busting the skill ceiling. | Designer interview (High); press report (Low) |
| | Neon White: the fun is returning with knowledge to go faster; the obvious route earns a weak medal; setting fair medal times across skill levels was hard. | Designer interview (High); TheGamer, Vice (Low) |
| **Score as style** | ULTRAKILL's style meter and DOOM Eternal's resource loop tie the score or the resources to playing the intended way (variety, aggression). | Fan wiki (Low); Game Developer on DOOM Eternal (Med) |
| **Instant, legible failure** | Hotline Miami makes both sides die in one hit and restarts instantly. Juul argues that failure motivates when the player can escape it by improving. | Interview (Med); Juul, *The Art of Failure* (Med) |
| **Challenge matched to the player** | Flow-based dynamic difficulty works best when the player chooses challenge through in-game choices rather than a hidden system alone. | Chen, *Flow in Games* thesis (Med); critique (Low) |

**What this means for a mechanics game (HYPOTHESIS).** None of these games keeps players through repetition of a fixed task. Each one varies the situation while keeping the mechanics constant, so mechanical knowledge carries from run to run while the problems change. Flickline's mechanics must stay constant for transfer (vision principle 1), so its variety has to come from the situation: enemy minds, information, routes, conditions and stakes. That is exactly the space the project's earlier research already built (`player-like-enemies.md`, `engagement-information.md`).

---

## 4. Practice inside play without feeling drilled

| Approach | What it says | Implication for Flickline (HYPOTHESIS) |
|---|---|---|
| **Constraints-led approach** (Newell 1986; Renshaw, Chow, Davids and Hammond 2010; Chow et al. 2007; High) | Movement emerges from the interaction of task, performer and environment constraints. Coaches shape the task and let the learner find the solution. | Express each skill as a rule of the fight so it is the way to win: moving shots miss (spec), so stopping is learned because it wins, not because a ring says "stand". |
| **Representative learning design** (Pinder, Davids, Renshaw and Araújo 2011; Davids et al. 2013; High) | Practice must keep the information the real performance couples to (functionality, action fidelity), not merely look like it. | A static target lacks peek timing, shoulder swings, sound and an enemy who shoots back. Every fight carries the reference game's information through honest channels; the target range is only an unscored lobby. |
| **Teaching Games for Understanding** (Bunker and Thorpe 1982); **Play Practice** (Launder); **small-sided games** (Clemente et al. 2021 umbrella review, Med) | Start from a modified game; teach technique after the learner feels the tactical need; reduce the game to compress decisions per minute. Small-sided games are enjoyed and improve tactical and technical behaviour, with low-quality reviews. | A run is a chain of small-sided fights (one to four Echoes). The fight comes first; the cause line and the one thing to fix come after, never a lecture before. |
| **Variability of practice** (Schmidt 1975 schema theory, support mixed) and **contextual interference** (Shea and Morgan 1979, High; Magill and Hall 1990 review, High; Hall et al. 1994, baseball, High) | Random and varied practice gives better retention and transfer than blocked practice in the lab and in some sport studies. | Fights vary distance, angle, timing, weapon, cover and enemy behaviour by construction. |
| **…and its limits** (Brady 2004 meta-analysis, High; Brady 2008, unverified) | The effect is medium in the lab and negligible in applied settings. | No interleaving curriculum (v1's Mix runs and their experiment are dropped): natural variety is enough. |
| **Challenge point framework** (Guadagnoli and Lee 2004, High; 2025 scoping review) | Learning peaks at a functional difficulty set by skill and task; harder practice can lower practice performance and still aid learning. | Keep the skill-matched dial and the ~70% target, applied to fights; difficulty moves only between sectors. |
| **Desirable difficulties** (Bjork and Bjork 2011, High) | Variation, interleaving, spacing and testing help long-term learning; confusing or impossible tasks are undesirable difficulties. | Audit unfair deaths and interface friction as defects (fight attribution's Dealt cause, `fight-attribution.md`). |
| **External focus** (Wulf, Shea and Lewthwaite 2010; Chua et al. 2021 meta-analysis g = 0.58 for retention and transfer; High, reporting bias argued) | Feedback about the effect in the world beats feedback about the body. | Cause lines and fix copy describe the world ("your crosshair was at the floor when it swung"), never the wrist. |
| **OPTIMAL theory** (Wulf and Lewthwaite 2016, High) | Enhanced expectancies, autonomy and external focus together strengthen learning. | Route choice and Overtime give autonomy; fights at ~70% give expectancy of success. |
| **Deliberate practice and its critics** (Ericsson et al. 1993; Macnamara et al. 2014: 26% of variance in games; Ericsson and Harwell 2019; Martončik et al. 2024: no relation in Counter-Strike or League; High) | Practice quality (feedback, challenge, concentration) matters more than hours; in esports the deliberate-practice construct did not predict performance. | The active ingredients a game can supply are feedback and matched challenge, both already product (vision principles 3 and 5). Hours of routine are not the point. |
| **Deliberate play** (Côté's developmental model; 2022 review, mixed support) | Elite athletes logged as much enjoyable, unstructured play as practice in their early years. | A play-first design has precedent as a route to expertise. |
| **Exploration** (Stafford and Dewar 2014, 854,064 players, High) | Players who varied their play more early on scored higher later. | Reward trying different routes and approaches; never steer to one correct way. |

---

## 5. Games known to improve a skill while being played for fun

| Claim | Evidence | Grade |
|---|---|---|
| Action games improve visual attention | Green and Bavelier 2003 trained non-players on an action game and found attention gains; Bediou et al. 2018 meta-analysis supports attention and spatial cognition. Sala, Tatlidil and Gobet 2018 (three meta-analyses) find small or null effects on general cognition. | Contested (High on both sides) |
| Tetris improves mental rotation | A registered replication (n = 366) found Tetris no better than Solitaire; both improved from repeated testing. | High, negative |
| Adaptive-difficulty simulators transfer to a real skill | Virtual batting with adaptive difficulty beat extra virtual practice, extra real practice and control, with better league results reported over five years (Gray 2017, n = 80). | High (one study) |
| Adaptive Counter-Strike training | 21 FPS-naive adults, 15 sessions: the adaptive-bot group progressed further, with no group difference on aiming tasks or cognitive transfer (Neri et al. 2021). | High, tiny sample |
| Playing the game itself builds the game's skill | Halo Reach telemetry from 3.2 million players: the heaviest players gained most skill in total; 4–8 matches a week gained most per match; breaks of 1–2 days were harmless (Huang et al. 2017). | Med (observational) |
| Aim-trainer gains are retained only in part | Aim Lab, 7,174 players: hit rate plateaued within days, hits per second kept rising; about 65% of a day's gain was retained the next day; most benefit came from about 30–60 minutes a day (Listman et al. 2021, authors affiliated with the vendor). | Med |
| Aim trainer to reference-game rank | Not found in any public study; KovaaK's tasks are reliable but untested for transfer (Rogers et al. 2024). | Gap |
| Reference-game deathmatch as practice | Coaches and pro organisations use deathmatch as warm-up and a realistic setting because enemies shoot back; a Cloud9 coach says it helps only with a chosen focus. Riot reportedly described its deathmatch as a middle ground between a competitive mode and aim warm-up. | Low |
| Rocket League free play over training packs | Dignitas calls open free play arguably the most important improvement mode; ranked play trains game sense. | Low |
| osu! improves FPS aim | No study found; anecdote only. | Gap |

**Reading.** The best evidence that play builds a skill is for the skill the game itself exercises (near transfer), with adaptive difficulty helping (Gray 2017, Neri 2021). Claims of broad cognitive benefit are contested, and Flickline makes none. Flickline's bet is near transfer: the reference game's own mechanics, numbers and information, inside fights that look like its fights. It still has to produce its own evidence (`transfer.md` §7).

---

## 6. What this means for Flickline

Each line names the finding and where the design applies it.

1. **One game, no drills** (findings 1, 2, 7; Pinder 2011). Design §4.10 retires every drill as a thing the player chooses and reuses their measurement code inside fights.
2. **The mechanics are the fun loop** (Titanfall, Neon White; constraints-led approach). A clean first-bullet kill, a counter-strafed duel won and an isolated angle are what pay (design §8.1), with the feedback of §7 unchanged.
3. **Systemic variety** (Booth 2009; Deep Rock Galactic). Routes, cards, Echo personalities, tempo, conditions and stakes (design §2.4); every source of variety changes how fights are played, not only how they look.
4. **Decisions with stakes** (dilemma generators; Risk of Rain 2; Spelunky). Gate doors with honest information and a stake, tempo against noise, Overtime bank or push (design §4.3, §4.5, §4.7).
5. **Pacing with tension and release** (Booth 2009). The depth curve, a breather sector before the Finale, and the hold sectors' arrivals (design §4.1).
6. **Short runs, long arcs, no extrinsic loops on the routine** (Vampire Survivors; Deci 1999; Hanus and Fox 2015). Two-to-four-minute runs; run records, situation records, rank and the cold-opener trend; no XP, no login streak, no unlocks (design §2.5, §8.4).
7. **A daily seed** (Spelunky). The Daily Route (design §4.8): unlimited attempts, so the critic's risk-averse pressure is weaker; the day best is local.
8. **Practice the fix by playing** (TGfU; external focus). The next run leans toward the situations that exercise the one thing to fix (design §8.3); fix copy speaks about the world.
9. **Measure learning inside play** (`transfer.md` §3; Rogers 2024). The cold opener replaces the Daily Baseline (design §8.5).
10. **Keep a free-aim sandbox, unpromoted** (research B's open question; Rocket League free play). The Lobby behind the menu, unscored (design §13.4). It costs nothing and serves the players who enjoy free aiming, without making it the product.

---

## 7. Hypotheses and how to confirm them

| # | Hypothesis | How to test it | What would change the design |
|---|---|---|---|
| R1 | A run of six sectors (about thirteen fights, two to four minutes to the Finale's exit; design §4.1, #274) is the length that brings players back for another. | Repeat-enjoyment playtest: runs started per session, voluntary restarts after death, "one more run" answers, the journal's time to the Finale's exit against the target; bot harness for the run-length distribution (a floor for a person's). | Median sessions with one run and no restart: do not shorten the run, which is already short. Look first at deaths that come too early (lethality, #165) and at whether a run holds enough fights to tell a story (more contacts per sector). Players stopping mid-run: add a checkpoint at the gate. |
| R2 | Route choice at gates is a real decision, not noise. | Log door choices against the HP and shield state; ask testers why they picked. | Choices independent of state, or "I just picked left": make the stakes larger or the information clearer, or drop doors for a fixed route with more card variety. |
| R3 | Systemic variety is enough to keep run 20 fresh. | Ask on day 3 and day 7: "did this run feel different from the last?"; count repeated sector-and-card pairs. | "Same fights again" reports: add sector maps before anything else (design §10.1). |
| R4 | The lean practises the one thing to fix without feeling like a drill. | Compare the flagged stat's change over the next two runs with and without the lean (seeded A/B in the bot harness, then testers); ask whether the next run felt "set up". | No change, or testers notice and dislike it: lower the weight or show it less. |
| R5 | The cold opener measures learning as well as the 40-trial Baseline it replaces. | Bot harness: simulated players with a known ability trend; the cold score's standard error and the trend's false-positive rate against the Baseline's (`transfer.md` H4). | Error above about ±6 dial points or false "Improved" verdicts above 5%: lengthen the cold opener or add a second cold sector. |
| R6 | Carried health and death ending the run raise stakes without making players quit. | Quits right after a death against restarts; frustration answers; HP at death. | High quit-after-death: add a second life at the Finale gate, or soften with more Shield doors. |
| R7 | No XP, streaks or unlocks still gives enough long-term pull. | Day-3 and day-7 return of testers who were not asked to return. | Low return with good in-session fun: add a mechanical-only long goal (for example, a per-card mastery ladder) before considering any reward for time. |

R1, R6 and R7 are read from the local play journal (`docs/playtests/play-journal.md`, #251), not from recall: `npm run journal -- <export>...`.

---

## 8. Sources

**Motivation and retention**
- Ryan, Rigby and Przybylski 2006, *The motivational pull of video games*: [ACU record](https://acuresearchbank.acu.edu.au/item/8q128/the-motivational-pull-of-video-games-a-self-determination-theory-approach); [PDF](https://www.rochester.edu/warner/lida/wp-content/uploads/2022/11/02bfe513dd59366750000000.pdf)
- Przybylski, Rigby and Ryan 2010, motivational model of video game engagement: [Essex repository](https://repository.essex.ac.uk/7228/)
- Ryan and Deci 2000, Self-Determination Theory: [PubMed](https://pubmed.ncbi.nlm.nih.gov/11392867/)
- Deci, Koestner and Ryan 1999, extrinsic rewards and intrinsic motivation: [PDF](https://depts.washington.edu/techdocs/papers/deciExtrinsicRewardsAndIntrinsicMotivation99.pdf); 2001 reply: [PDF](https://www.selfdeterminationtheory.org/SDT/documents/2001_DeciKoestnerRyan.pdf)
- Hamari, Koivisto and Sarsa 2014, does gamification work: [PDF](https://www.lescahiersdelinnovation.com/wp-content/uploads/2019/06/2014-hamari_et_al-does_gamification_work.pdf)
- Mekler et al. 2017, points, levels and leaderboards: [PDF](https://glassmanlab.seas.harvard.edu/annotated_works/mekler17.pdf)
- Hanus and Fox 2015, gamification in the classroom: [doi:10.1016/j.compedu.2014.08.019](https://doi.org/10.1016/j.compedu.2014.08.019)
- Teixeira et al. 2012, exercise and self-determination: [IJBNPA](https://ijbnpa.biomedcentral.com/track/pdf/10.1186/1479-5868-9-78)
- Health-club dropout review 2025: [Frontiers in Psychology](https://www.frontiersin.org/articles/10.3389/fpsyg.2025.1512270/full)
- Eastwood et al. 2012, the unengaged mind: [Perspectives on Psychological Science](https://journals.sagepub.com/doi/abs/10.1177/1745691612456044)
- Ericsson, Krampe and Tesch-Römer 1993: [KU Leuven repository](https://lirias.kuleuven.be/316700); Matuschak on enjoyment: [note](https://notes.andymatuschak.org/zTgkGMCSgQes6NL1kCFZpEC)
- Duolingo streaks: [blog](https://blog.duolingo.com/how-duolingo-streak-builds-habit); [streak wager](https://making.duolingo.com/how-streaks-keep-duolingo-learners-committed-to-their-language-goals); [Lenny's Newsletter](https://lennysnewsletter.com/p/behind-the-product-duolingo-streaks)
- Retention benchmarks: [OneSignal 2024](https://onesignal.com/mobile-app-benchmarks-2024); [GameAnalytics 2026 summary](https://gamedevreports.substack.com/p/gameanalytics-mobile-and-pc-game)

**Aim trainers and players' reports**
- SteamSpy: [Aim Lab](https://steamspy.com/app/714010), [KovaaK's](https://steamspy.com/app/824270); SteamCharts: [KovaaK's](https://steamcharts.com/app/824270)
- Forums: [vlr.gg, does Aim Lab work](https://www.vlr.gg/post/5099190/does-aimlabs-works); [vlr.gg, aim trainers](https://www.vlr.gg/post/4305657/aim-trainers-come); [vlr.gg, pros who use KovaaK's](https://www.vlr.gg/post/6533708/pros-who-use-kovaaks); [Steam community, Aim Lab](https://steamcommunity.com/app/714010/discussions/0/5956623715029942934)
- Coach on deathmatch (summary only): [Dot Esports](https://dotesports.com/valorant/news/valorant-coach-explains-why-youre-using-deathmatch-wrong-and-how-you-can-improve)
- Riot and Aim Lab: [Riot announcement](https://www.riotgames.com/en/news/aim-lab-and-riot-headed-to-the-next-level)

**Replay value and game design**
- Booth 2009, *The AI Systems of Left 4 Dead*: [readable copy](https://www.readkong.com/page/the-ai-systems-of-left-4-dead-michael-booth-valve-9664541); [original PDF](https://cdn.fastly.steamstatic.com/apps/valve/2009/ai_systems_of_l4d_mike_booth.pdf)
- Periodic dilemma generators: [Game Developer](https://www.gamedeveloper.com/design/replayable-games---game-mechanics-as-periodic-dilemma-generators-pdg-)
- Replayability framework thesis: [HAW Hamburg](https://reposit.haw-hamburg.de/bitstream/20.500.12738/19142/1/MA_Entwicklung_und_Evaluation_motivierender_Wiederspielbarkeits-Mechaniken.pdf)
- Hades: [Kasavin, GDC podcast](https://gdconf.com/news/roguelikes-and-narrative-design-hades-creative-director-greg-kasavin-gdc-podcast-ep-16); [Pact of Punishment](https://rpgsite.net/feature/10287-hades-pact-of-punishment-heat-modifiers-and-how-to-maximize-your-rewards); [highest Heat](https://gamesradar.com/hades-highest-difficulty-is-so-tough-that-top-players-say-a-single-attempt-takes-at-least-85-hours-to-pull-off)
- Risk of Rain 2: [design interview](https://www.gamedeveloper.com/disciplines/how-moving-from-2d-to-3d-shaped-the-design-of-i-risk-of-rain-2-i-); [difficulty](https://riskofrain2.wiki.gg/wiki/Difficulty)
- Deep Rock Galactic: [cave generation](https://devtrackers.gg/deep-rock-galactic/p/8cd5ca9c-below-decks-at-ghost-ship-cave-generation-in-deep-rock-galactic); [review](https://www.gameinformer.com/index.php/review/deep-rock-galactic/deep-rock-galactic-review-off-to-work-we-go)
- Vampire Survivors: [creator interview](https://www.gamesradar.com/games/roguelike/on-steam-alone-i-probably-have-3-000-hours-nobody-loves-vampire-survivors-more-than-its-creator-who-once-thought-nobody-would-play-it-for-more-than-two-hours-and-ironically-says-short-games-rule)
- Spelunky daily: [essay](https://gamedeveloper.com/design/the-understated-genius-of-the-i-spelunky-i-daily-challenge); [critique](https://theludite.com/2014/06/23/spelunky-when-scoring-goes-bad/); [daily runs](https://gamedeveloper.com/design/the-24-hour-ticket-examining-daily-runs-)
- Titanfall: [designer interview](https://www.gamedeveloper.com/design/designer-interview-getting-i-titanfall-i-s-controls-just-right); Apex wall-running: [report](https://charlieintel.com/respawn-dev-explains-why-apex-legends-will-never-have-wall-running/75098)
- Neon White: [designer interview](https://www.gamedeveloper.com/road-to-igf-2023/-neon-white-and-designing-for-player-creativity); [medal times](https://www.thegamer.com/neon-white-devs-fair-medal-times/)
- ULTRAKILL style: [wiki](https://ultrakill.fandom.com/wiki/Style_Index); DOOM Eternal: [resource management](https://www.gamedeveloper.com/design/the-aggressive-resource-management-of-i-doom-eternal-i-)
- Hotline Miami: [interview](https://www.ibtimes.co.uk/hotline-miami-dennis-wedin-jonatan-soderstrom-interview-447406); Juul, *The Art of Failure*: [publisher](https://www.penguinrandomhouse.com/books/656618/the-art-of-failure-by-jesper-juul/)
- Chen, *Flow in Games*: [abstract](https://jenovachen.info/abstract)

**Practice design and motor learning**
- Newell 1986: [record](https://scilit.com/publications/9d34b071469b94dd4e637d3faf833c88)
- Renshaw, Chow, Davids and Hammond 2010: [SHU repository](https://shura.shu.ac.uk/3344/); Chow et al. 2007: [SHU repository](https://shura.shu.ac.uk/3300)
- Pinder, Davids, Renshaw and Araújo 2011: [PDF](https://www.aut.ac.nz/__data/assets/pdf_file/0007/380698/Representative-Learning-Design-and-Functionality-of-Research-and-Practice-in-Sport.pdf); Davids et al. 2013: [SHU repository](https://shura.shu.ac.uk/7310)
- Bunker and Thorpe 1982: [note](https://sure.sunderland.ac.uk/id/eprint/20097/1/Special%20Blog%20Bunker%20and%20Thorpe%E2%80%99s%20%281982%29%20Curriculum%20Model.pdf); Launder, *Play Practice*: [publisher](https://us.humankinetics.com/collections/coaching/products/play-practice-2nd-edition-pdf); Harvey and Jarrett 2014: [record](https://research.brighton.ac.uk/en/publications/a-review-of-the-game-centred-approaches-to-teaching-and-coaching-/)
- Small-sided games umbrella review: [Clemente et al. 2021](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7880470/)
- Schmidt 1975: [record](https://experts.mcmaster.ca/scholarly-works/1313630); Shea and Morgan 1979: [PDF](https://www.gwern.net/doc/psychology/spaced-repetition/1979-shea.pdf); Magill and Hall 1990: [record](https://scilit.net/publications/9adde6960f3c752f999022401ae53d96); Hall, Domingues and Cavazos 1994: [PubMed](https://pubmed.ncbi.nlm.nih.gov/8084699/)
- Brady 2004: [PDF](https://www.gwern.net/docs/spaced-repetition/2004-brady.pdf); 2024 contextual-interference meta-analysis: [Frontiers](https://frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2024.1377122/full)
- Guadagnoli and Lee 2004: [record](https://experts.mcmaster.ca/scholarly-works/1313883); 2025 scoping review: [PDF](https://eprints.leedsbeckett.ac.uk/id/eprint/12281/1/ChallengeAcceptedASystematicScopingReviewOfTheapplicationsOfTheChallengePointFrameworkPV-JONES.pdf)
- Bjork and Bjork 2011: [PDF](https://bjorklab.psych.ucla.edu/wp-content/uploads/sites/13/2016/04/EBjork_RBjork_2011.pdf)
- Wulf, Shea and Lewthwaite 2010: [PubMed](https://pubmed.ncbi.nlm.nih.gov/20078758/); Chua et al. 2021: [UNLV](https://digitalscholarship.unlv.edu/kns_fac_articles/424); Wulf and Lewthwaite 2016: [PubMed](https://pubmed.ncbi.nlm.nih.gov/26833314/)
- Macnamara, Hambrick and Oswald 2014: [PubMed](https://pubmed.ncbi.nlm.nih.gov/24986855/); Ericsson and Harwell 2019: [PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC6824411)
- Côté, Baker and Abernethy: [record](https://queensu.scholaris.ca/items/0e493f47-703f-4962-9f22-419889b924d6); sampling pathways review 2022: [Frontiers](https://frontiersin.org/articles/10.3389/fspor.2022.903886/full)
- Stafford and Dewar 2014: [White Rose](https://eprints.whiterose.ac.uk/id/eprint/83582/)

**Skill from play, esports and transfer**
- Green and Bavelier 2003: [PubMed](https://pubmed.ncbi.nlm.nih.gov/12774121/); Bediou et al. 2018: [PDF](https://learningtransferlab.wiscweb.wisc.edu/wp-content/uploads/sites/280/2017/11/Bediou_et_al_PsychBull_2017.pdf); Sala, Tatlidil and Gobet 2018: [Liverpool repository](https://livrepository.liverpool.ac.uk/3030312/)
- Tetris registered replication: [PMC](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11062957/)
- Gray 2017, virtual batting: [PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC5733365)
- Neri et al. 2021, adaptive Counter-Strike: [Frontiers](https://www.frontiersin.org/articles/10.3389/fpsyg.2021.598410/full)
- Rogers et al. 2024, KovaaK's reliability: [PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC10925653)
- Listman et al. 2021, Aim Lab motor learning: [Frontiers](https://www.frontiersin.org/journals/human-neuroscience/articles/10.3389/fnhum.2021.777779/full)
- Huang et al. 2017, Halo and StarCraft telemetry: [PDF](https://jeffhuang.com/papers/MasterMaker_TOPICS17.pdf); [Brown news](https://www.brown.edu/news/2017-02-27/gameskill)
- Martončik, Karhulahti, Jin and Adamkovič 2024: [PCI registered report](https://rr.peercommunityin.org/articles/rec?id=565); [doi:10.1525/collabra.117677](https://doi.org/10.1525/collabra.117677)
- Rocket League practice: [Dignitas](https://dignitas.gg/articles/blogs/Unknown/12753/free-play-vs-custom-training-a-rocket-league-training-article)
- Fighting games: [Dustloop](https://dustloop.com/w/Getting_Started); [PlayStation guide](https://compete.playstation.com/en-us/article/5-tips-for-how-to-practice-more-than-just-combos-fighting-game-lab-guide-basics-beginners-learn-to-lose)
- Reference-game warm-up and deathmatch: [Dignitas warm-up guide](https://dignitas.gg/articles/a-comprehensive-guide-on-warming-up-in-valorant); [Dignitas on headshots](https://dignitas.gg/articles/how-to-start-hitting-more-headshots-in-valorant); [why no endless deathmatch](https://win.gg/news/heres-why-valorant-doesnt-have-an-infinite-deathmatch-mode/)
