import { describe, expect, it } from 'vitest';
import { menu } from '../config/menu';
import { buildCards, buildSessionView, formatScore, titleFromId, type CardSources, type RegisteredMode } from './menuModel';

const src = (over: Partial<CardSources> = {}): CardSources => ({
  bestScore: () => null,
  matchedDial: () => 51.4,
  tierLabel: () => 'Cobalt II',
  ...over,
});

const modes: RegisteredMode[] = [
  { id: 'orbit', skill: 'flick' },
  { id: 'test', skill: 'precision' },
  { id: 'coldStart', skill: 'precision' },
  { id: 'placement', skill: 'flick' },
  { id: 'sweep', skill: 'line' },
];

describe('mode cards', () => {
  it('lists registered modes only, in the table order, without fixtures', () => {
    expect(buildCards(modes, menu, src()).map((c) => c.id)).toEqual(['coldStart', 'orbit', 'sweep']);
  });

  it('shows the skill, the best score and the matched line', () => {
    const cards = buildCards(modes, menu, src({ bestScore: (id) => (id === 'orbit' ? 12340 : null) }));
    const orbit = cards.find((c) => c.id === 'orbit')!;
    expect(orbit.skillLabel).toBe('Flick');
    expect(orbit.bestText).toBe('12,340');
    expect(orbit.matchedText).toBe('Matched to you: Cobalt II · dial 51');
    const cold = cards.find((c) => c.id === 'coldStart')!;
    expect(cold.best).toBeNull();
    expect(cold.bestText).toBe('—');
  });

  it('Sweep trains the whole profile', () => {
    expect(buildCards(modes, menu, src()).find((c) => c.id === 'sweep')!.skillLabel).toBe('All seven skills');
  });

  it('gives a mode with no copy a derived name and puts it last', () => {
    const cards = buildCards([...modes, { id: 'mirrorMatch', skill: 'track' }, { id: 'aaa', skill: 'track' }], menu, src());
    expect(cards.slice(-2).map((c) => c.name)).toEqual(['Aaa', 'Mirror Match']);
    expect(cards.find((c) => c.id === 'aaa')!.blurb).toBe('');
  });

  it('has no matched line without a dial, and is empty with no modes', () => {
    expect(buildCards(modes, menu, src({ matchedDial: () => null }))[0]!.matchedText).toBe('');
    expect(buildCards([], menu, src())).toEqual([]);
  });

  it('every listed card in the table names a skill label', () => {
    for (const id of Object.keys(menu.modeCards)) expect(menu.modeCards[id]!.name.length).toBeGreaterThan(0);
  });
});

describe('formatting', () => {
  it('groups thousands', () => {
    expect(formatScore(0)).toBe('0');
    expect(formatScore(999)).toBe('999');
    expect(formatScore(1000)).toBe('1,000');
    expect(formatScore(1234567.6)).toBe('1,234,568');
  });
  it('derives a title from an id', () => {
    expect(titleFromId('coldStart')).toBe('Cold Start');
    expect(titleFromId('strafe-track')).toBe('Strafe track');
    expect(titleFromId('')).toBe('');
  });
});

describe('session view', () => {
  const steps = [
    { modeId: 'orbit', role: 'weakest' },
    { modeId: 'coldStart', role: 'flagged' },
    { modeId: 'sweep', role: 'finale' },
  ];
  const nameOf = (id: string): string => id.toUpperCase();
  const reasonOf = (r: string): string => `why ${r}`;

  it('shows the whole plan as upcoming before it starts', () => {
    const v = buildSessionView(steps, 0, false, nameOf, reasonOf);
    expect(v.active).toBe(false);
    expect(v.steps.map((s) => s.state)).toEqual(['next', 'next', 'next']);
    expect(v.progressText).toBe('');
    expect(v.steps[0]).toEqual({ modeId: 'orbit', name: 'ORBIT', reason: 'why weakest', state: 'next' });
  });

  it('marks done, current and next while it runs', () => {
    const v = buildSessionView(steps, 1, true, nameOf, reasonOf);
    expect(v.steps.map((s) => s.state)).toEqual(['done', 'current', 'next']);
    expect(v.progressText).toBe('Run 2 of 3');
  });

  it('copes with an empty plan and with running past the end', () => {
    expect(buildSessionView([], 0, true, nameOf, reasonOf).progressText).toBe('');
    expect(buildSessionView(steps, 3, true, nameOf, reasonOf).progressText).toBe('Run 3 of 3');
  });
});
