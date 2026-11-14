/**
 * Placeholder synthesised audio (no asset files yet). Lazily created on the first user gesture
 * (browsers block AudioContext before one). Sounds are tiny one-shot oscillator/noise bursts built
 * from a shared preallocated noise buffer. Real sound design replaces the bodies of the play*
 * methods; the event wiring in sfx.ts stays.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private volume = 0.7;

  constructor(private readonly masterGain: number) {}

  /** Call from a user gesture (click to play). Safe to call repeatedly. */
  resume(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor({ latencyHint: 'interactive' });
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      const len = Math.floor(this.ctx.sampleRate * 0.25);
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      let s = 12345;
      for (let i = 0; i < len; i++) {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        d[i] = (s / 4294967296) * 2 - 1;
      }
      this.applyVolume();
    }
    void this.ctx.resume();
  }

  setVolume(v: number): void {
    this.volume = v;
    this.applyVolume();
  }

  private applyVolume(): void {
    if (this.master) this.master.gain.value = this.volume * this.masterGain;
  }

  private ready(): AudioContext | null {
    return this.ctx && this.ctx.state === 'running' ? this.ctx : null;
  }

  private tone(freq: number, endFreq: number, dur: number, gain: number, type: OscillatorType): void {
    const c = this.ready();
    if (!c || !this.master) return;
    const t = c.currentTime;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, endFreq), t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private burst(dur: number, gain: number, filterHz: number): void {
    const c = this.ready();
    if (!c || !this.master || !this.noise) return;
    const t = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = filterHz;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  playShot(): void {
    this.burst(0.09, 0.9, 5200);
    this.tone(170, 55, 0.1, 0.6, 'triangle');
  }
  playHit(): void {
    this.tone(1250, 900, 0.06, 0.35, 'sine');
  }
  playKill(): void {
    this.tone(880, 880, 0.08, 0.35, 'sine');
    setTimeout(() => this.tone(1320, 1320, 0.14, 0.35, 'sine'), 70);
  }
  playJump(): void {
    this.burst(0.05, 0.12, 900);
  }
  playLand(strength: number): void {
    this.burst(0.09, Math.min(0.5, 0.1 + strength * 0.04), 600);
  }
  playFootstep(crouching: boolean): void {
    this.burst(0.04, crouching ? 0.04 : 0.1, 700);
  }
}
