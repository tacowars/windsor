/* global console */
/**
 * The Transient insert's sweep (record `2026-10-18-transient-insert`, the
 * issue's "The sweep"): the shipped bundle rendered under Node at every bound
 * of the interacting controls, printed as the Markdown tables of this
 * folder's README. Research only; the binding checks are tests
 * (`inserts/transientDsp.test.ts`).
 *
 *   node docs/research/2026-10-18-transient-insert/sweep.mjs
 *
 * Gains are output over input at one sample, in dB, read at the carrier's
 * crests (the hit's 220 Hz cosine is at a crest at 0, 50 and 200 ms).
 */
import { SHIPPED, TIMINGS, gainAt, hit, render, sine, transient } from './transientBundle.mjs';

const RATE = 48000;
const db = (v) => (Object.is(Math.round(v * 100) / 100, -0) ? 0 : v).toFixed(2);

/** Onset, 50 ms and 200 ms gains of the hit at `settings`, and the held tone's steady gain. */
function shape(settings, { rate = RATE, timing, peak = 0.5 } = {}) {
  const { signal, start } = hit(rate, { peak });
  const out = render(transient(rate, settings, timing), signal);
  const at = (s) => gainAt(signal[0], out[0], start + Math.round(s * rate));
  const tone = sine(rate, 220, { seconds: 2 });
  const held = render(transient(rate, settings, timing), tone);
  // The last crest of the held tone: 220 Hz at 48 kHz has one every 218.18 samples.
  let crest = tone[0].length - 1;
  while (Math.abs(tone[0][crest]) < 0.499) crest--;
  return {
    onset: at(0),
    at50: at(0.05),
    at200: at(0.2),
    steady: gainAt(tone[0], held[0], crest),
  };
}

function boundsTable() {
  const rows = ['| Attack | Sustain | Mix | Onset | 50 ms | 200 ms | Held tone |', '|---:|---:|---:|---:|---:|---:|---:|'];
  for (const mix of [1, 0.5])
    for (const attack of [-15, 0, 15])
      for (const sustain of [-24, 0, 24]) {
        const g = shape({ attack, sustain, mix });
        rows.push(
          `| ${attack} | ${sustain} | ${mix} | ${db(g.onset)} | ${db(g.at50)} | ${db(g.at200)} | ${db(g.steady)} |`,
        );
      }
  return rows.join('\n');
}

/** The largest difference between the gain curves of the hit at 0, −20 and −40 dBFS. */
function levelTable() {
  const rows = ['| Attack | Sustain | Largest difference, 0 to 1 s |', '|---:|---:|---:|'];
  for (const [attack, sustain] of [[15, 0], [0, -24], [0, 24], [10, -12], [-15, 24]]) {
    const curves = [1, 0.1, 0.01].map((peak) => {
      const { signal } = hit(RATE, { peak });
      const out = render(transient(RATE, { attack, sustain }), signal);
      return { signal: signal[0], out: out[0], peak };
    });
    let worst = 0;
    for (let i = 0; i < curves[0].signal.length; i++) {
      const g = curves.map((c) => (Math.abs(c.signal[i]) > 1e-6 * c.peak ? gainAt(c.signal, c.out, i) : NaN));
      if (g.some(Number.isNaN)) continue;
      worst = Math.max(worst, Math.abs(g[0] - g[1]), Math.abs(g[0] - g[2]));
    }
    rows.push(`| ${attack} | ${sustain} | ${worst.toExponential(1)} dB |`);
  }
  return rows.join('\n');
}

/** The gain's ripple on a held sine, the last second of three, at each row and pitch. */
function rippleTable() {
  const rows = ['| Row | hold | 1/(2·hold) | Hz | Attack +15 | Sustain +24 |', '|---|---:|---:|---:|---:|---:|'];
  for (const [name, timing] of Object.entries(TIMINGS)) {
    const edge = 1000 / (2 * timing.holdMs);
    for (const hz of [30, 42, 55, 110]) {
      const ripple = [{ attack: 15 }, { sustain: 24 }].map((settings) => {
        const tone = sine(RATE, hz);
        const out = render(transient(RATE, settings, timing), tone);
        let lo = Infinity,
          hi = -Infinity;
        for (let i = 2 * RATE; i < 3 * RATE; i++) {
          if (Math.abs(tone[0][i]) < 0.05) continue;
          const g = gainAt(tone[0], out[0], i);
          lo = Math.min(lo, g);
          hi = Math.max(hi, g);
        }
        return (hi - lo).toFixed(4);
      });
      const mark = hz >= edge ? '' : ' (below)';
      rows.push(`| ${name} | ${timing.holdMs} ms | ${edge.toFixed(1)} Hz | ${hz}${mark} | ${ripple[0]} dB | ${ripple[1]} dB |`);
    }
  }
  return rows.join('\n');
}

