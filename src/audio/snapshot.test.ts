import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { describe, it } from 'vitest';
import { audio, CUE_IDS } from '../config/audio';
import { dominantHz, energyAbove, peakDb, spectralCentroid, spectrogram } from './analysis';
import { renderSoundSet } from './cues';
import { renderTell } from './tell';

/**
 * Docs snapshot generator, skipped in normal runs. `npm run audio:snapshot` writes one PNG per cue
 * (waveform on top, spectrogram 0..8 kHz below) plus the kill ladder to docs/audio/, and prints a
 * metrics table for docs/audio.md.
 */
const OUT = process.env.AUDIO_SNAPSHOT_DIR;
const SR = 48000;

function crc32(buf: Uint8Array): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]!;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  out.set(data, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function png(w: number, h: number, rgb: Uint8Array): Buffer {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    raw.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), y * (w * 3 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array(0))]);
}

/** Dark-to-bright heat map for a 0..1 value. */
function heat(v: number): [number, number, number] {
  const t = Math.min(1, Math.max(0, v));
  return [Math.round(255 * Math.min(1, t * 2.2)), Math.round(255 * Math.min(1, Math.max(0, t * 2.2 - 0.6))), Math.round(255 * Math.min(1, 0.25 + t * 0.3 + Math.max(0, t - 0.8) * 3))];
}

function image(buf: Float32Array, spanMs: number, w: number): Buffer {
  const waveH = 70;
  const specH = 130;
  const h = waveH + specH;
  const rgb = new Uint8Array(w * h * 3);
  for (let i = 0; i < w * h; i++) rgb.set([14, 16, 22], i * 3);
  const spanSamples = (spanMs / 1000) * SR;
  // Waveform: per-column min/max.
  for (let x = 0; x < w; x++) {
    const a = Math.floor((x / w) * spanSamples);
    const b = Math.max(a + 1, Math.floor(((x + 1) / w) * spanSamples));
    let lo = 0;
    let hi = 0;
    for (let i = a; i < b && i < buf.length; i++) {
      lo = Math.min(lo, buf[i]!);
      hi = Math.max(hi, buf[i]!);
    }
    const y0 = Math.round(waveH / 2 - hi * (waveH / 2 - 2) * 2.2);
    const y1 = Math.round(waveH / 2 - lo * (waveH / 2 - 2) * 2.2);
    for (let y = Math.max(0, y0); y <= Math.min(waveH - 1, y1); y++) rgb.set([120, 200, 255], (y * w + x) * 3);
  }
  // Spectrogram.
  const frame = 512;
  const hop = 64;
  const padded = new Float32Array(Math.ceil(spanSamples) + frame);
  padded.set(buf.subarray(0, Math.min(buf.length, padded.length)));
  const rows = spectrogram(padded, SR, frame, hop, specH, 8000);
  let maxDb = -200;
  for (const r of rows) for (const v of r) maxDb = Math.max(maxDb, v);
  for (let x = 0; x < w; x++) {
    const row = rows[Math.min(rows.length - 1, Math.floor((x / w) * (spanSamples / hop)))]!;
    for (let y = 0; y < specH; y++) {
      const db = row[specH - 1 - y]!;
      const [r, g, b] = heat((db - (maxDb - 70)) / 70);
      rgb.set([r, g, b], ((waveH + y) * w + x) * 3);
    }
  }
  return png(w, h, rgb);
}

describe.skipIf(!OUT)('audio docs snapshot', () => {
  it('writes waveform + spectrogram PNGs and prints metrics', () => {
    const dir = OUT!;
    mkdirSync(dir, { recursive: true });
    const set = renderSoundSet(audio, SR);
    const lines = ['| cue | bus | length | peak | centroid | dominant | energy > 1.5 kHz |', '|---|---|---|---|---|---|---|'];
    for (const id of CUE_IDS) {
      const v = set[id].variants[0]!;
      // 250 ms covers most cues; longer ones get a longer span (in 50 ms steps, to 1 s).
      const span = Math.min(1000, Math.max(250, Math.ceil((v.length / SR) * 20) * 50));
      writeFileSync(join(dir, `${id}.png`), image(v, span, 500));
      lines.push(`| \`${id}\`${set[id].variants.length > 1 ? ' (step 1)' : ''} | ${set[id].bus} | ${(v.length / SR * 1000).toFixed(0)} ms | ${peakDb(v).toFixed(1)} dBFS | ${spectralCentroid(v, SR).toFixed(0)} Hz | ${dominantHz(v, SR).toFixed(0)} Hz | ${(energyAbove(v, SR, 1500) * 100).toFixed(1)} % |`);
    }
    // The enemy tell at the dial's two ends and the fairness floor: the sweep stretches with the tell.
    for (const ms of [150, 300, 500]) {
      const v = renderTell(ms, audio.enemyTell, SR);
      writeFileSync(join(dir, `enemyTell_${ms}.png`), image(v, 500, 500));
    }
    // The chain layer ladder, like the kill ladder below.
    const chainLadder = new Float32Array(Math.ceil(8 * 0.25 * SR));
    set.chain.variants.forEach((v, i) => chainLadder.set(v, Math.round(i * 0.25 * SR)));
    writeFileSync(join(dir, 'chainLadder.png'), image(chainLadder, 2000, 1000));
    // The ladder: steps 1..8 one after another, 250 ms apart.
    const ladder = new Float32Array(Math.ceil(8 * 0.25 * SR));
    set.kill.variants.forEach((v, i) => ladder.set(v, Math.round(i * 0.25 * SR)));
    writeFileSync(join(dir, 'killLadder.png'), image(ladder, 2000, 1000));
    console.log(lines.join('\n'));
  }, 60000);
});
