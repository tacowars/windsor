/* global process */
/**
 * The Acid Ladder's aliasing reading (windsor#573, decision 6, reading 3):
 * each solver candidate at k 16.5, cutoffs 500 Hz to the top of its range,
 * driven by a sine sweep at the ceiling input, through the shipped bundle's
 * `Ladder`. The sine is coherent with the transform (a whole number of
 * cycles in it, a prime number of them), so the output, periodic after the
 * warm-up, puts its harmonics in exact bins with no window: every other bin
 * holds what folded back past Nyquist (the aliased products), or rounding.
 * Reported per cutoff: the loudest aliased product over the sweep, in dB
 * against the input sine (dBr), with the sweep frequency it came from, and
 * the summed aliased power at that frequency. The 2× candidate is read with
 * three decimators: none (the last sub-step taken), the shipped three-tap
 * half-band, and a seven-tap one.
 *
 *   node aliasing.mjs <repo> [--level 1]
 *
 * `--level` is the sine's peak in the carrier's units: 1 is full scale, the
 * most the voice's drive stage passes on (every shape clips at ±1); 4 is
 * the research matrix's hot cell (peak 8 in the ladder's units).
 */
import { CANDIDATES, SR, candidate, loadBundle, step } from './bundle.mjs';

const args = process.argv.slice(2);
const root = args[0] ?? '.';
const level = Number(args[args.indexOf('--level') + 1] || 1);
const { Ladder } = loadBundle(root);

const N = 16384;
const WARM = 8192;
/** Sweep frequencies: the prime bin nearest each, so the harmonics land on distinct bins. */
const SWEEP_HZ = [110, 220, 440, 880, 1320, 1760, 2640, 3520, 5280, 7040, 10560];

function isPrime(n) {
  for (let d = 2; d * d <= n; d++) if (n % d === 0) return false;
  return n > 1;
}
function primeBin(hz) {
  let bin = Math.round((hz * N) / SR);
  while (!isPrime(bin)) bin++;
  return bin;
}

/** In-place radix-2 FFT. */
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const stepAngle = (-2 * Math.PI) / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < size / 2; k++) {
        const wr = Math.cos(stepAngle * k);
        const wi = Math.sin(stepAngle * k);
        const a = start + k;
        const b = a + size / 2;
        const tr = re[b] * wr - im[b] * wi;
        const ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
}

/** The loudest aliased bin and the summed aliased power, both in dB against the input sine, for a sine at `bin`. */
function aliasing(ladder, bin) {
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  for (let i = 0; i < WARM + N; i++) {
    const y = step(ladder, level * Math.sin((2 * Math.PI * bin * i) / N));
    if (i >= WARM) re[i - WARM] = y;
  }
  fft(re, im);
  // A sine of peak A reads A N / 2 in its bin.
  const scale = (level * N) / 2;
  let loudest = 0;
  let sum = 0;
  for (let k = 1; k <= N / 2; k++) {
    if (k % bin === 0) continue; // a harmonic below Nyquist
    const p = (re[k] ** 2 + im[k] ** 2) / scale ** 2;
    loudest = Math.max(loudest, p);
    sum += p;
  }
  return { loudest: 10 * Math.log10(loudest), sum: 10 * Math.log10(sum) };
}

const DECIMATORS = {
  none: [1, 0, 0],
  'three-tap': [0.25, 0.5, 0.25],
  'seven-tap': [-1 / 32, 0, 9 / 32, 1 / 2, 9 / 32, 0, -1 / 32],
};

/** The sweep's worst reading for one candidate, decimator and cutoff. */
function worstOver(name, cutoffHz, taps) {
  let worst = { loudest: -Infinity, sum: -Infinity, hz: 0 };
  for (const hz of SWEEP_HZ) {
    const bin = primeBin(hz);
    const ladder = candidate(new Ladder(), name, { cutoffHz, k: 16.5, taps });
    const reading = aliasing(ladder, bin);
    if (reading.loudest > worst.loudest) worst = { ...reading, hz: (bin * SR) / N };
  }
  return worst;
}

process.stdout.write(`sine at peak ${level} (carrier units), k 16.5, ${N}-point coherent transform\n`);
for (const [name, c] of Object.entries(CANDIDATES)) {
  const decimators = c.oversample === 1 ? { '-': undefined } : DECIMATORS;
  for (const [decimator, taps] of Object.entries(decimators)) {
    for (const cutoffHz of [500, 1000, 2000, 5000, 10000, 18000].filter((hz) => hz <= c.capHz)) {
      const worst = worstOver(name, cutoffHz, taps);
      process.stdout.write(
        `${name}${decimator === '-' ? '' : ` (${decimator})`} at ${String(cutoffHz).padStart(5)} Hz: ` +
          `loudest alias ${worst.loudest.toFixed(1)} dBr, all ${worst.sum.toFixed(1)} dBr, from ${worst.hz.toFixed(0)} Hz\n`,
      );
    }
  }
}
