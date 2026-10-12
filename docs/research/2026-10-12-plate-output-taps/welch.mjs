// Third-octave band Grams by Welch's method (windsor#766): for rows y_i, each
// band's B_ij = Σ_f |H_band(f)|² Re(Y_i(f) Y_j(f)*), averaged over Hann
// segments, where H_band is the cascade `measure.mjs`'s `thirdEnergy` filters
// with (two RBJ lowpasses a sixth of an octave above the centre, two
// highpasses a sixth below). So the energy of any weighted sum Σ g_i y_i in a
// band is gᵀ B g, up to one scale shared by every table, for the optimiser.

const SEGMENT = 8192;
const HOP = SEGMENT / 2;

function fftInPlace(re, im) {
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
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    const wr = Math.cos(angle);
    const wi = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const next = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = next;
      }
    }
  }
}

/** |H(f)|² of one RBJ biquad at Q 1/√2, as `measure.mjs` builds it. */
function biquadPower(kind, hz, f, rate) {
  const w = (2 * Math.PI * hz) / rate;
  const cos = Math.cos(w);
  const alpha = Math.sin(w) / Math.SQRT2;
  const edge = kind === 'lp' ? (1 - cos) / 2 : (1 + cos) / 2;
  const b = [edge, kind === 'lp' ? 2 * edge : -2 * edge, edge];
  const a = [1 + alpha, -2 * cos, 1 - alpha];
  const x = (2 * Math.PI * f) / rate;
  const at = (c) => {
    const r = c[0] + c[1] * Math.cos(x) + c[2] * Math.cos(2 * x);
    const i = -c[1] * Math.sin(x) - c[2] * Math.sin(2 * x);
    return r * r + i * i;
  };
  return at(b) / at(a);
}

function bandPower(centre, f, rate) {
  const low = centre / 2 ** (1 / 6);
  const high = centre * 2 ** (1 / 6);
  return (
    biquadPower('lp', high, f, rate) ** 2 * biquadPower('hp', low, f, rate) ** 2
  );
}

/** Each band's Gram (row-major n × n) over `rows`, for band centres `centres`. */
export function welchBands(rows, rate, centres) {
  const n = rows.length;
  const bins = SEGMENT / 2;
  const weights = centres.map((c) => Float64Array.from({ length: bins }, (_, k) => bandPower(c, (k * rate) / SEGMENT, rate)));
  const used = [];
  for (let k = 1; k < bins; k++) if (weights.some((w) => w[k] > 1e-6)) used.push(k);
  const pairs = (n * (n + 1)) / 2;
  const csd = new Float64Array(pairs * used.length);
  const window = Float64Array.from({ length: SEGMENT }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / SEGMENT));
  const re = rows.map(() => new Float64Array(SEGMENT));
  const im = rows.map(() => new Float64Array(SEGMENT));
  const length = rows[0].length;
  for (let start = 0; start + SEGMENT <= length; start += HOP) {
    for (let r = 0; r < n; r++) {
      const row = rows[r];
      for (let i = 0; i < SEGMENT; i++) {
        re[r][i] = row[start + i] * window[i];
        im[r][i] = 0;
      }
      fftInPlace(re[r], im[r]);
    }
    let p = 0;
    for (let i = 0; i < n; i++) {
      for (let j = i; j < n; j++, p++) {
        const ri = re[i];
        const ii = im[i];
        const rj = re[j];
        const ij = im[j];
        const base = p * used.length;
        for (let u = 0; u < used.length; u++) {
          const k = used[u];
          csd[base + u] += ri[k] * rj[k] + ii[k] * ij[k];
        }
      }
    }
  }
  return weights.map((w) => {
    const g = new Float64Array(n * n);
    let p = 0;
    for (let i = 0; i < n; i++) {
      for (let j = i; j < n; j++, p++) {
        let s = 0;
        const base = p * used.length;
        for (let u = 0; u < used.length; u++) s += w[used[u]] * csd[base + u];
        g[i * n + j] = g[j * n + i] = s;
      }
    }
    return g;
  });
}
