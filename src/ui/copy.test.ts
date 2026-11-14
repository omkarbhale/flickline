import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { hints } from '../config/hints';
import { menu } from '../config/menu';

/** Vision principle 10: Flickline is a game you replay, not drills. The words below must not describe it. */
const BANNED = /\b(trainer|training|drills?|exercises?)\b/i;
/** The retired drills by the names the old cards used. */
const DRILL_NAMES = /\b(cold start|orbit|strafe track|stop (?:&|and) pop|spray wall|switchboard|corner clear|vigil|placement|today.s session)\b/i;

const read = (rel: string): string => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

describe('copy that describes the game (vision principle 10)', () => {
  it('the first panel and main menu tagline, the lobby note and the hints name no trainer or drill', () => {
    for (const text of [menu.tagline, menu.lobbyNote, ...Object.values(hints.text), hints.discardText]) {
      expect(text).not.toMatch(BANNED);
      expect(text).not.toMatch(DRILL_NAMES);
    }
  });
  it('the page description names no trainer or drill', () => {
    const m = /<meta name="description" content="([^"]*)"/.exec(read('index.html'));
    expect(m).not.toBeNull();
    expect(m![1]).not.toMatch(BANNED);
  });
  it('the menu, the settings panel and the results card carry no drill wording or drill names', () => {
    for (const file of ['src/ui/menu.ts', 'src/ui/settingsPanel.ts', 'src/ui/resultsCard.ts']) {
      const text = read(file);
      expect(text, file).not.toMatch(BANNED);
      expect(text, file).not.toMatch(DRILL_NAMES);
    }
  });
});
