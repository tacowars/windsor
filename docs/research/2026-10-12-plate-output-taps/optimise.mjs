/* global process, console */
// The gains and signs for a time layout (windsor#766). `capture.mjs` renders
// a layout once per case; here every criterion is read from the captures for
// any gains, so a hill climb over each tap's sign and magnitude (full or
// three-quarters) costs no render. The score is the least margin over the
// criteria against `main` (each in dB, or in hundredths of correlation),
// capped at 1, plus a share of the mean early-density gain; the climb flips
// one sign or magnitude at a time while the score rises. `search.mjs`'s real
// renders confirm whatever this keeps.
// node optimise.mjs <new bundle> <first seed> <count> '<draw options json>' [restarts]
import { BUILDS, captureLayout, SIZES, WINDOWS } from './capture.mjs';
import { drawTable, HALVES } from './candidates.mjs';

/** `main`'s table (94a14d6): Dattorro's table 2, its signs, trim 0.6. */
export const MAIN = {
  perSide: 7,
  time: [
    0.008937872, 0.099929438, 0.064278754, 0.067067639, 0.066866033, 0.006283391, 0.035818689,
    0.011861161, 0.121870905, 0.041262054, 0.08981553, 0.070931756, 0.011256342, 0.004065724,
  ],
  line: [9, 9, 10, 11, 5, 6, 7, 5, 5, 6, 7, 9, 10, 11],
  gain: [1, 1, -1, 1, -1, -1, -1, 1, 1, -1, 1, -1, -1, -1],
  trim: 0.6,
};

const db = (r) => 10 * Math.log10(r);

/** aᵀ G b over the rows where a and b are not 0 (a bank's weights are mostly 0). */
function quad(g, n, a, b) {
  const ai = [];
  const bi = [];
  for (let i = 0; i < n; i++) {
    if (a[i] !== 0) ai.push(i);
    if (b[i] !== 0) bi.push(i);
  }
  let s = 0;
  for (const i of ai) {
    let row = 0;
    for (const j of bi) row += g[i * n + j] * b[j];
    s += a[i] * row;
  }
  return s;
}

/** Each output's weight vector over the capture rows (taps, then the two direct paths). */
function vectors(gains, perSide) {
  const n = gains.length + 2;
  const vL = new Float64Array(n);
  const vR = new Float64Array(n);
  for (let t = 0; t < gains.length; t++) (t < perSide ? vL : vR)[t] = gains[t];
  vL[n - 2] = 1;
  vR[n - 1] = 1;
  return { vL, vR, n };
}

/**
 * The early-density count of one cell's capture at weights `vL` and `vR`
 * (trim-free: a count against the peak), and the centred click's L/R balance.
 */
function density(rows, vL, vR, rate) {
  let peak = 0;
  const outs = [vL, vR].map((v) => {
    const out = new Float64Array(rows[0].length);
    for (let r = 0; r < v.length; r++) {
      const g = v[r];
      if (g === 0) continue;
      const y = rows[r];
      for (let i = 0; i < out.length; i++) out[i] += g * y[i];
    }
    return out;
  });
  for (const out of outs) for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]));
  const floor = peak / 100;
  const to = Math.round(0.1 * rate);
  let count = 0;
  for (const out of outs) for (let i = 0; i < to; i++) if (Math.abs(out[i]) >= floor) count++;
  // The click's balance over its first second, L over R in dB.
  const energy = outs.map((out) => out.reduce((sum, x) => sum + x * x, 0));
  return { count, balance: 10 * Math.log10(energy[0] / energy[1]) };
}

/**
 * T30 against Decay, as a fraction, from a cell's binned energy: the
 * Schroeder integral, and a least-squares line through its −5 to −35 dB span,
 * as the harness's `t30` reads it sample by sample.
 */
