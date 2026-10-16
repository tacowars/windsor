/* global URL, process, console */
/**
 * The pitch swing of the Tape's wow and flutter (windsor#818), read off the
 * shipped bundle's motion delay path under Node. Each run builds the tape
 * processor at the rate, seed 12345, with the setting as its parameters,
 * then calls its DSP's `advance` (the controls, the square law, the motion
 * and the hiss's draw, as a rendered frame does) for 120 s, and reads
 * `motion.delay` each sample. A delay that moves by Δ samples in a sample
 * plays the tape at 1 − Δ of its speed, so the sample's pitch error is
 * 1200 · log2(1 − Δ) cents, the method of the issue's Goal table. Each row
 * reports that error's 1st and 99th percentiles, its largest magnitude and
 * its RMS (unweighted, for a rough reading against a deck's WRMS figure).
 *
 * A "today" row is the same DSP with the linear mapping it replaces
 * (`dial / 100`) written into its amounts instead of the square law's, so
 * the two columns differ in the mapping alone. `--goal` also prints the
 * Goal's three rows from `TapeMotion.tick` alone (no hiss draws between the
 * motion's), the issue's replication.
 *
 *   node docs/research/2026-10-16-tape-motion-range/measure.mjs [--seconds 120] [--goal]
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BUNDLE = fileURLToPath(
  new URL('../../../packages/engine/src/worklet/generated/tape-processor.js', import.meta.url),
);
const SEED = 12345;
const RATES = [44100, 48000];
const DIALS = [0, 10, 25, 50, 75, 100];
const CENTS = 1200;
const P_LOW = 0.01;
const P_HIGH = 0.99;

const argument = (name, fallback) => {
  const at = process.argv.indexOf(name);
  return at > 0 ? Number(process.argv[at + 1]) : fallback;
};
const SECONDS = argument('--seconds', 120);

/** The processor class at `rate`, from the shipped bundle. */
function loadProcessor(rate) {
  let Processor = null;
  class Base {
    constructor() {
      this.port = { postMessage() {}, onmessage: null };
    }
  }
  new Function('sampleRate', 'AudioWorkletProcessor', 'registerProcessor', readFileSync(BUNDLE, 'utf8'))(
    rate,
    Base,
    (_name, cls) => {
      Processor = cls;
    },
  );
  return Processor;
}
const PROCESSORS = new Map(RATES.map((rate) => [rate, loadProcessor(rate)]));

/** The DSP of a processor at `rate` built with `setting` as its parameters. */
function dspFor(rate, setting) {
  const Processor = PROCESSORS.get(rate);
  const parameterData = { seed: SEED, ...setting, split: setting.split ? 1 : 0 };
  return new Processor({ parameterData, processorOptions: {} }).dsp;
}

/** p1, p99, the largest magnitude and the RMS of the per-sample pitch error over `frames`. */
function swing(frames, step) {
  const cents = new Float64Array(frames - 1);
  let previous = step();
  let largest = 0,
    squares = 0;
  for (let n = 0; n < cents.length; n++) {
    const delay = step();
    const c = CENTS * Math.log2(1 - (delay - previous));
    previous = delay;
    cents[n] = c;
    largest = Math.max(largest, Math.abs(c));
    squares += c * c;
  }
  cents.sort();
  const at = (p) => cents[Math.min(cents.length - 1, Math.floor(p * cents.length))];
  return { low: at(P_LOW), high: at(P_HIGH), largest, rms: Math.sqrt(squares / cents.length) };
}

/**
 * The swing of `setting` at `rate` through the DSP. `amounts`, when given,
 * replaces the square law with today's linear amounts [wow, flutter].
 */
function measure(rate, setting, amounts) {
  const dsp = dspFor(rate, setting);
  if (amounts)
    dsp.updateAmounts = function linear() {
      this.wowAmount = amounts[0];
      this.flutterAmount = amounts[1];
    };
  return swing(rate * SECONDS, () => {
    dsp.advance();
    return dsp.motion.delay;
  });
}

/** The Goal's replication: `TapeMotion.tick` alone at today's amounts. */
function measureMotion(rate, setting, [wow, flutter]) {
  const motion = dspFor(rate, setting).motion;
  return swing(rate * SECONDS, () => {
    motion.tick(wow, flutter, 0);
    return motion.delay;
  });
}

