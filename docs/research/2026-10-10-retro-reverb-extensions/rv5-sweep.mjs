/* global URL, process, console */
// RV-5's boundary sweep: the RT60 below and above Low cross, the bands' levels, Density's level and
// stability, over the valid box. Offline in Node on a shipped bundle.
//
//   node rv5-sweep.mjs run [bundle.js] [i/n] > part.jsonl   one JSON line a setting
//   node rv5-sweep.mjs summary part*.jsonl                  the tables in rv5.md
//
// Each setting renders an impulse (Mix 1, Character 0) at Low decay 0.25, 1 and 4, and today's
// tank (Low decay 1) at Decay × 0.25 and Decay × 4, the low band's references. Renders run at
// 46,875 Hz, exactly twice the internal clock: at 48 kHz the hold that carries the clock to the
// host rate leaves beat images of each band about 40 dB under it in the other (rv5.md). The bands
// are octaves (16th-order Butterworth edges) around Low cross / 8 and Low cross × 8 (7 kHz at
// most); RT60 is a least-squares fit of the backward-integrated energy from -5 to -25 dB.
import { readFileSync } from 'node:fs';

const RATE = 46875;
const root = new URL('../../../', import.meta.url);
const [mode = 'run', ...rest] = process.argv.slice(2);
const GRID = {
  size: [0.25, 1, 3, 10],
  decay: [0.2, 1, 5, 20],
  tone: [800, 9000],
  lowCross: [80, 300, 2000],
};
const bands = (cross) => ({ low: cross / 8, high: Math.min(cross * 8, 7000) });

function load(bundle) {
  let Processor;
  class Base {
    port = { onmessage: null, postMessage() {} };
  }
  const source = readFileSync(bundle, 'utf8');
  new Function('AudioWorkletProcessor', 'sampleRate', 'registerProcessor', source)(
    Base,
    RATE,
    (_name, ctor) => {
      Processor = ctor;
    },
  );
  return Processor;
}

function render(Processor, spec, seconds) {
  const params = Object.fromEntries(
    Processor.parameterDescriptors.map((d) => [d.name, new Float32Array([d.defaultValue])]),
  );
  for (const [k, v] of Object.entries({ mix: 1, character: 0, ...spec }))
    params[k] = new Float32Array([v]);
  const node = new Processor({
    parameterData: Object.fromEntries(Object.entries(params).map(([k, v]) => [k, v[0]])),
  });
  const frames = Math.ceil(RATE * seconds);
  const out = [new Float32Array(frames), new Float32Array(frames)];
  const input = [new Float32Array(128), new Float32Array(128)];
  const output = [new Float32Array(128), new Float32Array(128)];
  for (let f = 0; f < frames; f += 128) {
    input[0][0] = input[1][0] = f === 0 ? 0.8 : 0;
    node.process([input], [output], params);
    const n = Math.min(128, frames - f);
    out[0].set(output[0].subarray(0, n), f);
    out[1].set(output[1].subarray(0, n), f);
  }
  return out;
}

/** Butterworth lowpass or highpass of `order` at f Hz, as biquads (bilinear), forwards. */
function butter(data, f, high, order = 16) {
  const w = (2 * Math.PI * f) / RATE;
  const cos = Math.cos(w),
    sin = Math.sin(w);
  let x = Float64Array.from(data);
  for (let k = 0; k < order / 2; k++) {
    const q = 1 / (2 * Math.cos((Math.PI * (2 * k + 1)) / (2 * order)));
    const alpha = sin / (2 * q);
    const a0 = 1 + alpha;
    const b0 = (high ? (1 + cos) / 2 : (1 - cos) / 2) / a0;
    const b1 = (high ? -(1 + cos) : 1 - cos) / a0;
    const a1 = (-2 * cos) / a0,
      a2 = (1 - alpha) / a0;
    const y = new Float64Array(x.length);
    let x1 = 0,
      x2 = 0,
      y1 = 0,
      y2 = 0;
    for (let i = 0; i < x.length; i++) {
      const v = b0 * x[i] + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2;
      x2 = x1;
      x1 = x[i];
      y2 = y1;
      y1 = v;
      y[i] = v;
    }
    x = y;
  }
  return x;
}
const octave = (data, f) => butter(butter(data, f / Math.SQRT2, true), f * Math.SQRT2, false);
const energy = (d, from = 0, to = d.length) => {
  let e = 0;
  for (let i = from; i < to; i++) e += d[i] * d[i];
  return e;
};
function rt60(sig) {
  const tail = sig.map((v) => v * v);
  for (let i = tail.length - 2; i >= 0; i--) tail[i] += tail[i + 1];
  let n = 0,
    sx = 0,
    sy = 0,
    sxx = 0,
    sxy = 0;
  for (let i = 0; i < sig.length; i++) {
    const level = 10 * Math.log10(tail[i] / tail[0]);
    if (level > -5) continue;
    if (level < -25) {
      const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
      return n < 10 ? NaN : -60 / slope;
    }
    const x = i / RATE;
    n++;
    sx += x;
    sy += level;
    sxx += x * x;
    sxy += x * level;
  }
  return NaN;
}

