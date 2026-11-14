# Human performance baselines and skill-transfer evidence

Research for issue #12. It supplies the numbers behind the difficulty dial (design §9.4), the fairness floors (§9.3), and the drill order (§3, §4). This document is read-only research: it proposes changes to the design, it does not make them. `docs/design.md` is not edited. Every change below is a proposal, collected in section 9 and posted on #12.

- Research date: 2026-11-14.
- Design references (`§x`) are to `docs/design.md` as drafted on branch `fm/fl-design` (not on `main` when this was written). Spec references (`spec §x.y`) are to `docs/mechanics-spec.md`. Weapon, movement, damage, FOV and sensitivity numbers are taken from the spec and not repeated here.
- Reference game: Valorant, called "the reference game" as elsewhere in the repo.

## 0. How to read this document

### 0.1 Confidence tags

| Tag | Meaning |
|---|---|
| **High** | Primary source (paper, developer post) that was read directly, and the figure is quoted from it. |
| **Med** | Primary source seen only as an abstract or search snippet, or a secondary source that points to a primary one. |
| **Low** | Snippet only from a secondary source, vendor or coaching content, undocumented method, or an inference. |
| **DERIVED** | Arithmetic on cited numbers; the arithmetic is shown. |
| **ESTIMATE** | My judgement, not sourced. Marked so that nobody treats it as data. The balance pass (#53) should replace each one with measurement. |

### 0.2 What could not be found (read this before relying on the tables)

- **No published flick-time table** (milliseconds against angle and target size) for first-person aiming, and no public Aim Lab or KovaaK dataset of one. Section 2 therefore gives a Fitts model with stated assumptions, not measured flick times.
- **No dataset of time-on-target against angular speed.** Section 3 gives pursuit-eye literature and derived angular speeds only.
- **No Valorant or CS peer-reviewed study of reaction time to a suddenly visible target.** The reaction-time evidence is lab simple and choice RT plus one expertise study.
- **No published share of kills made while moving, or share of kills by one-tap, spray or flick, for the reference game.** The transfer ranking in section 6 is therefore a judgement from coaching and mechanics evidence, not a measurement. Sources are largely coaching and vendor content.
- Several primary PDFs could not be parsed (Looser 2005, Zaranek 2014, Kosinski 2005, Claypool, Wilson 2019 full text). Where I rely on an abstract or snippet it is stated in the confidence column.

## 1. Reaction time

### 1.1 Cited baselines

| Quantity | Value | Source | Confidence |
|---|---|---|---|
| Simple visual RT, ages 18–24, 60 Hz LCD, mouse click, n = 86 of 1,469 | Mean **217.8 ms** (about 200 ms after subtracting 17.8 ms of measured display + mouse delay). Between-subject SD 19.5 ms; trial-to-trial SD 39.4 ms. Responses under 110 ms were discarded as anticipations (3.2% false alarms). | Woods et al. 2015, *Factors influencing the latency of simple reaction time*, Front. Hum. Neurosci. https://pmc.ncbi.nlm.nih.gov/articles/PMC4374455/ | High |
| Simple visual RT, whole sample 18–65 | Mean 230.8 ms, between-subject SD 26.8 ms. Rises about 0.55 ms per year of age. | Same | High |
| Four-alternative choice RT, ages 18–24 | Mean **472 ms**, SD 58.8 ms (central processing = 262 ms on top of SRT). Rises about 2.8 ms per year. The task is a conjunction discrimination, not a plain which-location choice. | Woods et al. 2015, *Age-related slowing of response selection and production in a visual choice reaction time task*. https://pmc.ncbi.nlm.nih.gov/articles/PMC4407573/ | High for the value, Low as a Hick benchmark |
| Hick's law slope | RT = a + b·log2(n+1); b is about 100–200 ms per doubling of alternatives. Practice lowers it. | Hick 1952 / Hyman 1953, as summarised in secondary pages (https://en.wikipedia.org/wiki/Hick%27s_law gives no numbers; the figures came from snippets) | Low |
| Popular large-sample consumer measurement | Median 273 ms, mean 284 ms, 81 million clicks (Human Benchmark). Includes device and browser lag. | Reported via https://www.blurbusters.com/human-reflex-part1-input-lag-and-the-limits-of-human-reaction-time (page not readable; snippet only) | Low |
| Historic lab simple visual RT | 181–189 ms (Galton); about 187 ms for light in Kosinski's review. | https://bionumbers.hms.harvard.edu/bionumber.aspx?id=110800 and a mirror of Kosinski 2005 | Med |
| Experts vs novices | Counter-Strike players with more than 5,000 hours were about 90 ms faster than novices on a visual decision-and-reaction task (drift-diffusion analysis; more than 300 participants). Not a multitasking advantage. | Hyde and von Bastian, J. Exp. Psychol.: HPP, DOI 10.1037/xhp0001466, via the University of Sheffield press page https://sheffield.ac.uk/news/are-counter-strike-players-better-decision-making-study-reveals-faster-brain-processing-expert | Med (press release, not the paper) |
| Pros vs non-pros on lab RT | No difference in simple, auditory or choice RT between 18 pro and 21 non-pro esports players and 36 traditional athletes (n = 75). | Bickmann and Wechsler 2021, abstract only | Low-Med (no ms values seen) |
| Elite vs non-gamer Stroop RT | Elite CS:GO about 720–790 ms vs non-gamers about 865–940 ms. A Stroop task, not target-onset RT. | Toth, Kowal and Campbell 2019. https://pmc.ncbi.nlm.nih.gov/articles/PMC6932966 | High for the table, Low for relevance |
| Floor of human visual RT | Responses under about 110 ms are treated as anticipation; no ordinary click is below about 150 ms to a surprise visual target. Auditory sprint starts can be below 100 ms (not a visual mouse response). | Woods 2015 (110 ms cut-off); Pain and Hibbs 2007 (abstract). The 150 ms statement is my inference. | Med / ESTIMATE |
| Riot on typical RT | "Often fall in the 300 ms range" (no source given). Playtesters detected changes of about 10 ms; gunfights were decided by 20–50 ms. | Riot, *Peeking into VALORANT's netcode* https://www.riotgames.com/en/news/peeking-valorants-netcode | High that Riot says it, Low as evidence |

### 1.2 What the numbers mean for the game

Reaction time and time-to-shot are different things, and the design currently conflates them.

- **RT in the design (§3) is "time from `targetVisible` to the first shot within 5° of the target".** That includes the time to move the crosshair and click, not just perception and decision. It should be labelled **time to shot**, never "reaction time", in the UI and code names. Pure RT cannot be measured on a screen because the aiming movement is always part of it. Proposal P1.
- Expected *time to shot* (ESTIMATE, built from DERIVED pieces: 0.22 s simple RT + 0.02 s hardware delay + movement time from section 2):
  - Pre-aimed (crosshair already within 2° of where the target appears): **0.25–0.35 s**.
  - Small relocation (10–25°): 0.45–0.9 s depending on size.
  - Large flick (60–120°): 0.9–1.5 s.
  - Use these ranges for the results card's context line, not as pass/fail thresholds.
- Anything that needs a *decision* (which target, which action) is in choice-RT territory: add about 100–200 ms per doubling of alternatives (Low).
- An unpredictable target location costs additional time over simple RT; the figure commonly quoted (20–40 ms) could not be verified and should not be used.

## 2. Aiming: flick time, Fitts's law, sensitivity

### 2.1 Cited baselines

| Quantity | Value | Source | Confidence |
|---|---|---|---|
| Fitts's law, Shannon form | MT = a + b·log2(A/W + 1), ID = log2(A/W + 1) bits. | MacKenzie, *HHCI handbook*, ch. 2018. https://www.yorku.ca/mack/hhci2018.html | High |
| Mouse throughput, ISO 9241-9 | **3.7–4.9 bits/s** across 9 studies ("typically 4–5"). Non-ISO fits range 2.55–12.5 bits/s, which shows how model-dependent the figure is. | Soukoreff and MacKenzie 2004, IJHCS 61:751–789. https://www.yorku.ca/mack/ijhcs2004.html | High |
| Typical a for mouse | The 1978 Card fit has a = 1,030 ms, which the authors themselves call unreasonably large. A throughput of 4.5 bits/s implies b of about 220 ms/bit (my arithmetic, DERIVED). a and b tables were images and could not be extracted. | Same | Low for a, DERIVED for b |
| Fitts's law holds with viewpoint rotation | A first-person task fits Fitts's law "excellently", but is slower than the fixed-view task. No constants obtained. | Looser, Cockburn and Savage 2005 (abstract via snippet) | Med for the qualitative claim, no numbers |
| FPS mouse device study | Mouse best, controller close; motion-tracking devices much worse. No numbers obtained. | Zaranek et al. 2014 (CHI), snippet | Low-Med |
| Sensitivity study | n = 13 analysed. Stationary spheres 0.57°–9.15° at 103° FOV, distances 7–25°, ID 0.83–5.50 bits, 8 sessions of 500 trials per participant (first half of each discarded). Sensitivities 5–160 cm/360. Optimum "a 4x range from 0.45–1.8 deg/mm or 20–80 cm/360"; completion time did not differ significantly across that range; only 5 cm/360 had a significantly lower hit rate. Most participants stayed above **85% hit rate** in nearly all conditions. No Fitts a, b reported (authors call Fitts in FPS a hypothesis). | Boudaoud, Spjut and Kim (NVIDIA), arXiv 2203.12050, IEEE ToG 2023. https://ar5iv.labs.arxiv.org/html/2203.12050 | High |
| Aim-trainer pros | n = 32 pro and semi-pro players. Gridshot targets 1.3–1.7°, Sixshot about 14% of that. Fitts's law fits each task alone but poorly when tasks are combined. Per-task times are in figures only. | Donovan et al. 2022, Front. Hum. Neurosci. 16:979293. https://www.frontiersin.org/journals/human-neuroscience/articles/10.3389/fnhum.2022.979293/full | High |
| Population scale | 7,174 players, 682,564 repeats of a 60 s Aim Lab task; metric is hits per second. | Listman et al. 2021 (snippet) | Low-Med |
| Reliability | Strafe-tracking accuracy about 49–50% (SD about 8) in KovaaK; Gridshot hits/s ICC 0.88–0.96; scores reliable across sessions 3–5 days apart (n = 10). | Rogers et al. 2024, Front. Sports Act. Living (snippet) | Low |

### 2.2 Angular sizes (DERIVED)

Head: 0.28 m tall (spec §5.1 and design §5.1). Angle = 2·atan(0.14 / d).

| Distance | Head height | At 3.0× (dial 0) | At 0.5× (not used; for scale) |
|---|---|---|---|
| 5 m | 3.21° | 9.6° | 1.6° |
| 10 m | 1.60° | 4.8° | 0.80° |
| 20 m | 0.80° | 2.4° | 0.40° |
| 35 m | 0.46° | 1.4° | 0.23° |
| 50 m | 0.32° | 0.96° | 0.16° |

The only hit-rate evidence is the NVIDIA study: more than 85% hits on stationary spheres of 0.57° and above, 7–25° away, at 20–80 cm/360. A 1.0× head is **below** that floor beyond 28 m and the sphere is "head-sized" in Orbit, where the shell is 8–25 m (2.0°–0.64°), which is inside the tested range. Anything past about 28 m (0.57°) is out of the evidence, and 50 m (0.32°) is also beyond the spec's own first-shot cone (0.25° half-angle, spec §5.1).

### 2.3 A usable flick-time model (ESTIMATE; replace with measured data)

`flick time = ID / TP`, `ID = log2(angle / width + 1)`, with throughput TP chosen per dial: **TP 4.5 bits/s at dial 0** (the ISO mouse figure, which is a floor for a gamer) rising to **TP 7 bits/s at dial 100** (ESTIMATE: no source gives gamer FPS throughput; set from the idea that skilled aimers beat desktop pointing). Add 0.25 s for the visual reaction (section 1) to get the minimum time that a player *at that dial* needs to land a shot at about 50% success. The target success rate is 70%, so the authored exposure should be about 1.3× this.

Orbit, using the design's current end-points at 15 m (the shell's centre; head 1.07°):

