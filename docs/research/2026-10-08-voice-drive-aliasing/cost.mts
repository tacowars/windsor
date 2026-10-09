// What each anti-aliasing method costs per voice-sample, against the voice's
// own render. Usage (from the repo root):
//   npx tsx docs/research/2026-10-08-voice-drive-aliasing/cost.mts [runs]
// Each method is a lean streaming loop in the worklet's style (typed-array
// state, no allocation, the curve inline), run over 20 s of a saw at 48 kHz.
// ADAA's soft needs a logarithm; the worklet may not call Math.log (its bits
// differ between arm64 and x64), so `adaa1` runs `log2InPlace`, the portable
// log the drive's diode already uses, and `adaa1-mathlog` shows what that costs.
import { performance } from 'node:perf_hooks';
import { loadProcessor, render } from '../../../packages/engine/src/__fixtures__/workletHarness.ts';
import { DRIVE_SHAPE, FILTER_MODE, makePatch, WAVE } from '../../../packages/engine/src/patch/patch.ts';
import { log2InPlace } from '../../../packages/engine/src/worklet/fm/portablePowers.ts';
import { HB, IIR } from './shapers.mts';

const RUNS = Number(process.argv[2] ?? 7);
const SR = 48000;
const SAMPLES = SR * 20;
const X = new Float64Array(SAMPLES);
for (let i = 0; i < SAMPLES; i++) X[i] = 2.5 * (((i * 220) / SR) % 1) - 1.25; // a naive saw at operand peak 3 after gain 2.4
const Y = new Float64Array(SAMPLES);
const GAIN = 2.4;

// Halfband taps: the even ones (nonzero) and the centre.
const TAPS_E = Float64Array.from({ length: (HB.length + 1) / 2 }, (_, j) => HB[2 * j]);
const TAP_C = HB[(HB.length - 1) / 2];
const TAPS_N = TAPS_E.length; // 24
const DELAY_M = (TAPS_N - 2) / 2; // the odd phase's delay at the low rate: 11

const LN2 = Math.LN2;
const SLOT = new Float64Array(1);
const SOFT_F3 = 0.5 + (4 / 3) * Math.log(4);

function naiveSoft(): void {
  const x = X, y = Y, LEN = SAMPLES, G = GAIN;
  for (let i = 0; i < LEN; i++) {
    const u = G * x[i];
    y[i] = u > 3 ? 1 : u < -3 ? -1 : (u * (27 + u * u)) / (27 + 9 * u * u);
  }
}

// Every loop below writes its curve, integral and filters out inline: a helper
// returning a double would box it (worklet rule 2) and time the heap, not the DSP.

function adaaSoft(portable: boolean): void {
  const x = X, y = Y, LEN = SAMPLES, G = GAIN, slot = SLOT;
  let up = 0;
  let Fp = 0;
  for (let i = 0; i < LEN; i++) {
    const u = G * x[i];
    const m = u < 0 ? -u : u;
    let F: number;
    if (m > 3) F = m - 3 + SOFT_F3;
    else {
      const q = 1 + (u * u) / 3;
      if (portable) {
        slot[0] = q;
        log2InPlace(slot, 0);
        F = (u * u) / 18 + (4 / 3) * LN2 * slot[0];
      } else F = (u * u) / 18 + (4 / 3) * Math.log(q);
    }
    const d = u - up;
    if (d > 1e-6 || d < -1e-6) y[i] = (F - Fp) / d;
    else {
      const v = 0.5 * (u + up);
      y[i] = v > 3 ? 1 : v < -3 ? -1 : (v * (27 + v * v)) / (27 + 9 * v * v);
    }
    up = u;
    Fp = F;
  }
}

