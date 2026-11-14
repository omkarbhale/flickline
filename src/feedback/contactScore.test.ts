import { describe, expect, it } from 'vitest';
import { cloneTunables } from '../config/tunables';
import { contactOutcome, createContactSettle, healthKept, settleContact, type ContactFacts } from './contactScore';

const cfg = cloneTunables().scoring;
const facts = (f: Partial<ContactFacts>): ContactFacts => ({
  kinds: ['peeker', 'rusher'], dial: 50, startEhp: 150, damageTaken: 0, allDead: true, died: false, ...f,
});
const settle = (f: Partial<ContactFacts>) => settleContact(createContactSettle(), facts(f), cfg);

describe('contact settle (design §8.1, #132)', () => {
  it('classifies outcomes: cleared, disengaged only when losing, avoided when unhurt, died', () => {
    expect(contactOutcome(facts({}), cfg)).toBe('cleared');
    expect(contactOutcome(facts({ allDead: false, damageTaken: 60 }), cfg)).toBe('disengaged');
    expect(contactOutcome(facts({ allDead: false, damageTaken: 30 }), cfg)).toBe('avoided'); // 20% < 30%
    expect(contactOutcome(facts({ allDead: false }), cfg)).toBe('avoided');
    expect(contactOutcome(facts({ allDead: false, died: true, damageTaken: 150 }), cfg)).toBe('died');
    expect(contactOutcome(facts({ allDead: true, died: true, damageTaken: 150 }), cfg)).toBe('died'); // a trade is not a clear
  });

  it('one kill\'s worth is the mean base of the contact × difficulty', () => {
    const s = settle({ dial: 75 }); // ×2
    expect(s.value).toBeCloseTo(((200 + 150) / 2) * 2, 9);
  });

  it('a clean clear pays `clear` kills\' worth; damage scales it by the health kept', () => {
    const clean = settle({});
    expect(clean.kept).toBe(1);
    expect(clean.total).toBe(Math.round(175 * cfg.contact.clear));
    const hurt = settle({ damageTaken: 75 });
    expect(hurt.kept).toBeCloseTo(0.5, 12);
    expect(hurt.total).toBe(Math.round(175 * cfg.contact.clear * 0.5));
  });

  it('kill-heal does not hide damage: kept comes from damage taken, clamped to 0–1', () => {
    expect(healthKept(150, 0)).toBe(1);
    expect(healthKept(150, 300)).toBe(0);
    expect(healthKept(0, 0)).toBe(0);
  });

  it('a clear always pays more than a disengage at the same health', () => {
    expect(cfg.contact.clear).toBeGreaterThan(cfg.contact.disengage);
    for (const dmg of [45, 60, 90, 120, 140]) {
      expect(settle({ damageTaken: dmg }).total).toBeGreaterThan(settle({ damageTaken: dmg, allDead: false }).total);
    }
  });

  it('never negative; dying and leaving unhurt pay nothing', () => {
    expect(settle({ died: true, damageTaken: 150, allDead: false }).total).toBe(0);
    expect(settle({ allDead: false }).total).toBe(0);
    expect(settle({ kinds: [] }).total).toBe(0);
    for (const dmg of [0, 50, 100, 150, 500]) expect(settle({ damageTaken: dmg }).total).toBeGreaterThanOrEqual(0);
  });
});