/** The largest sample-to-sample step of `x` from `from` to `to`. */
function largestStep(x, from, to) {
  let step = 0;
  for (let i = Math.max(1, from); i < to; i++) step = Math.max(step, Math.abs(x[i] - x[i - 1]));
  return step;
}

/**
 * Live moves mid-hit, each over the 30 ms from the quantum it starts on: the
 * switch off at 20 ms and back on at 120 ms, and Attack swept −15 to +15
 * from 50 to 150 ms a quantum at a time, as a lane writes it. Each move's
 * largest step beside the same settings left still and the input's own, in
 * the same span.
 */
function liveTable() {
  const { signal, start } = hit(RATE);
  const quantum = (s) => Math.round((start + s * RATE) / 128);
  const span = (q) => [q * 128, q * 128 + Math.round(0.03 * RATE)];
  const rows = ['| Move | Settings | Largest step | Still | The input\'s own |', '|---|---|---:|---:|---:|'];
  const row = (move, label, moved, still, [from, to]) =>
    rows.push(
      `| ${move} | ${label} | ${largestStep(moved[0], from, to).toFixed(4)} | ${largestStep(still[0], from, to).toFixed(4)} | ${largestStep(signal[0], from, to).toFixed(4)} |`,
    );
  for (const settings of [{ attack: 15 }, { sustain: 24 }, { attack: 10, sustain: -12 }, { attack: -15, sustain: -24 }]) {
    const still = render(transient(RATE, settings), signal);
    const off = quantum(0.02),
      on = quantum(0.12);
    const moved = render(transient(RATE, settings), signal, (q, p) => {
      if (q === off) p.enabled[0] = 0;
      if (q === on) p.enabled[0] = 1;
    });
    const label = Object.entries(settings).map(([k, v]) => `${k} ${v}`).join(', ');
    row('Off at 20 ms', label, moved, still, span(off));
    row('On at 120 ms', label, moved, still, span(on));
  }
  for (const sustain of [0, 24]) {
    const settings = { attack: -15, sustain };
    const still = render(transient(RATE, settings), signal);
    const from = quantum(0.05),
      to = quantum(0.15);
    const swept = render(transient(RATE, settings), signal, (q, p) => {
      const u = Math.min(1, Math.max(0, (q - from) / (to - from)));
      p.attack[0] = -15 + 30 * u;
    });
    row('Attack −15 to +15, 50 to 150 ms', `sustain ${sustain}`, swept, still, [from * 128, to * 128]);
  }
  return rows.join('\n');
}

/** Onset and decay gains at three rates, and their largest spread. */
function rateTable() {
  const rows = ['| Settings | Point | 44.1 kHz | 48 kHz | 96 kHz | Spread |', '|---|---|---:|---:|---:|---:|'];
  for (const settings of [{ attack: 15 }, { attack: -15 }, { sustain: -24 }, { sustain: 24 }]) {
    const g = [44100, 48000, 96000].map((rate) => shape(settings, { rate }));
    const label = Object.entries(settings).map(([k, v]) => `${k} ${v}`).join(', ');
    for (const point of ['onset', 'at50', 'at200']) {
      const v = g.map((x) => x[point]);
      const spread = Math.max(...v) - Math.min(...v);
      const name = { onset: 'onset', at50: '50 ms', at200: '200 ms' }[point];
      rows.push(`| ${label} | ${name} | ${v.map(db).join(' | ')} | ${spread.toFixed(3)} |`);
    }
  }
  return rows.join('\n');
}

/** The hit at each timing row: what the listen compares. */
function rowTable() {
  const rows = ['| Row | Attack +15 onset | Attack +15, 50 ms | Sustain −24, 50 ms | Sustain −24, 200 ms | Sustain +24, 200 ms |', '|---|---:|---:|---:|---:|---:|'];
  for (const [name, timing] of Object.entries(TIMINGS)) {
    const a = shape({ attack: 15 }, { timing });
    const cut = shape({ sustain: -24 }, { timing });
    const lift = shape({ sustain: 24 }, { timing });
    const ships = name === SHIPPED ? ' (ships)' : '';
    rows.push(`| ${name}${ships} | ${db(a.onset)} | ${db(a.at50)} | ${db(cut.at50)} | ${db(cut.at200)} | ${db(lift.at200)} |`);
  }
  return rows.join('\n');
}

for (const [title, table] of [
  ['Bounds (shipped row)', boundsTable],
  ['Level independence', levelTable],
  ['Low notes', rippleTable],
  ['Live moves', liveTable],
  ['Rates', rateTable],
  ['Timing rows', rowTable],
]) {
  console.log(`### ${title}\n\n${table()}\n`);
}