| Dial | Width | Angle (mean) | ID | Flick time | + RT 0.25 s | Exposure (design, §9.4) |
|---|---|---|---|---|---|---|
| 0 | 3.2° (3.0×) | 30° | 3.38 | 0.75 s | **1.0 s** | 3.0 s |
| 100 | 1.07° (1.0×) | 135° (90–180°) | 7.0 | 1.0 s | **1.25 s** | **0.45 s** |

The design's dial-100 exposure of 0.45 s is shorter than the time that is needed even by the dial-100 player, by a factor of about 2.8. See row 6 of section 4.

### 2.4 Sensitivity

The optimum range (20–80 cm/360) brackets the architecture's example of 40.8 cm/360 (0.4 at 800 DPI). Because Flickline matches the reference game's scale, any change to sensitivity is a muscle-memory cost rather than an aim-quality gain. Keep the 20–80 cm/360 range as the one the onboarding copy calls "typical" and do not suggest that more than 80 cm/360 (or less than 10) is a good value. A 180° flick at 40 cm/360 is a 20 cm sweep, which is arm movement rather than wrist, so the throughput assumption above is optimistic for large angles. This is one more reason to cap the dial-100 angle (row 3).

## 3. Tracking and strafe timing

| Quantity | Value | Source | Confidence |
|---|---|---|---|
| Pursuit gain at moderate speed | Close to 1 for constant-velocity ramps; roughly linear up to about 75°/s with gain about 0.9 for some motion patterns; strongly nonlinear for others. | Buizza and Schmid 1986, Exp. Brain Res. (abstract only) | Low-Med |
| Catch-up saccades | More frequent when gain is low or after unexpected target change. A rule of thumb says targets faster than about 30°/s need them. | Patent and review snippets; primary (Meyer et al. 1985) not readable | Low |
| Reversal response | Pursuit speed starts to drop about 90 ms after an abrupt reversal and re-acquires the new direction about 130 ms later. With periodic motion the eye reverses ahead of the target after 1–2 cycles. | Snippets (PMC 5332859, 6665182) | Low-Med |
| Manual tracking delay | A plausible minimum visuo-manual feedback delay is about 100 ms; predictable sinusoidal targets show near-zero latency, pseudorandom targets gain a prediction advantage only after 300 ms. | Tyson et al. 2021, Exp. Brain Res. (snippet) | Med-Low |
| Time on target vs angular speed | **Not found.** No public dataset. | n/a | Gap |

