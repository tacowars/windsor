/* eslint-disable max-lines -- a research bench: every synthesis method is written out in full so each inner loop stays monomorphic, and the file is easier to read whole than split. */
// bloom cost micro-kernels. Plain JS, no allocation in quantum(), state in typed arrays, no Math
// transcendentals on the per-sample paths (Math.sqrt only), except the `mathsin` reference method.
//
// One configurable kernel, processed band-major: for each of the 48 bands, run its analysis over the
// quantum (state in locals), and if the band is one of the N forced "sounding" bands, synthesise its
// 128 samples straight away from the band's phasor. The real selection flags are still computed for
// every band, but the sounding set is forced so the cost of N bands can be measured directly.
//
// cfg = { ana: 'none' | 'full' | 'dec', D: 4 | 8, syn: 'none' | 'pow' | 'cheb' | 'clen' | 'table' |
//         'blep' | 'mathsin', N: 0..48, rebuild: false | true }

export const NB = 48; // bands, semitones F2 (MIDI 41) .. E6 (MIDI 88)
export const NP = 16; // partials
export const Q = 128; // quantum
export const TS = 2048; // wavetable size (plus one guard sample)
const TW = TS + 1;
const SYN = { none: 0, pow: 1, cheb: 2, clen: 3, table: 4, blep: 5, mathsin: 6 };
const TWO_PI = 2 * Math.PI;