/** 2x: up (24 even taps + the centre), the curve twice, down (24 + 1). `shape` 0 soft, 1 hard; `adaa` runs ADAA at 2x. */
function os2(adaa: boolean, shape = 0): void {
  const x = X, y = Y, LEN = SAMPLES, G = GAIN, E = TAPS_E, C = TAP_C, NE = TAPS_N, M = DELAY_M, slot = SLOT;
  const lo = new Float64Array(64);
  const hi = new Float64Array(128);
  const pair = new Float64Array(2);
  let li = 0,
    hw = 0,
    up = 0,
    Fp = 0;
  for (let i = 0; i < LEN; i++) {
    lo[li] = G * x[i];
    let even = 0;
    for (let j = 0; j < NE; j++) even += E[j] * lo[(li - j) & 63];
    pair[0] = 2 * even;
    pair[1] = 2 * C * lo[(li - M) & 63];
    li = (li + 1) & 63;
    for (let p = 0; p < 2; p++) {
      const u = pair[p];
      let v: number;
      if (adaa) {
        const m = u < 0 ? -u : u;
        let F: number;
        if (shape === 1) F = m <= 1 ? 0.5 * u * u : m - 0.5;
        else if (m > 3) F = m - 3 + SOFT_F3;
        else {
          slot[0] = 1 + (u * u) / 3;
          log2InPlace(slot, 0);
          F = (u * u) / 18 + (4 / 3) * LN2 * slot[0];
        }
        const d = u - up;
        if (d > 1e-6 || d < -1e-6) v = (F - Fp) / d;
        else {
          const w = 0.5 * (u + up);
          v = shape === 1 ? (w > 1 ? 1 : w < -1 ? -1 : w) : w > 3 ? 1 : w < -3 ? -1 : (w * (27 + w * w)) / (27 + 9 * w * w);
        }
        up = u;
        Fp = F;
      } else if (shape === 1) v = u > 1 ? 1 : u < -1 ? -1 : u;
      else v = u > 3 ? 1 : u < -3 ? -1 : (u * (27 + u * u)) / (27 + 9 * u * u);
      hi[(hw + p) & 127] = v;
    }
    const t = (hw + 1) & 127; // newest
    let acc = 0;
    for (let j = 0; j < NE; j++) acc += E[j] * hi[(t - 2 * j) & 127];
    acc += C * hi[(t - 2 * M - 1) & 127];
    hw = (hw + 2) & 127;
    y[i] = acc;
  }
}

/** 4x as two cascaded 2x stages, the curve four times. */
function os4(): void {
  const x = X, y = Y, LEN = SAMPLES, G = GAIN, E = TAPS_E, C = TAP_C, NE = TAPS_N, M = DELAY_M;
  const lo = new Float64Array(64);
  const mid = new Float64Array(128);
  const hi = new Float64Array(256);
  const dmid = new Float64Array(128);
  const up1 = new Float64Array(2);
  let li = 0,
    mi = 0,
    hw = 0,
    dw = 0;
  for (let i = 0; i < LEN; i++) {
    lo[li] = G * x[i];
    let even = 0;
    for (let j = 0; j < NE; j++) even += E[j] * lo[(li - j) & 63];
    up1[0] = 2 * even;
    up1[1] = 2 * C * lo[(li - M) & 63];
    li = (li + 1) & 63;
    for (let p = 0; p < 2; p++) {
      mid[mi] = up1[p];
      let e2 = 0;
      for (let j = 0; j < NE; j++) e2 += E[j] * mid[(mi - j) & 127];
      const a = 2 * e2;
      const b = 2 * C * mid[(mi - M) & 127];
      mi = (mi + 1) & 127;
      hi[hw] = a > 3 ? 1 : a < -3 ? -1 : (a * (27 + a * a)) / (27 + 9 * a * a);
      hi[(hw + 1) & 255] = b > 3 ? 1 : b < -3 ? -1 : (b * (27 + b * b)) / (27 + 9 * b * b);
      const t = (hw + 1) & 255;
      let acc = 0;
      for (let j = 0; j < NE; j++) acc += E[j] * hi[(t - 2 * j) & 255];
      acc += C * hi[(t - 2 * M - 1) & 255];
      hw = (hw + 2) & 255;
      dmid[dw] = acc;
      dw = (dw + 1) & 127;
    }
    const t = (dw - 1) & 127;
    let acc = 0;
    for (let j = 0; j < NE; j++) acc += E[j] * dmid[(t - 2 * j) & 127];
    acc += C * dmid[(t - 2 * M - 1) & 127];
    y[i] = acc;
  }
}