Angular speed of a perpendicular strafer (spec §5.3: ω = v/d), DERIVED:

| Speed | 10 m | 20 m | 35 m |
|---|---|---|---|
| 2.0 m/s (dial 0) | 11.5°/s | 5.7°/s | 3.3°/s |
| 3.5 m/s | 20°/s | 10°/s | 5.7°/s |
| 5.4 m/s (dial 100) | 31°/s | 15.5°/s | 8.8°/s |

All values sit within the range where smooth pursuit stays high gain (up to about 75°/s), so eye speed is not the limit; the limit is the 100–200 ms the *hand* needs to follow a reversal and the 0.16 s counter-strafe decel. **Predictability, not raw speed, is the strongest lever**: a periodic strafe is learned in 1–2 cycles, a randomised one is not. The design randomises (§4.3), which is the correct direction. At 5.4 m/s and 10 m the target is above the rough 30°/s catch-up mark; that is the correct, game-true extreme and is not a defect.

### 3.1 Counter-strafe stop latency (what is human and what is simulated)

- The 0.160 s full stop and about 0.10 s to the 27.5% accuracy gate are properties of the **game's braking**, from Riot's own 2020 test (spec §2.3, `[DEVTRACK]`). They are not human numbers.
- The design's "Stop latency" stat (§3: last movement key release → speed below the accuracy threshold) is therefore **a constant of the simulation** (about 0.10 s) for any player who releases the key. It cannot show improvement. The human part is the *input*: did you counter-tap or release, and *did you shoot before the gate*. Proposal P2: keep "stop latency" only for the counter-tap-vs-release comparison, and add the human-measurable stats **shot-after-gate delay** (gate reached → first shot; a too-late shot is a wasted window, a too-early shot is a moving shot) and **moving-shot rate**.
- Real-player data: one CS2 stats site tracks "proper counter-strafing" and shows strong players in the mid-to-high 80% range, one profile at 53% (Leetify recaps, snippets, Low). No match-level link to win rate was found.