function measure(Processor, spec) {
  const longest = spec.decay * Math.max(1, spec.lowDecay);
  const seconds = Math.min(60, 1.5 + 0.75 * longest + 0.0539 * spec.size * 2);
  const out = render(Processor, spec, seconds);
  const { low, high } = bands(spec.lowCross);
  const result = { finite: true, peak: 0 };
  for (const c of out)
    for (const v of c) {
      if (!Number.isFinite(v)) result.finite = false;
      result.peak = Math.max(result.peak, Math.abs(v));
    }
  const lo = octave(out[0], low),
    hi = octave(out[0], high);
  Object.assign(result, { lowRt: rt60(lo), highRt: rt60(hi), lowE: energy(lo), highE: energy(hi) });
  result.eL = energy(out[0]);
  result.eR = energy(out[1]);
  // The last half second, against the whole: a tail that grew would end loud.
  const n = out[0].length;
  result.endE = energy(out[0], n - RATE / 2) + energy(out[1], n - RATE / 2);
  return result;
}

function run([bundleArg, part = '0/1']) {
  const Processor = load(
    bundleArg && bundleArg !== '-'
      ? bundleArg
      : new URL('packages/engine/src/worklet/generated/retro-reverb-processor.js', root),
  );
  const [shard, shards] = part.split('/').map(Number);
  let index = 0;
  for (const size of GRID.size)
    for (const decay of GRID.decay)
      for (const tone of GRID.tone)
        for (const lowCross of GRID.lowCross) {
          if (index++ % shards !== shard) continue;
          for (const density of [0, 1])
            for (const driftDepth of [0, 1]) {
              const base = { size, decay, tone, lowCross, density, driftDepth, driftRate: 0.5 };
              const row = { ...base, at: {} };
              for (const lowDecay of [0.25, 1, 4]) {
                row.at[lowDecay] = measure(Processor, { ...base, lowDecay });
                if (lowDecay !== 1)
                  row.at[`ref${lowDecay}`] = measure(Processor, {
                    ...base,
                    decay: decay * lowDecay,
                    lowDecay: 1,
                  });
              }
              console.log(JSON.stringify(row));
            }
        }
}

// The tank's lines (seconds at Size 1) and clock, for the prediction below.
const LINES = [0.0311, 0.0377, 0.0433, 0.0539];
const CLOCK = 23437.5;
/**
 * Today's tank's RT60 at f: the four lines' per-pass loss (their decay gain and Tone's one-pole)
 * summed over their summed length. A band reads where today's tank measures within 15 % of it.
 */
function predict({ size, decay, tone }, f) {
  const w = (2 * Math.PI * f) / CLOCK;
  const p = 1 - Math.exp((-2 * Math.PI * tone) / CLOCK);
  const toneGain = p / Math.hypot(1 - (1 - p) * Math.cos(w), (1 - p) * Math.sin(w));
  let loss = 0,
    seconds = 0;
  for (const t of LINES) {
    loss += -20 * Math.log10(0.001 ** ((t * size) / decay) * toneGain);
    seconds += t * size;
  }
  return (60 * seconds) / loss;
}