function adaaHard(): void {
  const x = X, y = Y, LEN = SAMPLES, G = GAIN;
  let up = 0;
  let Fp = 0;
  for (let i = 0; i < LEN; i++) {
    const u = G * x[i];
    const m = u < 0 ? -u : u;
    const F = m <= 1 ? 0.5 * u * u : m - 0.5;
    const d = u - up;
    if (d > 1e-6 || d < -1e-6) y[i] = (F - Fp) / d;
    else {
      const v = 0.5 * (u + up);
      y[i] = v > 1 ? 1 : v < -1 ? -1 : v;
    }
    up = u;
    Fp = F;
  }
}

function adaaFold(): void {
  const x = X, y = Y, LEN = SAMPLES, G = GAIN;
  let up = 0;
  let Fp = 0;
  for (let i = 0; i < LEN; i++) {
    const u = G * x[i];
    let v = u + 1;
    v -= 4 * Math.floor(v * 0.25);
    v -= 1;
    const F = v <= 1 ? 0.5 * v * v : 2 * v - 0.5 * v * v - 1;
    const d = u - up;
    if (d > 1e-6 || d < -1e-6) y[i] = (F - Fp) / d;
    else {
      let w = 0.5 * (u + up) + 1;
      w -= 4 * Math.floor(w * 0.25);
      y[i] = 1 - Math.abs(w - 2);
    }
    up = u;
    Fp = F;
  }
}

// The IIR halfband's two chains, four sections each, unrolled into locals.
const A0 = Float64Array.from([IIR[0], IIR[2], IIR[4], IIR[6]]);
const A1 = Float64Array.from([IIR[1], IIR[3], IIR[5], IIR[7]]);

/** 2x through the IIR halfband: both chains up, the curve twice, both chains down. `shape` 0 soft, 1 hard; `adaa` runs ADAA at 2x. */
// eslint-disable-next-line max-lines-per-function -- one hot loop written out, as the worklet's are
function iir2(shape: number, adaa: boolean): void {
  const x = X, y = Y, LEN = SAMPLES, G = GAIN, a0 = A0, a1 = A1, slot = SLOT;
  // state: up chain 0, up chain 1, down chain 0, down chain 1; x and y per section
  const ux0 = new Float64Array(4), uy0 = new Float64Array(4), ux1 = new Float64Array(4), uy1 = new Float64Array(4);
  const dx0 = new Float64Array(4), dy0 = new Float64Array(4), dx1 = new Float64Array(4), dy1 = new Float64Array(4);
  const pair = new Float64Array(2);
  let up = 0, Fp = 0;
  for (let i = 0; i < LEN; i++) {
    let s0 = G * x[i];
    let s1 = s0;
    for (let k = 0; k < 4; k++) {
      const t0 = a0[k] * (s0 - uy0[k]) + ux0[k];
      ux0[k] = s0;
      uy0[k] = t0;
      s0 = t0;
      const t1 = a1[k] * (s1 - uy1[k]) + ux1[k];
      ux1[k] = s1;
      uy1[k] = t1;
      s1 = t1;
    }
    pair[0] = s0;
    pair[1] = s1;
    for (let p = 0; p < 2; p++) {
      const u = pair[p];
      let v: number;
      if (adaa) {
        const m = u < 0 ? -u : u;
        let F: number;
        if (shape === 1) F = m <= 1 ? 0.5 * u * u : m - 0.5;
        else if (m > 3) F = m - 3 + SOFT_F3;
        else {
          slot[0] = 1 + (u * u) / 3;
          log2InPlace(slot, 0);
          F = (u * u) / 18 + (4 / 3) * LN2 * slot[0];
        }
        const d = u - up;
        if (d > 1e-6 || d < -1e-6) v = (F - Fp) / d;
        else {
          const w = 0.5 * (u + up);
          v = shape === 1 ? (w > 1 ? 1 : w < -1 ? -1 : w) : w > 3 ? 1 : w < -3 ? -1 : (w * (27 + w * w)) / (27 + 9 * w * w);
        }
        up = u;
        Fp = F;
      } else if (shape === 1) v = u > 1 ? 1 : u < -1 ? -1 : u;
      else v = u > 3 ? 1 : u < -3 ? -1 : (u * (27 + u * u)) / (27 + 9 * u * u);
      pair[p] = v;
    }
    let d0 = pair[1];
    let d1 = pair[0];
    for (let k = 0; k < 4; k++) {
      const t0 = a0[k] * (d0 - dy0[k]) + dx0[k];
      dx0[k] = d0;
      dy0[k] = t0;
      d0 = t0;
      const t1 = a1[k] * (d1 - dy1[k]) + dx1[k];
      dx1[k] = d1;
      dy1[k] = t1;
      d1 = t1;
    }
    y[i] = 0.5 * (d0 + d1);
  }
}