## 4. Proposed dial end-points (design §9.4)

Format: current design value → proposal, then the reasoning. "OK" means the design value is supported or at least not contradicted. Flags are marked **FLAG**. Dial 0 is the easiest, dial 100 the hardest.

| # | Axis | Design dial 0 / 100 | Proposed dial 0 / 100 | Verdict and reasoning |
|---|---|---|---|---|
| 1 | Beacon scale (× real head) | 3.0 / 1.0 | **3.0 / 1.0** | OK. At the shell's 8–25 m a 1.0× head is 0.64°–2.0°, inside the NVIDIA tested range (≥ 0.57°, more than 85% hits at the right sensitivity), so a dial-100 player is expected to land most shots at the angles of section 2.3 given enough time. The bottom of the range is the real head, which keeps mechanical truth. |
| 2 | Distance | 5 m / 50 m (geometric) | **5 m / 35 m** for first-bullet and Stop & Pop; 50 m only as a fixed-distance option | **FLAG.** 50 m is a 0.32° head, beyond the evidence (0.57° floor) and beyond the spec's own 0.25° first-shot half-angle (spec §5.1), so there success is partly luck and the dial would measure the spread cone, not the player. Spec §5.2 also puts 95% of presented targets within 30 m. 35 m (0.46°) is still hard and still inside what a first-shot cone allows. |
| 3 | Flick angle range | 20–40° / 90–180° | **20–40° / 60–120°**, with 120–180° available only above dial 85 and no more than 15% of trials | **FLAG.** The only angular evidence (NVIDIA) covers 7–25°. Beyond about ±51° (half of the 103° horizontal FOV) a target is off-screen, so in the reference game it is found by sound or information, not by sight. Behind-the-back flicks have low transfer value, are not covered by any data and cost arm-sweep throughput (section 2.4). Keep them as a rare extreme, not the whole dial-100 distribution. |
| 4 | Strafe speed | 2.0 / 5.4 m/s | **2.0 / 5.4 m/s** | OK. Matches spec §5.3 and is above the pursuit limit only at close range (section 3). |
| 5 | Strafe leg interval / stand-still window | 1.0 s, 0.4 s / 0.3 s, 0.2 s | **1.0 s, 0.4 s / 0.35 s, 0.25 s** | **FLAG** (stand-still). The window starts after a 0.16 s decel; the player must see the stop and release a shot. A 0.20 s window is shorter than the 0.218 s mean simple RT, so the only way to hit inside it is to anticipate; with the design's randomised legs that is a guess rather than skill. 0.25 s is at the mean RT, so about half the players can use it by reacting, and the rest anticipate. 0.35 s for the leg is a bound from the 0.13 s reversal re-acquisition plus 0.1 s manual delay (section 3). |
| 6 | Exposure | 3.0 s (geometric) / 0.45 s, all timed targets; Peeker wide peek 1.4 s / 0.3 s | **Per mode, derived from the target's difficulty** (table below); a single global floor of 0.45 s for pre-aimed targets only | **FLAG.** A single curve is wrong because exposure has to cover RT plus aiming movement, which depends on angle and size. See the table below. A 0.3 s wide peek is shorter than a pre-aimed player's time to shot (about 0.25–0.35 s), so it only rewards guessing. |
| 7 | Enemy reaction / tell | 1.2 s, 0.5 s / 0.3 s, 0.18 s | **1.2 s, 0.7 s / 0.3 s, 0.30 s** | **FLAG** (tell). 0.18 s is below the 0.218 s mean simple RT (SD 39 ms). A tell below about 0.25 s cannot be reacted to by most players, and the design's own floor of 0.15 s is unreactable. The reaction field (0.3 s) is fine. See section 5. |
| 8 | Enemy hit chance at standstill | 0.15 / 0.6 | **0.15 / 0.6 (keep)** | No human-factors evidence exists for it; it is a game-balance number for #53. Check at balance time that the expected damage per contact is survivable given kill-heal (design §4.8). |
| 9 | Density | 1 / 6 (step) | **1 / 6 (keep)**, but enforce a per-wave exposure of at least 0.55 s per target at dial 100 | OK in principle. Switchboard's par (1.3 s down to 0.55 s per enemy, §4.6) is faster than the model predicts for a 30° switch onto a 1.1° target at dial 100: ID = log2(30/1.1 + 1) = 4.8, 0.69 s at TP 7. Proposed dial-100 par **0.70 s** per enemy. |

