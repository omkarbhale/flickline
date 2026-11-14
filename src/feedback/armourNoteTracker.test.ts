import { describe, expect, it } from 'vitest';
import { cloneTunables } from '../config/tunables';
import { ArmourNoteTracker } from './armourNoteTracker';

const t = cloneTunables();

function tracker(weapon: 'pace' | 'kestrel' | 'rill'): ArmourNoteTracker {
  const w = t.weapon[weapon];
  return new ArmourNoteTracker({
    weapon: () => ({ name: w.name, bands: w.damageBands }),
    maxHp: t.player.health.max,
    absorb: t.player.shield.absorb,
    fullShield: t.player.shield.heavy,
  });
}

describe('armour and eco notes of a run (#207)', () => {
  it('names the kill where the shield cost the most bullets (Pace headshot: two on an armoured target, one on an unarmoured one)', () => {
    const n = tracker('pace');
    n.killed('head', 8, t.player.shield.heavy);
    expect(n.notes()).toEqual(['Your Pace needed two headshots on an armoured target (one kills an unarmoured one).']);
  });

  it('says nothing when the shield made no difference to the count', () => {
    const n = tracker('kestrel');
    // A Kestrel headshot kills a heavy-shielded Echo within 20 m and a bare one alike.
    n.killed('head', 8, t.player.shield.heavy);
    expect(n.notes()).toEqual([]);
  });

  it('keeps the biggest difference, not the last kill', () => {
    const n = tracker('kestrel');
    n.killed('body', 8, t.player.shield.heavy); // four body bullets on armour, three bare: one more
    const first = n.notes();
    expect(first).toHaveLength(1);
    n.killed('head', 8, t.player.shield.heavy); // no difference: the note stays
    expect(n.notes()).toEqual(first);
  });

  it('an eco sector kill names what having no shield saved; outside eco a bare kill says nothing', () => {
    const n = tracker('pace');
    n.killed('head', 8, 0);
    expect(n.notes()).toEqual([]);
    n.sectorEntered('eco');
    n.killed('head', 8, 0);
    expect(n.notes()).toEqual(['Eco sector, no shields: your Pace needed one headshot here (two on a shielded target).']);
    n.sectorEntered('full');
    n.reset();
    expect(n.notes()).toEqual([]);
  });
});