export class Bloom {
  // eslint-disable-next-line max-lines-per-function -- one-off table and filter design for the bench, not a render path
  constructor(fs, cfg) {
    this.fs = fs;
    this.anaMode = cfg.ana === 'full' ? 1 : cfg.ana === 'dec' ? 2 : 0;
    this.D = this.anaMode === 2 ? cfg.D : 1;
    this.LD = Math.round(Math.log2(this.D));
    this.S = Q / this.D; // analysis steps per quantum
    this.syn = SYN[cfg.syn];
    this.N = cfg.N | 0;
    this.doRebuild = !!cfg.rebuild;
    const fr = fs / this.D; // analysis rate

    // ---- bands: 2-pole complex Butterworth band-pass, impulse-invariant, half-bandwidth 0.0192 f + 0.93 Hz
    const f = (this.fc = new Float64Array(NB));
    this.a1r = new Float64Array(NB); this.a1i = new Float64Array(NB);
    this.a2r = new Float64Array(NB); this.a2i = new Float64Array(NB);
    this.g0 = new Float64Array(NB);
    this.cLo = new Float64Array(NB); this.sLo = new Float64Array(NB);
    this.cHi = new Float64Array(NB); this.sHi = new Float64Array(NB);
    this.K = new Int32Array(NB);
    this.panL = new Float64Array(NB); this.panR = new Float64Array(NB);
    for (let b = 0; b < NB; b++) {
      f[b] = 440 * Math.pow(2, (41 + b - 69) / 12);
      const B = 0.0192 * f[b] + 0.93, wc = TWO_PI * B, T = 1 / fr, w0 = TWO_PI * f[b];
      // poles s = wc * (-1/sqrt2 +- j/sqrt2) + j w0 ; z = exp(s T)
      const re = -wc / Math.SQRT2;
      const p1r = Math.exp(re * T) * Math.cos((wc / Math.SQRT2 + w0) * T), p1i = Math.exp(re * T) * Math.sin((wc / Math.SQRT2 + w0) * T);
      const p2r = Math.exp(re * T) * Math.cos((-wc / Math.SQRT2 + w0) * T), p2i = Math.exp(re * T) * Math.sin((-wc / Math.SQRT2 + w0) * T);
      this.a1r[b] = p1r + p2r; this.a1i[b] = p1i + p2i;
      this.a2r[b] = -(p1r * p2r - p1i * p2i); this.a2i[b] = -(p1r * p2i + p1i * p2r);
      // gain: unity at the centre. H = 1 / (1 - a1 e^-jw - a2 e^-2jw)
      const w = w0 * T, c1 = Math.cos(w), s1 = -Math.sin(w), c2 = Math.cos(2 * w), s2 = -Math.sin(2 * w);
      const dr = 1 - (this.a1r[b] * c1 - this.a1i[b] * s1) - (this.a2r[b] * c2 - this.a2i[b] * s2);
      const di = -(this.a1r[b] * s1 + this.a1i[b] * c1) - (this.a2r[b] * s2 + this.a2i[b] * c2);
      this.g0[b] = Math.hypot(dr, di);
      const wl = (TWO_PI * f[b] * Math.pow(2, -1 / 24)) / fr, wh = (TWO_PI * f[b] * Math.pow(2, 1 / 24)) / fr;
      this.cLo[b] = Math.cos(wl); this.sLo[b] = Math.sin(wl); this.cHi[b] = Math.cos(wh); this.sHi[b] = Math.sin(wh);
      this.K[b] = Math.max(1, Math.min(NP, Math.floor(fs / 2 / f[b]))); // band-limit (ratio 1)
      const side = b & 1 ? 1 : -1; // Spread 100 %
      this.panL[b] = Math.cos((Math.PI / 4) * (1 + side)); this.panR[b] = Math.sin((Math.PI / 4) * (1 + side));
    }
    this.selA = 1 - Math.exp(-1 / (0.004 * fr)); // 4 ms selection smoothing

    // ---- band state
    this.y1r = new Float64Array(NB); this.y1i = new Float64Array(NB);
    this.y2r = new Float64Array(NB); this.y2i = new Float64Array(NB);
    this.dsr = new Float64Array(NB); this.dsi = new Float64Array(NB);
    this.flag = new Float64Array(NB);
    this.uc = new Float64Array(NB).fill(1); this.us = new Float64Array(NB); // previous unit phasor
    this.cf = new Float64Array(NB); this.amp = new Float64Array(NB); // ceiling follower, amplitude
    this.ph = new Float64Array(NB); this.phPrev = new Float64Array(NB); // phase (cycles)
    this.zr = new Float64Array(Q + 1); this.zi = new Float64Array(Q + 1); // band scratch, [0] = previous
    this.mask = new Uint8Array(NB);
    for (let i = 0; i < this.N; i++) this.mask[Math.min(NB - 1, Math.round(((i + 0.5) * NB) / this.N - 0.5))] = 1;
    this.ceil = Math.pow(10, -12.8 / 20);
    this.relStep = Math.exp(-1 / (0.1 * fr)); // ceiling follower release, per analysis step

    // ---- decimator / detector FIR: Blackman-windowed sinc at 1.7 kHz. 32 taps per 48 kHz (enough
    // stop band for a 12 kHz analysis rate), and at least 8 per decimation step (D = 8 at 48 kHz).
    const T = (this.T = Math.max(Math.round((32 * fs) / 48000), 8 * this.D));
    this.taps = new Float64Array(T);
    let sum = 0;
    for (let i = 0; i < T; i++) {
      const n = i - (T - 1) / 2, x = (TWO_PI * 1700) / fs;
      const sinc = n === 0 ? x / Math.PI : Math.sin(x * n) / (Math.PI * n);
      const win = 0.42 - 0.5 * Math.cos((TWO_PI * i) / (T - 1)) + 0.08 * Math.cos((2 * TWO_PI * i) / (T - 1));
      this.taps[i] = sinc * win; sum += this.taps[i];
    }
    for (let i = 0; i < T; i++) this.taps[i] /= sum;
    this.ring = new Float64Array(2 * T); this.pos = 0;
    this.xd = new Float64Array(Q + 1); // detector-rate input (decimated, or full)
    this.g = new Float64Array(Q + 1); // shared gain per analysis step
    // detector: hold 100 ms, attack 20 ms, release 100 ms, ratio 1.8, threshold 0.001 (log2 domain)
    this.det = new Float64Array(4); // pk, hold count, env, spare
    this.holdN = Math.round(0.1 * fr); this.att = 1 - Math.exp(-1 / (0.02 * fr)); this.rel = 1 - Math.exp(-1 / (0.1 * fr));
    this.thr = Math.log2(0.001); this.slope = 1 / 1.8 - 1;
    this.f64 = new Float64Array(1); this.i32 = new Int32Array(this.f64.buffer);

    // ---- partial weights (saw) and wavetables: 16 cumulative levels, level K = partials 1..K
    this.w = new Float64Array(NP);
    for (let k = 1; k <= NP; k++) this.w[k - 1] = ((k & 1 ? 1 : -1) / k) * (2 / Math.PI);
    this.basis = new Float64Array(NP * TW);
    for (let k = 1; k <= NP; k++) for (let i = 0; i < TW; i++) this.basis[(k - 1) * TW + i] = Math.sin((TWO_PI * k * i) / TS);
    this.tab = new Float64Array(NP * TW);
    this.rebuildTables();

    // ---- input and output
    this.xin = new Float64Array(Q);
    this.osc = new Float64Array([1, 0, 1, 0, 1, 0]);
    this.rot = new Float64Array(6);
    [220, 277.18, 329.63].forEach((hz, i) => { this.rot[2 * i] = Math.cos((TWO_PI * hz) / fs); this.rot[2 * i + 1] = Math.sin((TWO_PI * hz) / fs); });
    this.outL = new Float64Array(Q); this.outR = new Float64Array(Q);
    this.dp = NaN; this.dp = 0;
  }

