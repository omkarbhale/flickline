import { describe, expect, it } from 'vitest';
import { player } from '../config/player';
import { results as cfg } from '../config/results';
import { HeadlessGame } from '../debug/bot/headless';
import { playMode } from '../debug/bot/play';
import { buildCard } from './results';
import { RunStoryTracker, storyConfigFrom } from './runStory';

/**
 * The card against the real run director (#201): three seeded Sweep runs played by the bot at different skills, with
 * the story folded from the live bus and compared with the stat tracker's own counts (design §14.3: the card renders
 * from the event log, nothing is recomputed in the UI).
 */
describe('the results card matches real Sweep runs', () => {
  for (const [skill, seed] of [[30, 3], [50, 4], [70, 5]] as const) {
    it(`skill ${skill}, seed ${seed}`, () => {
      const g = new HeadlessGame({ seed });
      const tracker = new RunStoryTracker(storyConfigFrom(player, cfg.run.routeSectors, cfg.run.maxSectors));
      g.bus.onAny((type, payload) => {
        if (RunStoryTracker.reads(type)) tracker.ingest(type, payload as never);
      });
      const report = playMode(g, { mode: 'sweep', skill, seed, pinDial: 50 });
      expect(report.finished).toBe(true);
      const stats = g.run.liveStats();
      const story = tracker.snapshot();

      expect(stats.kills).toBeGreaterThan(0); // real fights happened
      expect(story.situations.length).toBeGreaterThan(0);
      expect(story.sectors).toHaveLength(stats.sectorsReached);
      expect(story.total).toBe(stats.sectorsTotal);
      expect(story.sectors.filter((t) => t.cleared)).toHaveLength(stats.sectorsCleared);
      expect(story.won).toBe(stats.contactsWon);
      expect(story.lost).toBe(stats.contactsLost);
      expect(story.sectors.reduce((n, t) => n + t.won, 0)).toBe(stats.contactsWon);
      expect(story.sectors.reduce((n, t) => n + t.lost, 0)).toBe(stats.contactsLost);
      expect(story.sectors.reduce((n, t) => n + t.kills, 0)).toBe(stats.kills);
      // A tile's health never exceeds the run's maximum and a death leaves the last tile at 0.
      for (const t of story.sectors) expect(t.hpIn).toBeLessThanOrEqual(player.health.max);
      if (stats.endReason === 'death') expect(story.sectors[story.sectors.length - 1]!.hpOut).toBe(0);

      const card = buildCard({ stats, split: null, score: report.modeRun?.score ?? 0, rating: null, pb: null, medals: [], story });
      expect(card.route).toHaveLength(stats.sectorsReached);
      expect(card.route.reduce((n, t) => n + t.won, 0)).toBe(stats.contactsWon);
      expect(card.situations.reduce((n, r) => n + r.played, 0)).toBeGreaterThanOrEqual(stats.contactsWon + stats.contactsLost);
      expect(card.depth).not.toBe('');
    });
  }
});
