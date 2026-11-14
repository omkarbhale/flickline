import { ShaderMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { PostPipeline, type PostEffect } from './post';

const effect = (name: string, over: Partial<PostEffect> = {}): PostEffect => ({ name, enabled: true, material: new ShaderMaterial(), ...over });

describe('PostPipeline and Reduce flashing', () => {
  it('runs nothing while the pipeline is off, whatever the effects', () => {
    const p = new PostPipeline();
    p.effects.push(effect('vignette'));
    expect(p.active).toBe(false);
  });

  it('runs a steady effect with or without Reduce flashing', () => {
    const p = new PostPipeline();
    p.enabled = true;
    p.effects.push(effect('vignette'));
    expect(p.active).toBe(true);
    p.reduceFlashing = true;
    expect(p.active).toBe(true);
  });

  it('skips flashing effects (chromatic pulse, Surge glow) only while Reduce flashing is on', () => {
    const p = new PostPipeline();
    p.enabled = true;
    p.effects.push(effect('chromatic', { flashing: true }), effect('surgeGlow', { flashing: true }));
    expect(p.active).toBe(true);
    p.reduceFlashing = true;
    expect(p.active).toBe(false); // nothing left to run: the scene renders straight to the canvas
    p.effects.push(effect('vignette'));
    expect(p.active).toBe(true);
    p.reduceFlashing = false;
    expect(p.active).toBe(true);
  });

  it('a disabled effect does not run either way', () => {
    const p = new PostPipeline();
    p.enabled = true;
    p.effects.push(effect('chromatic', { flashing: true, enabled: false }));
    expect(p.active).toBe(false);
  });
});