  rebuildTables() {
    const w = this.w, basis = this.basis, tab = this.tab;
    for (let i = 0; i < TW; i++) tab[i] = w[0] * basis[i];
    for (let k = 1; k < NP; k++) {
      const wk = w[k], o = k * TW, p = o - TW;
      for (let i = 0; i < TW; i++) tab[o + i] = tab[p + i] + wk * basis[o + i];
    }
  }

  // portable log2 / exp2 through the bits (inlined by V8; fields, not double args, would be stricter)
  log2(x) {
    const f = this.f64, i = this.i32;
    f[0] = x; const hi = i[1];
    const e = ((hi >>> 20) & 0x7ff) - 1023;
    i[1] = (hi & 0x000fffff) | 0x3ff00000;
    const m = f[0] - 1; // [0,1)
    return e + m * (1.4425449 + m * (-0.7181452 + m * (0.4575485 + m * (-0.2779042 + m * (0.121797 + m * -0.0258411)))));
  }
  exp2(y) {
    const n = Math.floor(y), t = y - n;
    const f = this.f64, i = this.i32;
    f[0] = 1 + t * (0.6931472 + t * (0.2402265 + t * (0.0555041 + t * (0.0096181 + t * (0.0013334 + t * 0.0001540)))));
    i[1] += n << 20;
    return f[0];
  }

  // shared detector on xd[1..n]: peak hold, attack/release, gain in log2 domain -> g[1..n]
  detector(n) {
    const xd = this.xd, g = this.g, d = this.det;
    let pk = d[0], hc = d[1], env = d[2];
    const holdN = this.holdN, att = this.att, rel = this.rel, thr = this.thr, slope = this.slope;
    for (let j = 1; j <= n; j++) {
      const a = xd[j] < 0 ? -xd[j] : xd[j];
      if (a >= pk) { pk = a; hc = holdN; } else if (hc > 0) hc--; else pk = a;
      env += (pk > env ? att : rel) * (pk - env);
      const L = this.log2(env + 1e-12);
      g[j] = L > thr ? this.exp2((L - thr) * slope) : 1;
    }
    d[0] = pk; d[1] = hc; d[2] = env;
  }

