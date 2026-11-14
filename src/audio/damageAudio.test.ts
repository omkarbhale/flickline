import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/eventBus';
import { vec3 } from '../core/vec3';
import type { SimEvents } from '../sim/types';
import { attachDamageAudio } from './damageAudio';

const dmg = (): SimEvents['playerDamaged'] => ({
  tick: 1, t: 0, amount: 10, absorbed: 0, hp: 90, maxHp: 100, shield: 0, maxShield: 0, zone: 'body', dir: vec3(0, 0, -1), yaw: 0, sourceId: 1, killed: false, exposedTo: 1,
});

describe('attachDamageAudio', () => {
  it('dips the low-pass once per damaging hit, and only then', () => {
    const bus = new EventBus<Pick<SimEvents, 'playerDamaged' | 'playerHealed'>>();
    let dips = 0;
    const off = attachDamageAudio(bus, { dipLowpass: () => { dips++; } });
    bus.emit('playerHealed', { tick: 1, t: 0, amount: 5, hp: 95, maxHp: 100, source: 'kill' });
    expect(dips).toBe(0);
    bus.emit('playerDamaged', dmg());
    bus.emit('playerDamaged', dmg());
    expect(dips).toBe(2);
    off();
    bus.emit('playerDamaged', dmg());
    expect(dips).toBe(2);
  });
});