// The voice's own render, for scale: one held saw voice, drive off and drive soft.
const loaded = loadProcessor();
const env = { attackTime: 0.001, decayTime: 0.001, sustainLevel: 1 };
function voiceRun(drive: boolean): void {
  const p = makePatch({
    algorithm: 0,
    spread: 0,
    filter: { mode: FILTER_MODE.OFF },
    ops: [{ wave: WAVE.SAW, level: 1, env }, { level: 0, env }, { level: 0, env }, { level: 0, env }],
    ...(drive ? { drive: { on: true, shape: DRIVE_SHAPE.SOFT, gain: 3, bias: 0, tone: 1 } } : {}),
  } as never);
  render(loaded, loaded.create(p, 4), SAMPLES / 128, [{ type: 'noteOn', id: 1, note: 57, velocity: 1, frame: 0 }], { collectSamples: false });
}

const cases: [string, () => void][] = [
  ['voice, drive off', () => voiceRun(false)],
  ['voice, drive soft (as shipped)', () => voiceRun(true)],
  ['naive soft', naiveSoft],
  ['adaa1 soft', () => adaaSoft(true)],
  ['adaa1 soft, Math.log', () => adaaSoft(false)],
  ['adaa1 hard', adaaHard],
  ['adaa1 fold', adaaFold],
  ['os2 soft', () => os2(false)],
  ['os2-adaa1 soft', () => os2(true)],
  ['os2-adaa1 hard', () => os2(true, 1)],
  ['os4 soft', os4],
  ['iir2 soft', () => iir2(0, false)],
  ['iir2 hard', () => iir2(1, false)],
  ['iir2-adaa1 hard', () => iir2(1, true)],
  ['iir2-adaa1 soft', () => iir2(0, true)],
];

const results: Record<string, number[]> = {};
for (let r = 0; r < RUNS; r++) {
  for (const [name, fn] of cases) {
    const t0 = performance.now();
    fn();
    const ns = ((performance.now() - t0) * 1e6) / SAMPLES;
    (results[name] ??= []).push(ns);
  }
}
const med = (a: number[]) => [...a].sort((p, q) => p - q)[a.length >> 1];
console.log(`${RUNS} runs of ${SAMPLES / SR} s each; median ns per voice-sample (first run is warm-up, included)`);
for (const [name] of cases) console.log(`${name.padEnd(32)} ${med(results[name]).toFixed(2).padStart(7)}   [${results[name].map((v) => v.toFixed(1)).join(', ')}]`);