  quantum() {
    // input: three sines by rotation
    const xin = this.xin, o = this.osc, r = this.rot;
    for (let i = 0; i < Q; i++) {
      let s = 0;
      for (let v = 0; v < 6; v += 2) {
        const c = o[v] * r[v] - o[v + 1] * r[v + 1], sn = o[v] * r[v + 1] + o[v + 1] * r[v];
        o[v] = c; o[v + 1] = sn; s += sn;
      }
      xin[i] = 0.2 * s;
    }
    const L = this.outL, R = this.outR;
    for (let i = 0; i < Q; i++) { L[i] = 0; R[i] = 0; }
    if (this.doRebuild) this.rebuildTables();
    if (this.anaMode === 0) return;

    // FIR: full mode evaluates it every sample, dec mode every D-th sample (the decimator doubles
    // as the detector's 1.7 kHz low-pass)
    const D = this.D, T = this.T, ring = this.ring, taps = this.taps, xd = this.xd;
    let pos = this.pos, j = 0;
    for (let i = 0; i < Q; i++) {
      ring[pos] = xin[i]; ring[pos + T] = xin[i];
      pos = pos + 1 === T ? 0 : pos + 1;
      if ((i + 1) % D === 0) {
        let acc = 0;
        for (let t = 0; t < T; t++) acc += taps[t] * ring[pos + t];
        xd[++j] = acc;
      }
    }
    this.pos = pos;
    // full mode: band input is the raw input, detector input is the FIR output
    this.detector(this.S);
    if (this.anaMode === 1) for (let i = 0; i < Q; i++) xd[i + 1] = xin[i];

    const S = this.S, mask = this.mask, syn = this.syn;
    for (let b = 0; b < NB; b++) {
      this.band(b, S);
      if (mask[b] === 1) {
        if (this.anaMode === 1) {
          if (syn === 3) this.synFullClen(b); else if (syn === 1) this.synFullPow(b);
        } else {
          if (syn === 1) this.synPow(b);
          else if (syn === 2) this.synCheb(b);
          else if (syn === 3) this.synClen(b);
          else if (syn === 4) this.synTable(b);
          else if (syn === 5) this.synBlep(b);
          else if (syn === 6) this.synMathSin(b);
        }
      }
    }
  }

  // one band's analysis over S steps of xd[1..S] -> zr/zi[0..S], with the selection test
  band(b, S) {
    const xd = this.xd, zr = this.zr, zi = this.zi;
    const a1r = this.a1r[b], a1i = this.a1i[b], a2r = this.a2r[b], a2i = this.a2i[b], g0 = this.g0[b];
    const cLo = this.cLo[b], sLo = this.sLo[b], cHi = this.cHi[b], sHi = this.sHi[b], al = this.selA;
    let y1r = this.y1r[b], y1i = this.y1i[b], y2r = this.y2r[b], y2i = this.y2i[b];
    let dsr = this.dsr[b], dsi = this.dsi[b], cnt = 0;
    zr[0] = y1r; zi[0] = y1i;
    for (let j = 1; j <= S; j++) {
      const yr = g0 * xd[j] + a1r * y1r - a1i * y1i + a2r * y2r - a2i * y2i;
      const yi = a1r * y1i + a1i * y1r + a2r * y2i + a2i * y2r;
      dsr += al * (yr * y1r + yi * y1i - dsr);
      dsi += al * (yi * y1r - yr * y1i - dsi);
      if (dsi * cLo - dsr * sLo >= 0 && dsi * cHi - dsr * sHi <= 0) cnt++;
      y2r = y1r; y2i = y1i; y1r = yr; y1i = yi;
      zr[j] = yr; zi[j] = yi;
    }
    this.y1r[b] = y1r; this.y1i[b] = y1i; this.y2r[b] = y2r; this.y2i[b] = y2i;
    this.dsr[b] = dsr; this.dsi[b] = dsi; this.flag[b] = cnt;
  }

