import { ShaderMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { post } from '../config/post';
import { render } from '../config/render';
import { PostPipeline, type PostEffect } from './post';

const effect = (name: string, over: Partial<PostEffect> = {}): PostEffect => ({ name, enabled: true, material: new ShaderMaterial(), ...over });
const make = (preset: 'low' | 'medium' | 'high'): PostPipeline => {
  const p = new PostPipeline(post);
  p.configure(render.quality[preset].post);
  return p;
};

describe('PostPipeline and Reduce flashing', () => {
  it('runs nothing while the preset has no post stack, whatever the extra effects', () => {
    const p = make('low');
    p.effects.push(effect('surgeGlow'));
    expect(p.active).toBe(false);
    expect(p.runningExtras).toBe(0);
    expect(p.allocatedTargets).toBe(0);
  });

  it('runs a steady extra effect with or without Reduce flashing', () => {
    const p = make('high');
    p.effects.push(effect('grade'));
    expect(p.active).toBe(true);
    expect(p.runningExtras).toBe(1);
    p.reduceFlashing = true;
    expect(p.runningExtras).toBe(1);
  });

  it('skips flashing extras (Surge glow) only while Reduce flashing is on', () => {
    const p = make('high');
    p.effects.push(effect('surgeGlow', { flashing: true }));
    expect(p.runningExtras).toBe(1);
    p.reduceFlashing = true;
    expect(p.runningExtras).toBe(0);
    p.effects.push(effect('grade'));
    expect(p.runningExtras).toBe(1);
    p.reduceFlashing = false;
    expect(p.runningExtras).toBe(2);
  });

  it('a disabled extra does not run either way', () => {
    const p = make('medium');
    p.effects.push(effect('surgeGlow', { flashing: true, enabled: false }));
    expect(p.runningExtras).toBe(0);
  });

  it('configure() follows the preset: Medium is bloom only, switching back to Low switches the pipeline off', () => {
    const p = make('medium');
    expect(p.active).toBe(true);
    expect(p.plan).toMatchObject({ fullScreenPasses: 1, quarterPasses: 1 });
    p.configure(render.quality.low.post);
    expect(p.active).toBe(false);
  });
});
