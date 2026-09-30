/** Original Windsor measurement of the phase-3 FIR pair (windsor#207), identity core.
 * Impulse responses are captured through the unchanged ResampledHysteresis and read
 * with an exact DTFT; tones use coherent rectangular windows and a direct DFT, so
 * no FFT is needed. The decimator alone is driven through a stand-in core object
 * that returns an injected oversampled signal. Offline only; allocation is intended.
 */
import { coefficients, ResampledHysteresis } from '../2026-09-30-tape-phase-3/resampler';
import { RESAMPLER as R, filterId, type Filter, type Resampler } from './resamplerConstants';

export type Complex = [number, number];
const TAU = 2 * Math.PI;
export const abs = ([re, im]: Complex): number => Math.hypot(re, im);
export const db = (amplitude: number, table: Resampler = R): number =>
  20 * Math.log10(Math.max(table.amplitudeFloor, amplitude));
const divide = ([a, b]: Complex, [c, d]: Complex): Complex => {
  const m = c * c + d * d;
  return [(a * c + b * d) / m, (b * c - a * d) / m];
};

/** DTFT of a real sequence at f cycles per sample. */
export function dtft(x: ArrayLike<number>, f: number): Complex {
  let re = 0,
    im = 0;
  for (let n = 0; n < x.length; n++) {
    re += x[n] * Math.cos(TAU * f * n);
    im -= x[n] * Math.sin(TAU * f * n);
  }
  return [re, im];
}

/** Direct DFT of bins from…to of a coherent window, scaled to peak amplitude. */
export function dft(x: ArrayLike<number>, from: number, to = from): Complex[] {
  const n = x.length,
    cos = new Float64Array(n),
    sin = new Float64Array(n),
    out: Complex[] = [];
  for (let i = 0; i < n; i++) [cos[i], sin[i]] = [Math.cos((TAU * i) / n), Math.sin((TAU * i) / n)];
  for (let k = from; k <= to; k++) {
    let re = 0,
      im = 0;
    for (let i = 0, j = 0; i < n; i++, j = j + k >= n ? j + k - n : j + k) {
      re += x[i] * cos[j];
      im -= x[i] * sin[j];
    }
    const scale = k === 0 || 2 * k === n ? 1 / n : 2 / n;
    out.push([re * scale, im * scale]);
  }
  return out;
}

/** Largest bin of from…to: its bin and peak amplitude. */
export function peak(
  x: ArrayLike<number>,
  from: number,
  to: number,
): { bin: number; amplitude: number } {
  const bins = dft(x, from, to).map(abs),
    i = bins.indexOf(Math.max(...bins));
  return { bin: from + i, amplitude: bins[i] };
}

export interface RunOptions extends Filter {
  frames: number;
  settle: number;
  input?: (n: number) => number;
  /** Replace the core: the decimator then reads this oversampled signal. */
  inject?: (m: number) => number;
}
/** One identity-core render; `up` is the interpolator output, `host` the pair's. */
export function run(o: RunOptions, table: Resampler = R): { up: Float64Array; host: Float64Array } {
  const { factor, span, frames, settle, input, inject } = o;
  const dsp = new ResampledHysteresis({ rate: table.rate, factor, span, identity: !inject });
  if (inject) {
    let m = 0;
    (dsp as unknown as { core: { tick(): number } }).core = { tick: () => inject(m++) };
  }
  const up = new Float64Array(frames * factor),
    host = new Float64Array(frames),
    length = dsp.output.length;
  for (let n = 0; n < settle + frames; n++) {
    const start = dsp.outputCursor,
      y = dsp.tick(input ? input(n) : 0),
      k = n - settle;
    if (k < 0) continue;
    host[k] = y;
    for (let p = 0; p < factor; p++) up[k * factor + p] = dsp.output[(start + p) % length];
  }
  return { up, host };
}

/** Interpolator (gain-normalised), decimator and host-rate cascade impulse responses. */
export function impulseResponses(f: Filter, table: Resampler = R) {
  const taps = f.span * f.factor + 1,
    impulse = (n: number) => (n === 0 ? 1 : 0);
  const up = run({ ...f, frames: f.span + 1, settle: 0, input: impulse }, table).up;
  const interpolator = up.slice(0, taps).map((v) => v / f.factor);
  const decimator = new Float64Array(taps);
  for (let j = 0; j < f.factor; j++) {
    const { host } = run({ ...f, frames: f.span + 2, settle: 0, inject: (m) => +(m === j) }, table);
    host.forEach((v, n) => {
      if (n * f.factor - j >= 0 && n * f.factor - j < taps) decimator[n * f.factor - j] = v;
    });
  }
  const cascade = run({ ...f, frames: 2 * f.span + 2, settle: 0, input: impulse }, table).host;
  return { interpolator, decimator, cascade };
}