function t30Of(cell, n, vL, vR) {
  const e = cell.bins.map((g) => quad(g, n, vL, vL) + quad(g, n, vR, vR));
  const decay = new Float64Array(e.length);
  let sum = 0;
  for (let i = e.length - 1; i >= 0; i--) decay[i] = sum += e[i];
  let [st, sd, stt, std, count] = [0, 0, 0, 0, 0];
  for (let i = 0; i < e.length; i++) {
    const d = 10 * Math.log10(decay[i] / decay[0]);
    if (d > -5) continue;
    if (d < -35) return -60 / ((count * std - st * sd) / (count * stt - st * st)) / cell.decay - 1;
    const t = i * cell.bin;
    [st, sd, stt, std, count] = [st + t, sd + d, stt + t * t, std + t * d, count + 1];
  }
  return NaN;
}

/** Every figure the criteria read, at `gains` and `trim` (a trim of null matches `ref`'s level). */
export function figures(cap, gains, perSide, ref = null, trim = 0.6) {
  const { vL, vR } = vectors(gains, perSide);
  return figuresAt(cap, vL, vR, ref, trim);
}

/** `figures` at explicit weights over the capture's rows (taps, then the two direct paths). */
export function figuresAt(cap, vL, vR, ref = null, trim = 0.6) {
  const n = vL.length;
  const level1 = cap.level.map((g) => Math.sqrt((quad(g, n, vL, vL) + quad(g, n, vR, vR)) / (2 * cap.rate)));
  const t = ref
    ? Math.exp(level1.reduce((s, l, i) => s + Math.log(ref.level[i] / l), 0) / level1.length)
    : trim;
  const vM = vL.map((x, i) => (x + vR[i]) / 2);
  return {
    trim: t,
    level: level1.map((l) => l * t),
    ...(() => {
      const cells = cap.density.map((rows) => density(rows, vL, vR, cap.rate));
      return { density: cells.map((c) => c.count), balance: cells.map((c) => c.balance) };
    })(),
    sides: cap.sides.map((cell) => {
      const eL = (side, w) => quad(cell[side][w], n, vL, vL);
      const eR = (side, w) => quad(cell[side][w], n, vR, vR);
      return {
        leadL: WINDOWS.map((_, w) => db(eL('left', w) / eR('left', w))),
        leadR: WINDOWS.map((_, w) => db(eR('right', w) / eL('right', w))),
        mirror: WINDOWS.map((_, w) => db(eL('left', w) / eR('right', w))),
      };
    }),
    t30: cap.t30.map((cell) => t30Of(cell, n, vL, vR)),
    noise: cap.noise.map((z) => {
      const l = quad(z.all, n, vL, vL);
      const r = quad(z.all, n, vR, vR);
      return {
        balance: 10 * Math.log10(l / r),
        corr: quad(z.all, n, vL, vR) / Math.sqrt(l * r),
        mono: Math.sqrt((quad(z.all, n, vM, vM) * t * t) / z.length),
        bands: z.bands.map((b) => quad(b, n, vM, vM) * t * t),
      };
    }),
  };
}

