/* global console, process, URL */
/** Reproduce the numerical findings in codex-review.md. Research only. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./model.mjs', import.meta.url), 'utf8');
const expectedHash = 'fcbb2b6f7b90fe93c5cc79d12c7c617fab0a461564920c932d719c8aea399340';
const hash = createHash('sha256').update(source).digest('hex');
assert.equal(hash, expectedHash, 'model.mjs changed; this probe pins the reviewed prototype');
console.log(`Node ${process.version}; model SHA-256 ${hash}`);

// Extract the original solver without executing the model's reporting loops.
const start = source.indexOf('const SR =');
const end = source.indexOf('function responseDb');
assert.ok(start >= 0 && end > start);
const solver = source.slice(start, end);
const original = new Function(`${solver}; return makeLadder;`)();

function replaceOnce(text, before, after) {
  assert.equal(text.split(before).length, 2, `Expected one occurrence of ${before}`);
  return text.replace(before, after);
}

// Diagnostic only: preserve the true previous derivative at constant parameters.
// Evaluate the new derivative BEFORE advancing the HP integrator's memory.
let correctedSource = replaceOnce(
  solver,
  'let hpS = 0;',
  'let previousF = [0, 0, 0, 0]; let hpS = 0;',
);
correctedSource = replaceOnce(correctedSource, 'const f0 = f(x, u0);', 'const f0 = previousF;');
correctedSource = replaceOnce(
  correctedSource,
  '// commit',
  'previousF = f(xn, input + k * hpOf(xn[3]));\n    // commit',
);
const corrected = new Function(`${correctedSource}; return makeLadder;`)();
const sampleRate = 48000;

function responseDb(make, cutoff) {
  const process = make({ fc: cutoff, k: 0, newton: 12 });
  const amplitude = 1e-5;
  const warmup = sampleRate / 2;
  const frames = sampleRate;
  let re = 0;
  let im = 0;
  for (let i = 0; i < warmup + frames; i++) {
    const phase = (2 * Math.PI * cutoff * i) / sampleRate;
    const y = process(amplitude * Math.sin(phase));
    if (i >= warmup) {
      re += y * Math.cos(phase);
      im += y * Math.sin(phase);
    }
  }
  return 20 * Math.log10((2 * Math.hypot(re, im)) / frames / amplitude);
}

// At the prewarp frequency and k = 0, evaluate the published polynomial at j.
const expectedDb = -20 * Math.log10(
  Math.hypot(2 - 10 * Math.SQRT2, 8 * 2 ** 0.25 - 4 * 2 ** 0.75),
);
console.log('Response at the prewarp frequency, k = 0, amplitude 1e-5:');
for (const cutoff of [10000, 18000]) {
  const measured = responseDb(original, cutoff);
  const correctedDb = responseDb(corrected, cutoff);
  const extraDb = -20 * Math.log10(Math.cos((Math.PI * cutoff) / sampleRate));
  assert.ok(Math.abs(correctedDb - expectedDb) < 1e-6);
  assert.ok(Math.abs(measured - expectedDb - extraDb) < 1e-6);
  console.log(JSON.stringify({ cutoff, originalDb: measured, correctedDb, expectedDb, extraDb }));
}

function bandlimitedWave(kind) {
  const result = new Float64Array(sampleRate / 2);
  let peak = 0;
  for (let i = 0; i < result.length; i++) {
    let y = 0;
    for (let h = 1; h <= 127; h += kind === 'square' ? 2 : 1) {
      y += Math.sin((2 * Math.PI * 110 * h * i) / sampleRate) / h;
    }
    result[i] = y;
    peak = Math.max(peak, Math.abs(y));
  }
  return result.map((x) => (2 * x) / peak);
}

function compareIterations(make, cutoff, input) {
  const filters = [2, 12, 24].map((newton) => make({ fc: cutoff, k: 16.5, newton }));
  let error2 = 0;
  let error12 = 0;
  let peak = 0;
  let energy = 0;
  let errorEnergy = 0;
  for (const u of input) {
    const [two, twelve, reference] = filters.map((process) => process(u));
    peak = Math.max(peak, Math.abs(reference));
    error2 = Math.max(error2, Math.abs(two - reference));
    error12 = Math.max(error12, Math.abs(twelve - reference));
    energy += reference * reference;
    errorEnergy += (two - reference) ** 2;
  }
  assert.ok(Number.isFinite(peak) && peak > 0);
  assert.ok(error12 / peak < 1e-12, '12 and 24 iterations must agree for this comparison');
  return {
    peak,
    max2Db: 20 * Math.log10(error2 / peak),
    rms2Db: 10 * Math.log10(errorEnergy / energy),
    max12Db: 20 * Math.log10(error12 / peak),
  };
}

console.log('Newton errors over 0.5 s: 110 Hz, harmonics through 127, peak 2, k = 16.5:');
for (const kind of ['saw', 'square']) {
  const input = bandlimitedWave(kind);
  for (const [variant, make] of [['original', original], ['corrected history', corrected]]) {
    for (const cutoff of [1000, 10000, 18000]) {
      console.log(JSON.stringify({ variant, kind, cutoff, ...compareIterations(make, cutoff, input) }));
    }
  }
}