/** Coefficient facts: largest mirrored difference and the sum's error from 1. */
export function symmetry(taps: ArrayLike<number>, table: Resampler = R) {
  let asymmetry = 0,
    sum = 0;
  for (let i = 0; i < taps.length; i++) {
    asymmetry = Math.max(asymmetry, Math.abs(taps[i] - taps[taps.length - 1 - i]));
    sum += taps[i];
  }
  const sumError = sum - 1;
  return {
    asymmetry,
    sumError,
    symmetric: taps.length % 2 === 1 && asymmetry <= table.symmetryTolerance,
    unitSum: Math.abs(sumError) <= table.sumTolerance,
    exactlySymmetric: asymmetry === 0,
  };
}

export const maxDifference = (a: ArrayLike<number>, b: ArrayLike<number>): number =>
  Array.from(a, (v, i) => Math.abs(v - b[i])).reduce(
    (m, d) => Math.max(m, d),
    a.length === b.length ? 0 : Infinity,
  );

/** Passband scan 0…passbandEdge host fs: the extreme gains and the ±deviation. */
export function passband(gainDb: (fh: number) => number, table: Resampler = R) {
  let minDb = Infinity,
    maxDb = -Infinity;
  for (let i = 0; i < table.passbandPoints; i++) {
    const g = gainDb((table.passbandEdge * i) / (table.passbandPoints - 1));
    [minDb, maxDb] = [Math.min(minDb, g), Math.max(maxDb, g)];
  }
  return { minDb, maxDb, deviationDb: Math.max(-minDb, maxDb) };
}

/** First host frequency below each threshold: scan at the passband step, then bisect. */
export function irEdges(gainDb: (fh: number) => number, table: Resampler = R): (number | null)[] {
  const step = table.passbandEdge / (table.passbandPoints - 1);
  return table.edgesDb.map((threshold) => {
    for (let i = 1; i * step <= 0.5; i++) {
      if (gainDb(i * step) >= threshold) continue;
      let [lo, hi] = [(i - 1) * step, i * step];
      for (let b = 0; b < table.edgeBisections; b++) {
        const mid = (lo + hi) / 2;
        if (gainDb(mid) < threshold) hi = mid;
        else lo = mid;
      }
      return (lo + hi) / 2;
    }
    return null;
  });
}

/** Bisection over tone bins below host Nyquist, then linear interpolation in dB. */
export function toneEdge(
  gainDb: (bin: number) => number,
  threshold: number,
  bins: number,
): number | null {
  let lo = 0,
    hi = bins / 2 - 1;
  if (!(gainDb(hi) < threshold)) return null;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (gainDb(mid) < threshold) hi = mid;
    else lo = mid;
  }
  const [a, b] = [gainDb(lo), gainDb(hi)];
  return (lo + (a - threshold) / (a - b)) / bins;
}

/** Complex gains of a coherent cosine at `bin` of `frames`: interpolator and cascade. */
export function toneGain(f: Filter, bin: number, frames: number, table: Resampler = R) {
  const input = (n: number) => Math.cos((TAU * ((bin * n) % frames)) / frames);
  const { up, host } = run({ ...f, frames, settle: table.settleFrames, input }, table);
  const x = dft(
    Float64Array.from({ length: frames }, (_, i) => input(i + table.settleFrames)),
    bin,
  )[0];
  return { up, interpolator: divide(dft(up, bin)[0], x), cascade: divide(dft(host, bin)[0], x) };
}

export const binOf = (fraction: number, frames: number): number => {
  const bin = Math.round(fraction * frames);
  if (Math.abs(bin - fraction * frames) > 1e-9)
    throw Error(`${fraction} is not a bin of ${frames}`);
  return bin;
};

/** In-band image bins k·L ± b of a host tone at bin b, k = 1 … factor − 1. */
export function imageBins(b: number, factor: number, frames: number): number[] {
  const bins: number[] = [];
  for (let k = 1; k < factor; k++)
    for (const q of [k * frames - b, k * frames + b])
      if (q > frames / 2 && q <= (frames * factor) / 2) bins.push(q);
  return bins;
}

/** Worst interpolator image per declared tone, relative to the tone: IR and tone. */
export function images(f: Filter, interpolator: Float64Array, table: Resampler = R) {
  const L = table.toneFrames,
    n = L * f.factor;
  return table.tones.map((tone) => {
    const b = binOf(tone, L),
      { up } = toneGain(f, b, L, table),
      found = peak(up, L / 2 + 1, n / 2),
      irTone = abs(dtft(interpolator, b / n));
    const ir = imageBins(b, f.factor, L).map((q) => ({
      image: q / L,
      db: db(abs(dtft(interpolator, q / n)) / irTone, table),
    }));
    const worst = ir.reduce((w, x) => (x.db > w.db ? x : w));
    return {
      tone,
      irDb: worst.db,
      irImage: worst.image,
      toneDb: db(found.amplitude / abs(dft(up, b)[0]), table),
      toneImage: found.bin / L,
    };
  });
}