  // ---------- full-rate synthesis: normalise the band phasor every sample ----------
  synFullClen(b) {
    const zr = this.zr, zi = this.zi, g = this.g, w = this.w, L = this.outL, R = this.outR;
    const K = this.K[b], pl = this.panL[b], pr = this.panR[b], ceil = this.ceil, rel = this.relStep;
    let cf = this.cf[b];
    for (let i = 1; i <= Q; i++) {
      const m = Math.sqrt(zr[i] * zr[i] + zi[i] * zi[i]) + 1e-30, inv = 1 / m;
      const c = zr[i] * inv, s = zi[i] * inv, c2 = c + c;
      let y1 = 0, y2 = 0;
      for (let k = K - 1; k >= 0; k--) { const y0 = w[k] + c2 * y1 - y2; y2 = y1; y1 = y0; }
      const lev = m * g[i];
      cf = lev > cf * rel ? lev : cf * rel;
      const a = cf > ceil ? (lev * ceil) / cf : lev;
      const v = a * y1 * s;
      L[i - 1] += pl * v; R[i - 1] += pr * v;
    }
    this.cf[b] = cf;
  }
  synFullPow(b) {
    const zr = this.zr, zi = this.zi, g = this.g, w = this.w, L = this.outL, R = this.outR;
    const K = this.K[b], pl = this.panL[b], pr = this.panR[b], ceil = this.ceil, rel = this.relStep;
    let cf = this.cf[b];
    for (let i = 1; i <= Q; i++) {
      const m = Math.sqrt(zr[i] * zr[i] + zi[i] * zi[i]) + 1e-30, inv = 1 / m;
      const c = zr[i] * inv, s = zi[i] * inv;
      let qr = c, qi = s, acc = w[0] * s;
      for (let k = 1; k < K; k++) { const t = qr * c - qi * s; qi = qr * s + qi * c; qr = t; acc += w[k] * qi; }
      const lev = m * g[i];
      cf = lev > cf * rel ? lev : cf * rel;
      const a = cf > ceil ? (lev * ceil) / cf : lev;
      const v = a * acc;
      L[i - 1] += pl * v; R[i - 1] += pr * v;
    }
    this.cf[b] = cf;
  }