function summary(files) {
  const rows = files.flatMap((f) =>
    readFileSync(f, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l)),
  );
  const db = (r) => 10 * Math.log10(r);
  const key = (r) => `${r.size}/${r.decay}/${r.tone}/${r.lowCross}/${r.driftDepth}`;
  const quiet = new Map(rows.filter((r) => r.density === 0).map((r) => [key(r), r]));
  const groups = new Map();
  const outliers = [];
  const counts = { low: 0, high: 0, lowSkipped: 0, highSkipped: 0 };
  for (const r of rows)
    for (const ld of [0.25, 4]) {
      const g = groups.get(`${ld}|${r.lowCross}`) ?? { low: [], high: [], lowE: [], highE: [], dens: [] };
      groups.set(`${ld}|${r.lowCross}`, g);
      const at = r.at[ld],
        one = r.at[1],
        ref = r.at[`ref${ld}`];
      const { low, high } = bands(r.lowCross);
      const longest = 6 * 0.0539 * r.size;
      // The low octave holds at least one of the tank's modes (about 0.166 × Size a hertz).
      const modes = 0.0884 * r.lowCross * 0.166 * r.size;
      const lowPredicted = predict({ ...r, decay: r.decay * ld }, low);
      const highPredicted = predict(r, high);
      const lowReads =
        modes >= 1 &&
        Math.abs(ref.lowRt / lowPredicted - 1) < 0.15 &&
        lowPredicted > Math.max(0.4, longest);
      const highReads =
        Math.abs(one.highRt / highPredicted - 1) < 0.15 && highPredicted > Math.max(0.4, longest);
      const tag = `Size ${r.size}, Decay ${r.decay}, Tone ${r.tone}, Low cross ${r.lowCross}, Density ${r.density}, Drift ${r.driftDepth}, Low decay ${ld}`;
      if (lowReads) {
        counts.low++;
        g.low.push(at.lowRt / ref.lowRt);
        g.lowE.push(db(at.lowE / ref.lowE));
        if (Math.abs(at.lowRt / ref.lowRt - 1) > 0.1)
          outliers.push(`low: ${tag}: ${at.lowRt.toFixed(2)} s against ${ref.lowRt.toFixed(2)} s`);
      } else counts.lowSkipped++;
      if (highReads) {
        counts.high++;
        g.high.push(at.highRt / one.highRt);
        g.highE.push(db(at.highE / one.highE));
        if (Math.abs(at.highRt / one.highRt - 1) > 0.1)
          outliers.push(`high: ${tag}: ${at.highRt.toFixed(2)} s against ${one.highRt.toFixed(2)} s`);
      } else counts.highSkipped++;
      if (r.density === 1)
        for (const c of ['eL', 'eR']) g.dens.push(db(at[c] / quiet.get(key(r)).at[ld][c]));
    }
  const range = (a, f = 3) =>
    a.length ? `${Math.min(...a).toFixed(f)} to ${Math.max(...a).toFixed(f)}` : '—';
  console.log(
    '| Low decay | Low cross | low RT60 / reference (n) | high RT60 / Low decay 1 (n) | low energy / reference (dB) | high energy / Low decay 1 (dB) | Density 1 / 0, L and R (dB) |',
  );
  console.log('|---|---|---|---|---|---|---|');
  for (const [g, s] of [...groups].sort()) {
    const [ld, cross] = g.split('|');
    console.log(
      `| ${ld} | ${cross} | ${range(s.low)} (${s.low.length}) | ${range(s.high)} (${s.high.length}) | ${range(s.lowE, 2)} | ${range(s.highE, 2)} | ${range(s.dens, 2)} |`,
    );
  }
  console.log(JSON.stringify(counts));
  console.log(outliers.join('\n'));
  let bad = 0,
    peak = 0;
  for (const r of rows)
    for (const m of Object.values(r.at)) {
      if (!m.finite || m.endE > 0.5 * (m.eL + m.eR)) bad++;
      peak = Math.max(peak, m.peak);
    }
  console.log(`renders not finite or growing: ${bad}; largest peak ${peak.toFixed(4)}`);
}

if (mode === 'run') run(rest);
else summary(rest);