### 4.1 Exposure by mode (row 6)

Minimum feasible time = 0.25 s + ID / TP (TP rising from 4.5 to 7). Recommended exposure = about 1.3× that, rounded.

| Mode | Dial 0 (min feasible → recommended) | Dial 100 (min feasible → recommended) | Notes |
|---|---|---|---|
| Orbit | 1.0 s → **2.5 s** | 1.25 s → **1.6 s** | Difficulty rides on size and angle; exposure barely moves. |
| Cold Start (5–25°, mean 15°) | 0.85 s → **2.5 s** | at 1.07° head: ID = 3.9, 0.56 + 0.25 = 0.81 s → **1.05 s** | 0.45 s is not feasible at any angle above a few degrees. |
| Stop & Pop | 0.9 s → **2.0 s** | 0.25 (RT) + 0.10 (gate) + 0.20 (small aim) = 0.55 s → **0.7 s** | The design's 0.5 s (§4.4) is under the 0.55 s minimum. |
| Peeker wide peek (pre-aimed) | 1.4 s | **0.45 s** | Pre-aimed minimum is about 0.30 s; 0.45 s keeps it reactable and matches the proposed global floor. |
| Peeker shoulder, jiggle or hop (0.3–0.35 s) | n/a | n/a | These are **bait, not trials**: they should not count as a failure if you do not shoot them, otherwise the dial penalises players for a correctly patient playstyle. Proposal P3. |
| Gnat | 1.5 s | 0.6 s | A hand-sized target at head height with 3D motion; mostly a tracking test, so pre-aim is possible. |

## 5. Fairness floors (design §9.3 item 5)