  // ---------- decimated: per step, the unit rotation rho = u_j conj(u_{j-1}) and its D-th root by
  // half-angles; per sample, u <- u * r. Amplitude per step, ramped per sample. ----------
  // The three phasor methods share this body; only the partial sum differs. Written out three times
  // so each inner loop is monomorphic and allocation-free.
  synPow(b) {
    const zr = this.zr, zi = this.zi, g = this.g, w = this.w, L = this.outL, R = this.outR;
    const S = this.S, D = this.D, LD = this.LD, K = this.K[b], pl = this.panL[b], pr = this.panR[b];
    const ceil = this.ceil, rel = this.relStep, invD = 1 / D;
    let cp = this.uc[b], sp = this.us[b], cf = this.cf[b], a = this.amp[b], i = 0;
    for (let j = 1; j <= S; j++) {
      const m = Math.sqrt(zr[j] * zr[j] + zi[j] * zi[j]) + 1e-30, inv = 1 / m;
      const cj = zr[j] * inv, sj = zi[j] * inv;
      let rr = cj * cp + sj * sp, ri = sj * cp - cj * sp;
      for (let h = 0; h < LD; h++) { const c2 = Math.sqrt(0.5 * (1 + rr)); ri = ri / (2 * c2); rr = c2; }
      const lev = m * g[j];
      cf = lev > cf * rel ? lev : cf * rel;
      const da = ((cf > ceil ? (lev * ceil) / cf : lev) - a) * invD;
      let c = cp, s = sp;
      for (let t = 0; t < D; t++, i++) {
        let qr = c, qi = s, acc = w[0] * s;
        for (let k = 1; k < K; k++) { const u = qr * c - qi * s; qi = qr * s + qi * c; qr = u; acc += w[k] * qi; }
        a += da;
        const v = a * acc;
        L[i] += pl * v; R[i] += pr * v;
        const nc = c * rr - s * ri; s = c * ri + s * rr; c = nc;
      }
      cp = cj; sp = sj;
    }
    this.uc[b] = cp; this.us[b] = sp; this.cf[b] = cf; this.amp[b] = a;
  }
  synCheb(b) {
    const zr = this.zr, zi = this.zi, g = this.g, w = this.w, L = this.outL, R = this.outR;
    const S = this.S, D = this.D, LD = this.LD, K = this.K[b], pl = this.panL[b], pr = this.panR[b];
    const ceil = this.ceil, rel = this.relStep, invD = 1 / D;
    let cp = this.uc[b], sp = this.us[b], cf = this.cf[b], a = this.amp[b], i = 0;
    for (let j = 1; j <= S; j++) {
      const m = Math.sqrt(zr[j] * zr[j] + zi[j] * zi[j]) + 1e-30, inv = 1 / m;
      const cj = zr[j] * inv, sj = zi[j] * inv;
      let rr = cj * cp + sj * sp, ri = sj * cp - cj * sp;
      for (let h = 0; h < LD; h++) { const c2 = Math.sqrt(0.5 * (1 + rr)); ri = ri / (2 * c2); rr = c2; }
      const lev = m * g[j];
      cf = lev > cf * rel ? lev : cf * rel;
      const da = ((cf > ceil ? (lev * ceil) / cf : lev) - a) * invD;
      let c = cp, s = sp;
      for (let t = 0; t < D; t++, i++) {
        const c2 = c + c;
        let sPrev = 0, sCur = s, acc = w[0] * s;
        for (let k = 1; k < K; k++) { const sn = c2 * sCur - sPrev; sPrev = sCur; sCur = sn; acc += w[k] * sn; }
        a += da;
        const v = a * acc;
        L[i] += pl * v; R[i] += pr * v;
        const nc = c * rr - s * ri; s = c * ri + s * rr; c = nc;
      }
      cp = cj; sp = sj;
    }
    this.uc[b] = cp; this.us[b] = sp; this.cf[b] = cf; this.amp[b] = a;
  }
  synClen(b) {
    const zr = this.zr, zi = this.zi, g = this.g, w = this.w, L = this.outL, R = this.outR;
    const S = this.S, D = this.D, LD = this.LD, K = this.K[b], pl = this.panL[b], pr = this.panR[b];
    const ceil = this.ceil, rel = this.relStep, invD = 1 / D;
    let cp = this.uc[b], sp = this.us[b], cf = this.cf[b], a = this.amp[b], i = 0;
    for (let j = 1; j <= S; j++) {
      const m = Math.sqrt(zr[j] * zr[j] + zi[j] * zi[j]) + 1e-30, inv = 1 / m;
      const cj = zr[j] * inv, sj = zi[j] * inv;
      let rr = cj * cp + sj * sp, ri = sj * cp - cj * sp;
      for (let h = 0; h < LD; h++) { const c2 = Math.sqrt(0.5 * (1 + rr)); ri = ri / (2 * c2); rr = c2; }
      const lev = m * g[j];
      cf = lev > cf * rel ? lev : cf * rel;
      const da = ((cf > ceil ? (lev * ceil) / cf : lev) - a) * invD;
      let c = cp, s = sp;
      for (let t = 0; t < D; t++, i++) {
        const c2 = c + c;
        let y1 = 0, y2 = 0;
        for (let k = K - 1; k >= 0; k--) { const y0 = w[k] + c2 * y1 - y2; y2 = y1; y1 = y0; }
        a += da;
        const v = a * y1 * s;
        L[i] += pl * v; R[i] += pr * v;
        const nc = c * rr - s * ri; s = c * ri + s * rr; c = nc;
      }
      cp = cj; sp = sj;
    }
    this.uc[b] = cp; this.us[b] = sp; this.cf[b] = cf; this.amp[b] = a;
  }