/** Each criterion's margin against `base` (positive passes), and the mean density gain. */
export function margins(fig, base, gains, perSide, lines) {
  const m = {};
  m.density = Math.min(...fig.density.map((d, i) => db(d / base.density[i])));
  m.corr = Math.min(...fig.noise.map((z, i) => (base.noise[i].corr - z.corr) * 100));
  m.monoTotal = Math.min(...fig.noise.map((z, i) => 1.5 - Math.abs(2 * db(z.mono / base.noise[i].mono))));
  m.monoBand = Math.min(
    ...fig.noise.flatMap((z, i) => z.bands.map((e, k) => db(e / base.noise[i].bands[k]) + 3)),
  );
  let lead = Infinity;
  let mirror = Infinity;
  fig.sides.forEach((cell, c) => {
    const b = base.sides[c];
    for (let w = 0; w < WINDOWS.length; w++) {
      for (const k of ['leadL', 'leadR']) {
        lead = Math.min(lead, b[k][w] > 300 ? (cell[k][w] > 300 ? 1 : -100) : cell[k][w] - b[k][w] + 0.5);
      }
      mirror = Math.min(mirror, Math.abs(b.mirror[w]) + 0.5 - Math.abs(cell.mirror[w]));
    }
  });
  // T30 within 10 % of Decay, or within main's own reading where main is
  // further out; 1 % is 0.1 of a margin.
  m.t30 = Math.min(
    ...fig.t30.map((d, i) => (Math.max(0.1, Math.abs(base.t30[i])) - Math.abs(d)) * 10),
  );
  // A centred source stays central: L over R within 1 dB, or within main's
  // own reading where main is further out, for the click cells and the noise.
  const centred = [...fig.balance, ...fig.noise.map((z) => z.balance)];
  const was = [...base.balance, ...base.noise.map((z) => z.balance)];
  m.balance = Math.min(...centred.map((b, i) => Math.max(1, Math.abs(was[i])) - Math.abs(b)));
  m.lead = lead;
  m.mirror = mirror;
  let share = Infinity;
  for (const side of [0, 1]) {
    let own = 0;
    let other = 0;
    for (let t = side * perSide; t < (side + 1) * perSide; t++) {
      if (HALVES[side].lines.includes(lines[t])) own += Math.abs(gains[t]);
      else other += Math.abs(gains[t]);
    }
    share = Math.min(share, own - other);
  }
  m.share = share;
  const gain = fig.density.reduce((s, d, i) => s + db(d / base.density[i]), 0) / fig.density.length;
  return { m, least: Math.min(...Object.values(m)), gain };
}

/**
 * Passing first: the least margin counts until every criterion clears it by
 * 0.25 dB, and the mean early-density gain only breaks ties beyond.
 */
export const score = (r) => Math.min(r.least, 0.25) + 0.02 * r.gain;

/** Hill-climb `gains` on `cap`: one sign or magnitude at a time, the best move each step. */
export function climb(cap, base, start, perSide, lines) {
  let gains = Float64Array.from(start);
  const evaluate = (g) => margins(figures(cap, g, perSide, base), base, g, perSide, lines);
  let best = evaluate(gains);
  for (;;) {
    let move = null;
    for (let t = 0; t < gains.length; t++) {
      for (const next of [-gains[t], Math.sign(gains[t]) * (Math.abs(gains[t]) === 1 ? 0.75 : 1)]) {
        const g = Float64Array.from(gains);
        g[t] = next;
        const r = evaluate(g);
        if (score(r) > score(move?.r ?? best) + 1e-9) move = { g, r };
      }
    }
    if (!move) return { gains, result: best };
    gains = move.g;
    best = move.r;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [file, firstArg, countArg, optsArg = '{}', restartsArg = '3'] = process.argv.slice(2);
  const opts = JSON.parse(optsArg);
  const mainCap = captureLayout(file, MAIN);
  const base = figures(mainCap, MAIN.gain, MAIN.perSide, null, MAIN.trim);
  const f = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : String(x));
  console.log(['seed', 'restart', 'least', 'gain', 'trim', 'density', 'corr', 'monoTotal', 'monoBand', 'lead', 'mirror', 'share', 'table'].join('\t'));
  for (let seed = Number(firstArg); seed < Number(firstArg) + Number(countArg); seed++) {
    const table = drawTable({ ...opts, seed });
    if (!table) continue;
    const cap = captureLayout(file, table);
    let state = seed * 7919;
    const rnd = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32);
    for (let r = 0; r < Number(restartsArg); r++) {
      const start = r === 0 ? table.gain : table.gain.map((g) => (rnd() < 0.5 ? -g : g));
      const { gains, result } = climb(cap, base, start, table.perSide, table.line);
      const fig = figures(cap, gains, table.perSide, base);
      const m = result.m;
      console.log(
        [
          seed,
          r,
          f(result.least),
          f(result.gain, 3),
          f(fig.trim, 4),
          f(m.density),
          f(m.corr),
          f(m.monoTotal),
          f(m.monoBand),
          f(m.lead),
          f(m.mirror),
          f(m.share),
          JSON.stringify({ ...table, gain: [...gains], trim: Number(fig.trim.toFixed(4)) }),
        ].join('\t'),
      );
    }
  }
}

export { BUILDS, SIZES };