| Floor | Design | Verdict | Proposed |
|---|---|---|---|
| Tell | ≥ 0.15 s | **Wrong.** Below mean simple RT (218 ms, SD 39 ms trial-to-trial, Woods 2015) and far below the 273 ms median a consumer setup actually gets. | **≥ 0.25 s hard floor, 0.30 s at dial 100.** Rationale beyond RT: the useful defensive response is to strafe, because enemy hit chance halves above the deadzone (design §5.3 item 2). Above the deadzone takes about 0.055 s of acceleration from rest (DERIVED: 1.485 m/s deadzone at 5.4 m/s ÷ 0.20 s ramp = 27 m/s², so 1.485 ÷ 27 = 0.055 s, spec §2.3 and §2.4). An average player needs about 0.236 s to start the response (0.218 + 0.018 hardware), so a tell of 0.30 s is the first at which the typical player's strafe takes effect before the shot. |
| Exposure | ≥ 0.3 s | **Wrong for flicks.** | **≥ 0.45 s for pre-aimed targets; for anything that needs the crosshair to move, ≥ 0.25 s + ID/TP** (table 4.1). Exposure is measured from `targetVisible`, never from spawn, so an off-screen spawn does not eat the clock. |
| Enemy reaction | ≥ 0.25 s | OK. About one mean simple RT; the player is not being outreacted by a machine. | Keep 0.25 s as the hard floor; dial range 1.2 s → 0.3 s. |
| Target size | Never below the real head | OK, and consistent with the 0.57° hit-rate evidence only out to about 28 m. | Keep; pair it with row 2's 35 m cap. |
| Spawn | Nothing spawns within 90° of the view **and** closer than 3 m | The sentence reads as a pair of conditions that is ambiguous and weaker than intended. A target appearing behind the player at 2 m is just as unreactable. | **Nothing becomes visible (or armed) closer than 4 m in any mode where enemies shoot, and nothing spawns inside the horizontal view cone (±51.5° at 16:9) closer than 5 m.** |

Additional proposal P4: "pre-aimed" and "must-flick" trials have different feasible times, so the dial's success model (§9.1) should carry the trial type as an item property so that a pre-aimed 0.45 s trial is not compared with a 135° flick.

## 6. Transfer value of the seven skills

### 6.1 Evidence

I found no study that measures how much each skill contributes to duels in the reference game. The evidence is Riot's own mechanics posts and tests (strong on *what the game rewards*), coaching commentary and vendor content (weak), and per-player statistics sites (no link to win rate). Read the ranking as informed judgement.

- **Footwork.** Riot: peeker's advantage is "the amount of time that a player sees you, without you seeing them" and is "never going away"; counter-strafing is prevalent and "the typical muscle memory is to shoot in the frames after a counter-strafe" (Riot, *On Peeker's Advantage*, 2020-05-13, https://playvalorant.com/en-us/news/game-updates/04-on-peeker-s-advantage-ranked; High). The mechanical penalty is large (spec §3.4; CS2 data files show roughly 27× inaccuracy moving vs standing, csdb.gg snippet, Low). Coaching sources rank it second only to crosshair placement (snippet, Low).
- **Angles (crosshair placement, pre-aim).** Placement is ranked first in coaching roundups; it reduces the flick distance of every other skill (Low). Peeking from far back to reduce the enemy's reaction window is CS2 pro advice (Dignitas 2026, Low-Med). Strong CS2 players' placement angle is about 8–9° in per-player recaps (Leetify, Low).
- **Precision (first-bullet head).** "In any fight from a long distance, tapping increases your chance of winning greatly" (Dignitas / KomadKO 2021, Low); Leetify-based analysis treats time-to-damage and enemy-spotted headshot accuracy as the primary pro aim metrics (Nomiun 2024, Low-Med). The one-tap rifle damage thresholds make a first-bullet head a one-hit kill (spec §3.2, §6).
- **Flick.** Needed whenever placement fails; coaching puts raw flicking below placement and warns that large-target flick drills (Gridshot) transfer poorly (Aim Lab and coaching roundups, Low). Aim Lab data shows measurable gains in flick tasks with practice (Rogers 2024, Low).
- **Spray.** Matters at close range and against several enemies; the reference game steers towards taps and bursts (Dignitas 2021, Low). Only one CS2 pro exceeds 50% spray accuracy (Nomiun 2024, Low-Med).
- **Switch.** Almost no independent evidence; needed in trades and clutches (Low).
- **Track.** Secondary in a stop-to-shoot game; matters in strafe duels (vendor pages, Low). Pro AWPers strafe on holds to be hard to track, which is a case for making yourself untrackable, not for tracking skill (Dignitas 2026, Low).

### 6.2 Ranking by transfer value