/** Decimator alone: a unit oversampled cosine at every image; the leaked host peak. */
export function aliases(f: Filter, decimator: Float64Array, table: Resampler = R) {
  const L = table.toneFrames,
    n = L * f.factor;
  return table.tones.flatMap((tone) =>
    imageBins(binOf(tone, L), f.factor, L).map((q) => {
      const inject = (m: number) => Math.cos((TAU * ((q * m) % n)) / n);
      const { host } = run({ ...f, frames: L, settle: table.settleFrames, inject }, table);
      const found = peak(host, 0, L / 2);
      return {
        tone,
        image: q / L,
        irDb: db(abs(dtft(decimator, q / n)), table),
        toneDb: db(found.amplitude, table),
        leak: found.bin / L,
      };
    }),
  );
}

/** Passband sweep and edges by direct tone; cascade delay from each tone's phase. */
export function toneResponse(f: Filter, table: Resampler = R) {
  const L = table.toneFrames;
  const sweep = Array.from({ length: table.passbandTones }, (_, i) => {
    const fh = (table.passbandEdge * (i + 1)) / table.passbandTones,
      g = toneGain(f, binOf(fh, L), L, table),
      theta = TAU * fh * f.span,
      [re, im] = g.cascade;
    const residual = Math.atan2(
      re * Math.sin(theta) + im * Math.cos(theta),
      re * Math.cos(theta) - im * Math.sin(theta),
    );
    return {
      fh,
      interpolatorDb: db(abs(g.interpolator), table),
      cascadeDb: db(abs(g.cascade), table),
      delayError: -residual / (TAU * fh),
    };
  });
  const cache = new Map<number, { interpolator: number; cascade: number }>();
  const at = (bin: number) => {
    if (!cache.has(bin)) {
      const g = toneGain(f, bin, table.edgeFrames, table);
      cache.set(bin, {
        interpolator: db(abs(g.interpolator), table),
        cascade: db(abs(g.cascade), table),
      });
    }
    return cache.get(bin)!;
  };
  const figures = (key: 'interpolator' | 'cascade') => ({
    deviationDb: Math.max(...sweep.map((s) => Math.abs(s[`${key}Db`]))),
    edges: table.edgesDb.map((t) => toneEdge((bin) => at(bin)[key], t, table.edgeFrames)),
  });
  const maxDelayError = Math.max(...sweep.map((s) => Math.abs(s.delayError)));
  return {
    interpolator: figures('interpolator'),
    cascade: { ...figures('cascade'), maxDelayError },
    sweep,
  };
}

/** Cascade delay from its host impulse response: peak, centroid, mirror about span. */
export function cascadeDelay(g: Float64Array, span: number, table: Resampler = R) {
  let weighted = 0,
    sum = 0,
    asymmetry = 0;
  g.forEach((v, n) => {
    weighted += n * v;
    sum += v;
    asymmetry = Math.max(asymmetry, Math.abs(v - (g[2 * span - n] ?? 0)));
  });
  const peakIndex = g.indexOf(Math.max(...g)),
    centroid = weighted / sum;
  const matches = peakIndex === span && Math.abs(centroid - span) <= table.delayTolerance;
  return { peakIndex, centroid, asymmetry, matches };
}

/** Part 1's record for one filter: every figure by both methods. */
export function measureFilter(f: Filter, table: Resampler = R) {
  const ir = impulseResponses(f, table),
    taps = coefficients(f.factor, f.span);
  const interpolatorDb = (fh: number) => db(abs(dtft(ir.interpolator, fh / f.factor)), table);
  const cascadeDb = (fh: number) => db(abs(dtft(ir.cascade, fh)), table);
  return {
    id: filterId(f),
    ...f,
    taps: taps.length,
    coefficients: symmetry(taps, table),
    capturedMinusCoefficients: {
      interpolator: maxDifference(ir.interpolator, taps),
      decimator: maxDifference(ir.decimator, taps),
    },
    groupDelay: { oversampled: (taps.length - 1) / 2, host: (taps.length - 1) / 2 / f.factor },
    ir: {
      interpolator: { ...passband(interpolatorDb, table), edges: irEdges(interpolatorDb, table) },
      cascade: {
        ...passband(cascadeDb, table),
        edges: irEdges(cascadeDb, table),
        ...cascadeDelay(ir.cascade, f.span, table),
      },
    },
    tone: toneResponse(f, table),
    images: images(f, ir.interpolator, table),
    aliases: aliases(f, ir.decimator, table),
    gridDb: Array.from({ length: table.grid }, (_, i) =>
      Number(interpolatorDb((f.factor * i) / (2 * (table.grid - 1))).toFixed(table.gridDecimals)),
    ),
  };
}