const cell = ({ low, high, largest, rms }) =>
  `${low.toFixed(1)} to +${high.toFixed(1)} | ${largest.toFixed(1)} | ${rms.toFixed(2)}`.replace(
    '+-',
    '-',
  );

/** The rows: a mode, its dial's field, and the rate settings it is read at. */
const MODES = [
  {
    name: 'Wow alone',
    setting: (dial) => ({ split: true, wow: dial }),
    rates: [{ wowRate: 1 }, { wowRate: 0.05 }, { wowRate: 3 }],
  },
  {
    name: 'Flutter alone',
    setting: (dial) => ({ split: true, flutter: dial }),
    rates: [{ flutterRate: 7 }, { flutterRate: 1 }, { flutterRate: 20 }],
  },
  {
    name: 'Wear (unsplit)',
    setting: (dial) => ({ wear: dial }),
    rates: [
      { wowRate: 1, flutterRate: 7 },
      { wowRate: 0.05, flutterRate: 7 },
      { wowRate: 3, flutterRate: 7 },
      { wowRate: 1, flutterRate: 1 },
      { wowRate: 1, flutterRate: 20 },
    ],
  },
];

const rateLabel = (r) =>
  Object.entries(r)
    .map(([k, v]) => `${k} ${v}`)
    .join(', ');

function sweepTables() {
  for (const rate of RATES) {
    for (const mode of MODES) {
      console.log(`\n### ${mode.name}, ${rate / 1000} kHz\n`);
      console.log('| Rates | Dial | Amount | p1 to p99 (cents) | Largest (cents) | RMS (cents) |');
      console.log('|---|---|---|---|---|---|');
      for (const rates of mode.rates) {
        for (const dial of DIALS) {
          const setting = { ...mode.setting(dial), ...rates };
          const dsp = dspFor(rate, setting);
          dsp.advance();
          const amount = Math.max(dsp.wowAmount, dsp.flutterAmount);
          const row = measure(rate, setting);
          console.log(`| ${rateLabel(rates)} | ${dial} | ${amount.toFixed(4)} | ${cell(row)} |`);
        }
      }
    }
  }
}

/** Today's settings against the square law's, at 48 kHz and the default rates. */
const COMPARISONS = [
  ['Wear 30 (unsplit)', { wear: 30 }, [0.3, 0.3]],
  ['Split, Wow 5, Flutter 10', { split: true, wow: 5, flutter: 10 }, [0.05, 0.1]],
  ['Split, Wow 3, Flutter 3', { split: true, wow: 3, flutter: 3 }, [0.03, 0.03]],
  ['Split, Wow 30', { split: true, wow: 30 }, [0.3, 0]],
];
const NEW = [
  ['Split, Wow 100', { split: true, wow: 100 }],
  ['Split, Wow 41, Flutter 58', { split: true, wow: 41, flutter: 58 }],
  ['Split, Wow 5, Flutter 10', { split: true, wow: 5, flutter: 10 }],
  ['Wear 30 (unsplit)', { wear: 30 }],
];

function comparisons() {
  const rate = 48000;
  console.log('\n### Today, linear (48 kHz, default rates)\n');
  console.log('| Setting | p1 to p99 (cents) | Largest (cents) | RMS (cents) |');
  console.log('|---|---|---|---|');
  for (const [name, setting, amounts] of COMPARISONS)
    console.log(`| ${name} | ${cell(measure(rate, setting, amounts))} |`);
  console.log('\n### The square law (48 kHz, default rates)\n');
  console.log('| Setting | p1 to p99 (cents) | Largest (cents) | RMS (cents) |');
  console.log('|---|---|---|---|');
  for (const [name, setting] of NEW) console.log(`| ${name} | ${cell(measure(rate, setting))} |`);
  if (!process.argv.includes('--goal')) return;
  console.log("\n### The Goal's replication: TapeMotion.tick alone, today's amounts\n");
  console.log('| Setting | p1 to p99 (cents) | Largest (cents) | RMS (cents) |');
  console.log('|---|---|---|---|');
  for (const [name, setting, amounts] of COMPARISONS.slice(0, 3))
    console.log(`| ${name} | ${cell(measureMotion(rate, setting, amounts))} |`);
}

console.log(`Seed ${SEED}, ${SECONDS} s a run.`);
comparisons();
sweepTables();