  // ---------- decimated, phase-based: a polynomial atan2 per step gives the unwrapped phase
  // increment; per sample the phase ramps linearly. (A ratio for Octave/Scale would multiply dp.) ----------
  // stepPhase(b, j) -> this.dp (cycles per sample), this.ph[b] set to the step's start phase.
  stepPhase(b, j) {
    const x = this.zr[j], y = this.zi[j];
    const ax = x < 0 ? -x : x, ay = y < 0 ? -y : y;
    const mx = ax > ay ? ax : ay, mn = ax > ay ? ay : ax;
    const t = mn / (mx + 1e-300), t2 = t * t;
    let r = t * (0.99997726 + t2 * (-0.33262347 + t2 * (0.19354346 + t2 * (-0.11643287 + t2 * (0.05265332 + t2 * -0.0117212)))));
    if (ay > ax) r = 1.5707963267948966 - r;
    if (x < 0) r = 3.141592653589793 - r;
    if (y < 0) r = -r;
    const phi = r * 0.15915494309189535; // cycles, (-0.5, 0.5]
    let d = phi - this.phPrev[b];
    d -= Math.floor(d + 0.5);
    this.phPrev[b] = phi;
    this.dp = d / this.D;
  }
  synTable(b) {
    const zr = this.zr, zi = this.zi, g = this.g, tab = this.tab, L = this.outL, R = this.outR;
    const S = this.S, D = this.D, pl = this.panL[b], pr = this.panR[b], off = (this.K[b] - 1) * TW;
    const ceil = this.ceil, rel = this.relStep, invD = 1 / D;
    let ph = this.ph[b], cf = this.cf[b], a = this.amp[b], i = 0;
    for (let j = 1; j <= S; j++) {
      this.stepPhase(b, j);
      const dp = this.dp;
      const m = Math.sqrt(zr[j] * zr[j] + zi[j] * zi[j]);
      const lev = m * g[j];
      cf = lev > cf * rel ? lev : cf * rel;
      const da = ((cf > ceil ? (lev * ceil) / cf : lev) - a) * invD;
      for (let t = 0; t < D; t++, i++) {
        const x = ph * TS, n = x | 0, fr = x - n, p = off + n;
        const v0 = tab[p];
        a += da;
        const v = a * (v0 + fr * (tab[p + 1] - v0));
        L[i] += pl * v; R[i] += pr * v;
        ph += dp;
        if (ph >= 1) ph -= 1; else if (ph < 0) ph += 1;
      }
    }
    this.ph[b] = ph; this.cf[b] = cf; this.amp[b] = a;
  }
  synBlep(b) {
    const zr = this.zr, zi = this.zi, g = this.g, L = this.outL, R = this.outR;
    const S = this.S, D = this.D, pl = this.panL[b], pr = this.panR[b];
    const ceil = this.ceil, rel = this.relStep, invD = 1 / D;
    let ph = this.ph[b], cf = this.cf[b], a = this.amp[b], i = 0;
    for (let j = 1; j <= S; j++) {
      this.stepPhase(b, j);
      const dp = this.dp, adp = dp < 0 ? -dp : dp, idp = 1 / (adp + 1e-12);
      const m = Math.sqrt(zr[j] * zr[j] + zi[j] * zi[j]);
      const lev = m * g[j];
      cf = lev > cf * rel ? lev : cf * rel;
      const da = ((cf > ceil ? (lev * ceil) / cf : lev) - a) * invD;
      for (let t = 0; t < D; t++, i++) {
        let v = 2 * ph - 1;
        if (ph < adp) { const u = ph * idp; v -= u + u - u * u - 1; }
        else if (ph > 1 - adp) { const u = (ph - 1) * idp; v -= u * u + u + u + 1; }
        a += da;
        v *= a;
        L[i] += pl * v; R[i] += pr * v;
        ph += dp;
        if (ph >= 1) ph -= 1; else if (ph < 0) ph += 1;
      }
    }
    this.ph[b] = ph; this.cf[b] = cf; this.amp[b] = a;
  }
  synMathSin(b) {
    const zr = this.zr, zi = this.zi, g = this.g, w = this.w, L = this.outL, R = this.outR;
    const S = this.S, D = this.D, K = this.K[b], pl = this.panL[b], pr = this.panR[b];
    const ceil = this.ceil, rel = this.relStep, invD = 1 / D;
    let ph = this.ph[b], cf = this.cf[b], a = this.amp[b], i = 0;
    for (let j = 1; j <= S; j++) {
      this.stepPhase(b, j);
      const dp = this.dp;
      const m = Math.sqrt(zr[j] * zr[j] + zi[j] * zi[j]);
      const lev = m * g[j];
      cf = lev > cf * rel ? lev : cf * rel;
      const da = ((cf > ceil ? (lev * ceil) / cf : lev) - a) * invD;
      for (let t = 0; t < D; t++, i++) {
        const x = TWO_PI * ph;
        let acc = 0;
        for (let k = 0; k < K; k++) acc += w[k] * Math.sin((k + 1) * x);
        a += da;
        const v = a * acc;
        L[i] += pl * v; R[i] += pr * v;
        ph += dp;
        if (ph >= 1) ph -= 1; else if (ph < 0) ph += 1;
      }
    }
    this.ph[b] = ph; this.cf[b] = cf; this.amp[b] = a;
  }
}
