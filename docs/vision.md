# Flickline vision

What Flickline is for. Check every design decision, issue and pull request against this page. It changes only when the project owner's goals change. The *Currently* line under each principle names how the design pursues it today; those lines can change freely.

## What Flickline is

A free, single-player first-person shooter in the browser whose gunplay and movement deliberately match a modern tactical shooter, Valorant ("the reference game" in the rest of the repo). It drops that game's slow pace, two sides and spike for fast, instantly rewarding fights against enemies that behave like real players.

## Who it is for and what it promises

Players of the reference game who want better mechanics: aiming, shooting, moving, winning fights. The one promise: **you get mechanically better at the reference game faster here than by playing it.** Anything that serves neither this nor the fun that keeps people practising needs a strong reason to exist.

## Principles

Transfer comes first because it is the owner's stated reason for Flickline. The rest are not ranked against each other; for conflicts, see *How to use this page*.

### 1. Transfer first

Skill earned here must carry over. Gunplay, movement, walking speed, shooting, taking damage, slowdown on hit and field of view match the reference game. A drill that builds a habit that fails there is a bug, however fun.

*Currently:* every number comes from `docs/mechanics-spec.md`; no aim assist or hitbox inflation (design §1).

### 2. Mechanically fun on its own

Playing must be extremely fun for its mechanics, not a chore endured for the improvement. Practice that never happens transfers nothing.

*Currently:* 60-second drills with near-instant restart, and Sweep, a flagship mode that must play like a game (design §2, §4.8).

### 3. Instant feedback and reward drive improvement

This is how Flickline beats the reference game as practice. Every shot gets an immediate, specific answer and every kill a reward, so the player learns what worked and what to fix while the moment is fresh.

*Currently:* same-frame sight, sound and number for every shot; one thing to fix on each results card; rewards from mechanics only, never time played (design §7, §8); the cues fade with the skill rating so the feedback never becomes a crutch, and one run per session is cue-free (design §7.4).

### 4. Numbers, feel and fun are separate qualities

Do the numbers match? Does it *feel* like the reference game (recoil, gun and kill sounds, hit response)? Is it fun? Each can pass while another fails, so each is tracked and judged on its own, and no verdict stands in for another.

*Currently:* trackers [#61](https://github.com/omkarbhale/flickline/issues/61), [#62](https://github.com/omkarbhale/flickline/issues/62), [#63](https://github.com/omkarbhale/flickline/issues/63); every playtest reports three verdicts (design §14.7).

### 5. Meets every player at their skill

A new player and an expert should both be challenged and both improving. Matching is a design problem that shapes targets, enemies, fights, rewards and feedback, not a difficulty slider bolted on.

*Currently:* a skill model measured in the first minute, a ~70% success target, difficulty that moves only at planned beats, enemy profiles on the same dial (design §9).

### 6. Enemies behave like real players

Reading and beating how real players peek, hold, strafe, stop, aim and trade is a core skill to transfer. Enemies obey the player's rules and fight like people at the player's level, mistakes included. This is its own tracked module.

*Currently:* [#70](https://github.com/omkarbhale/flickline/issues/70); enemies run on the player's movement and weapon code with human timing distributions (`docs/research/player-like-enemies.md`).

### 7. Fights with varied information, never one scenario

What each side knows decides the fight. Do I know where the enemy is? Does the enemy know I am coming, and from where? Is someone forced to move? Fights where both sides know each other's position and intent transfer little, and so does any single scenario on repeat. Flickline varies who knows what on purpose and creates pressure to move without rounds or objectives.

*Currently:* [#74](https://github.com/omkarbhale/flickline/issues/74); fights sampled from scenario cards, both-know-everything duels capped at 5% of Sweep fights, tempo forces movement (`docs/research/engagement-information.md`).

### 8. Polish serves play; feedback is product, not polish

The game should look and feel polished, but polish never comes at the expense of gameplay: not a frame of input latency, not target readability. Feedback that tells the player what just happened, such as hit and kill effects and their sounds, is product design, built and judged with the core, not left for the end.

*Currently:* "feedback is the product" is design pillar 2; per-shot feedback ships in the first playable ([#9](https://github.com/omkarbhale/flickline/issues/9)).

### 9. 144+ frames per second with strong visuals

Flickline runs at 144 frames per second or more and still looks strong, custom shaders included. Early builds may get there in steps, but nothing may rule it out. A visual that cannot hold the frame rate is scaled down or cut.

*Currently:* a 6.94 ms frame budget, procedural art with quality presets, a release performance pass ([#55](https://github.com/omkarbhale/flickline/issues/55); design §14.1).

## What Flickline is not

- **Not the reference game's match:** no rounds, sides, spike or other objective, and none of the slow-paced structure around them.
- **Not a copy:** only mechanics and feel are modelled. Names, weapons, maps, enemies, art, sounds and interface are Flickline's own; nothing is taken from any game's names, characters, abilities, maps, art, audio, logos or interface look (design §16).
- **Not multiplayer:** you play alone against Flickline's enemies.

## How to use this page

- **Name the principle a change serves.** If none, and it does not help the promise, it probably does not belong.
- **Surface conflicts, never trade silently.** Write them on the issue. Polish never costs gameplay; beyond that, mechanical truth wins inside the mechanics and fun wins around them (design §1, §14.7).
- **Judge work by the quality it claims:** numbers by spec conformance, feel by the feel checklist, fun by playtest.
- **Change the design freely, the vision rarely.** Keep the *Currently* lines current. A principle changes only with the owner's goals, recorded on an issue.

## How the project is run

The owner's standing instructions:

- Track everything in GitHub issues and pull requests: design, research, brainstorming, building, playtesting, sound and art.
- High throughput without losing quality; no check or pipeline step may become a bottleneck.
- Look at and listen to sounds, visuals and gameplay, not only test them.
- Decide and carry on: pick the best option, record the decision and reason on the issue, keep going.
