import { describe, expect, it } from 'vitest';
import { titleFromId } from './menuModel';

describe('titleFromId', () => {
  it('derives a title from an id', () => {
    expect(titleFromId('sweep')).toBe('Sweep');
    expect(titleFromId('someMode')).toBe('Some Mode');
    expect(titleFromId('some-mode')).toBe('Some mode');
    expect(titleFromId('')).toBe('');
  });
});