| Rank | Skill | Why | Uncertainty |
|---|---|---|---|
| 1 | `footwork` | The only skill Riot's own posts and test data show as shaping duel outcomes; large mechanical penalty for violating it (spec §8 ranks stop-to-shoot #2 behind only sensitivity and FOV). | Medium: no kills-while-moving statistics. |
| 2 | `angles` | Reduces the demand on every other skill; consensus first in coaching. | High: the supporting numbers are unsourced or sponsored, and part of the real skill is map knowledge a drill cannot teach. |
| 3 | `precision` | The one-tap head kill is the reference game's signature duel. | Medium: no one-tap kill-share data. |
| 4 | `flick` | Needed whenever placement fails; has measurable practice gains. | Medium. |
| 5 | `spray` | Close range and multi-enemy; deprioritised by the reference game's tap/burst design. | Medium-high. |
| 6 | `switch` | Real but thinly evidenced. | High: could rank higher. |
| 7 | `track` | Least central in a stop-to-shoot game. | Medium. |

Ranks 4–7 are close and should not be treated as reliable in order. The top three are the part of the ranking I would defend.

### 6.3 Recommended default order for "Today's session"

A session is short (about 8–12 minutes) and goes easy to hard, with the highest-value skills early so they get the freshest hands. No source tests a specific warm-up duration for aiming (the one duration-related study I found was a 33-player shooting warm-up showing a benefit with unclear length, snippet only, Low), so this is reasoned, not established.

1. **Cold Start** (`precision`): easiest, settles the hand, a clear first success.
2. **Orbit** (`flick`): larger movements on a warm hand.
3. **Stop & Pop** (`footwork`): the highest-value skill, placed once the hand is warm and before fatigue.
4. **Corner Clear** (`angles`): decision plus pre-aim; needs warm mechanics.
5. **Switchboard** (`switch`): chains flicks, so flicks must be warm.
6. **Spray Wall** (`spray`): fatiguing, least value per minute.
7. **Strafe Track** (`track`): sustained control; first to drop when time is short.

**Recommendation:** use this order for a player's first sessions, because the Placement run supplies only a rough profile. Once there is a profile, move the player's *weakest* skill by transfer-weighted deficit to slot 2 (after Cold Start's warm-up), and drop the slots for skills with a confidence band narrower than ±4 dial points and a rating above their tier floor, so the session shortens as the player improves. Sweep (the flagship) is not in the list: offer it after, or as an alternative, never as a warm-up. In the first playable only Cold Start, Orbit and the Placement run exist, so the order collapses to Placement, then Cold Start, then Orbit.

### 6.4 Target success rate (design §9.3 item 1)

The design aims for 70% success (with 55% for first-bullet head drills). The "85% rule" (Wilson, Shenhav, Straccia and Cohen, Nat. Commun. 2019, about 85% accuracy optimal for learning) is often quoted for this, but it was derived for gradient-descent learners and a perceptual-learning model on binary tasks and **has not been shown for motor aiming**; abstract and press release only (Med). Keep 70% (it is also the 2-up/1-down staircase's natural convergence point, 70.7%), keep it a data value, and let the balance pass test 70 vs 80% for retention. No change proposed.

## 7. What is not well supported

- Kill-level data for the reference game: none found, so no ranking by "share of kills".
- Aim-trainer-to-game transfer: essentially untested in public research. The published studies are reliability (Rogers 2024) and kinematics (Donovan 2022, authors from the trainer's maker); transfer claims come from vendors and a retailer blog.
- Warm-up duration, the 85% rule for aiming, an "about 50 ms counter-strafe advantage" and a "70% of mid-ranked players" figure all have no supporting source and are not used.

## 8. Open questions and default answers

| # | Question | Default |
|---|---|---|
| 1 | Is the TP of 4.5 → 7 bits/s right for the dial's flick model? | Use it as stated (ESTIMATE); fit the real value per skill from the bot harness (#28) and the first human runs, then revise exposure (table 4.1). |
| 2 | Should the success target be 70% or higher for learning? | 70% (55% for Cold Start), unchanged; test 80% at balance (#53). |
| 3 | Should shoulder, jiggle and hop peeks be scored at all? | No; treat them as bait and never as failed trials (P3). |
| 4 | Is a behind-the-back target a core mechanic or a rare extreme? | A rare extreme, only at dial > 85 and at most 15% of Orbit trials. |
| 5 | Should RT be shown to the player? | Show **time to shot** (the visible → shot figure), never "reaction time"; give the expected ranges of section 1.2 as context only. |
| 6 | Does the player's own latency matter? | Show it in the debug overlay (frame time, input-to-photon is not measurable in a browser). Do not adjust fairness floors per player; they already include the hardware figure from Woods 2015 (18 ms). |
| 7 | Is 128-tick quantisation a fairness problem? | No: 1/128 s is 7.8 ms, below any perceptual threshold in section 1 (Riot's playtest detectors were around 10 ms). |
| 8 | How do we get human data rather than literature? | Add anonymised, local-only run statistics (RT-to-shot, flick time, angle, size) to the results export and use the first-release playtest runs (#56) and balance (#53) to fit TP and the reversal limit. |
| 9 | Are 0.57° and 28 m a real limit or a limit of the tested range? | A limit of the tested range; treat as "unproven below this", not "impossible". |

## 9. Proposals and where they go

These are for the owners of the named work. None is applied to `docs/design.md` by this PR.

| Id | Proposal | Applies to |
|---|---|---|
| P1 | Rename the RT stat "time to shot"; keep the definition. | §3, results UI (#39), event log (#13) |
| P2 | Replace "stop latency" as a skill signal with shot-after-gate delay and moving-shot rate; keep stop latency only for the counter-tap vs release comparison. | §3, Stop & Pop (#47), results (#39) |
| P3 | Shoulder / jiggle / hop peeks are bait, not trials. | §4.7, Corner Clear (#50), skill model (#17) |
| P4 | Give the success model a trial-type property (pre-aimed vs must-flick). | §9.1, #17 |
| P5 | Dial end-points: distance 5 → 35 m; flick angle 20–40° → 60–120° (120–180° rare); stand-still 0.4 → 0.25 s; leg 0.3 → 0.35 s; tell 0.5 → 0.30 s at dial 100; exposure per mode (table 4.1); Switchboard par 0.70 s at dial 100. | §9.4, §4.3, §4.4, §4.6, mode framework (#22), enemies (#32), balance (#53) |
| P6 | Fairness floors: tell ≥ 0.25 s, exposure floor per mode, spawn rule rewritten (no visible target closer than 4 m where enemies shoot; none in the view cone closer than 5 m). | §9.3, §5.3 |

## 10. Source key

Fetch date 2026-11-14. Pages marked "snippet" were seen only in search-result text; "abstract" means the abstract page was read but not the full text.

| Source | URL |
|---|---|
| Woods et al. 2015 (simple RT) | https://pmc.ncbi.nlm.nih.gov/articles/PMC4374455/ |
| Woods et al. 2015 (choice RT) | https://pmc.ncbi.nlm.nih.gov/articles/PMC4407573/ |
| Riot, netcode and peeker's advantage | https://www.riotgames.com/en/news/peeking-valorants-netcode ; https://playvalorant.com/en-us/news/game-updates/04-on-peeker-s-advantage-ranked |
| Sheffield press page on the CS expertise study | https://sheffield.ac.uk/news/are-counter-strike-players-better-decision-making-study-reveals-faster-brain-processing-expert |
| Toth, Kowal and Campbell 2019 | https://pmc.ncbi.nlm.nih.gov/articles/PMC6932966 |
| BioNumbers (Galton) | https://bionumbers.hms.harvard.edu/bionumber.aspx?id=110800 |
| MacKenzie, HHCI chapter | https://www.yorku.ca/mack/hhci2018.html |
| Soukoreff and MacKenzie 2004 | https://www.yorku.ca/mack/ijhcs2004.html |
| Looser, Cockburn and Savage 2005 | https://csse.canterbury.ac.nz/andrew.cockburn/papers/fitts-game.pdf (snippet) |
| Zaranek et al. 2014 | https://www.csit.carleton.ca/~rteather/pdfs/Game_devices.pdf (snippet) |
| Boudaoud, Spjut and Kim, NVIDIA | https://ar5iv.labs.arxiv.org/html/2203.12050 |
| Donovan et al. 2022 | https://www.frontiersin.org/journals/human-neuroscience/articles/10.3389/fnhum.2022.979293/full |
| Rogers et al. 2024 | https://pmc.ncbi.nlm.nih.gov/articles/PMC10925653 (snippet) |
| Buizza and Schmid 1986 | https://link.springer.com/doi/10.1007/BF00236858 (abstract) |
| Tyson et al. 2021 | https://link.springer.com/article/10.1007/s00221-020-05962-0 (snippet) |
| Wilson et al. 2019 (press release) | https://news.arizona.edu/news/learning-optimized-when-we-fail-15-time |
| Dignitas, tapping vs spraying | https://dignitas.gg/articles/a-guide-to-gunplay-in-valorant-spraying-vs-tapping |
| Dignitas, CS2 micro-movements | https://dignitas.gg/articles/cs2-the-micro-movements-that-pros-abuses |
| Nomiun, CS pro aim (Leetify data) | https://nomiun.substack.com/p/which-cs-pros-have-the-best-aim |
| Aim Lab, duel article | https://aimlabs.com/articles/aimlabs/why-youre-still-losing-valorant-aim-duels-you-should-be-winning/ (marketing) |
| Mechanics spec | `docs/mechanics-spec.md` (#7) |
