/* global console, process */
/**
 * The Acid Ladder plan's numerical checks (research only, no shipping code):
 *
 *   node model.mjs            # the tables the README quotes
 *   node model.mjs --matrix   # also the solver convergence matrix (slow)
 *
 * 1. The linearised TB-303 diode ladder as a state-space chain, from
 *    Stinchcombe's stage equations (23), (24) and (27): four capacitor
 *    voltages x1..x4, each driven by the diode-pair currents to its
 *    neighbours, the input pair at the bottom, the output pair at the top.
 *    With the bottom capacitor halved its characteristic polynomial must be
 *    his G_tb: s^4 + 6.727 s^3 + 14.142 s^2 + 9.514 s + 1 once normalised
 *    to wc = 2^(1/4) / tau, tau = 2aC; with equal capacitors his G_1,
 *    s^4 + 7 s^3 + 15 s^2 + 10 s + 1.
 * 2. The poles at k = 0, the -3 dB point and the dB/octave slope per octave
 *    band, against the Moog (1 + s)^4 for reference.
 * 3. The feedback k at which the right-most pole pair reaches the imaginary
 *    axis (self-oscillation), by the Routh condition, and again with a
 *    150 Hz high-pass in the feedback path, by cutoff.
 * 4. A trapezoidal (TPT) discretisation of the nonlinear chain at 48 kHz,
 *    in integrator-memory form (s = x + h f, so the previous endpoint's
 *    derivative is carried in the state, as the engine's SVF carries its
 *    integrators: Codex's review finding 1 against the first prototype,
 *    which re-evaluated that derivative with the current input), solved
 *    each sample by a fixed number of Newton steps: its small-signal
 *    response against the analog transfer function up to a 18 kHz cutoff,
 *    its harmonics at large signals, and, with --matrix, how many Newton
 *    steps a sample needs across cutoff, feedback, level, waveform and
 *    oversampling (finding 2).
 */

// ---------- polynomial / complex helpers ----------
const cmul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const cadd = (a, b) => [a[0] + b[0], a[1] + b[1]];
const cabs = (a) => Math.hypot(a[0], a[1]);
const cdiv = (a, b) => {
  const d = b[0] * b[0] + b[1] * b[1];
  return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d];
};
/** Evaluate a real polynomial (highest power first) at complex s. */
function polyEval(coef, s) {
  let acc = [0, 0];
  for (const c of coef) acc = cadd(cmul(acc, s), [c, 0]);
  return acc;
}
/** Durand–Kerner roots of a monic polynomial. */
function roots(coef) {
  const n = coef.length - 1;
  let z = Array.from({ length: n }, (_, i) => {
    const ang = (2 * Math.PI * i) / n + 0.4;
    return [0.9 * Math.cos(ang), 0.9 * Math.sin(ang)];
  });
  for (let it = 0; it < 500; it++) {
    const next = z.map((zi, i) => {
      let denom = [1, 0];
      z.forEach((zj, j) => {
        if (j !== i) denom = cmul(denom, [zi[0] - zj[0], zi[1] - zj[1]]);
      });
      const q = cdiv(polyEval(coef, zi), denom);
      return [zi[0] - q[0], zi[1] - q[1]];
    });
    z = next;
  }
  return z;
}

// ---------- 1. state-space chain vs Stinchcombe ----------
// tau * c_n * dx_n/dt = (x_{n+1} - x_n) - (x_n - x_{n-1}), x_0 term = u (input), top: -(x_4)
function chainMatrix(c1) {
  return [
    [-1 / c1, 1 / c1, 0, 0],
    [1, -2, 1, 0],
    [0, 1, -2, 1],
    [0, 0, 1, -2],
  ];
}
/** Characteristic polynomial of a 4x4 via Faddeev–LeVerrier. */
function charPoly(M) {
  const n = 4;
  const mul = (A, B) => A.map((r) => B[0].map((_, j) => r.reduce((s, v, k) => s + v * B[k][j], 0)));
  const trace = (A) => A.reduce((s, r, i) => s + r[i], 0);
  const powers = [null, M.map((r) => r.slice())];
  for (let k = 2; k <= n; k++) powers.push(mul(powers[k - 1], M));
  const p = (k) => trace(powers[k]);
  const e = [1];
  for (let k = 1; k <= n; k++) {
    let s = 0;
    for (let i = 1; i <= k; i++) s += (i % 2 ? 1 : -1) * e[k - i] * p(i);
    e.push(s / k);
  }
  // det(sI - M) = s^4 - e1 s^3 + e2 s^2 - e3 s + e4
  return [1, -e[1], e[2], -e[3], e[4]];
}
const tb = charPoly(chainMatrix(0.5)); // tau = 1 units
const eq = charPoly(chainMatrix(1));
const wcTb = Math.pow(2, 0.25); // wc = 2^(1/4) / tau
// D(s) in tau=1 units is tb/2 (Stinchcombe's constant term is 1); s = wc s' scales power 4-i by wc^(4-i).
const normTb = tb.map((c, i) => (c / 2) * Math.pow(wcTb, 4 - i));
const real = charPoly(chainMatrix(18 / 33));
const wcReal = Math.pow(real[4], 0.25); // normalise so the constant term is 1 after s = wc s'
const normReal = real.map((c, i) => (c / real[4]) * Math.pow(wcReal, 4 - i));
console.log('TB chain char poly (tau=1):', tb.map((v) => v.toFixed(4)).join(' '));
console.log('TB normalised to wc=2^(1/4)/tau:', normTb.map((v) => v.toFixed(4)).join(' '), ' (Stinchcombe: 1 6.727 14.142 9.514 1)');
console.log('Equal caps char poly (tau=1):', eq.map((v) => v.toFixed(4)).join(' '), ' (Stinchcombe: 1 7 15 10 1)');
console.log('Real caps 18/33 normalised:', normReal.map((v) => v.toFixed(4)).join(' '));
console.log('Real caps poles (k=0):', roots(normReal).map((p) => p[0].toFixed(4)).join(', '));
{
  const [, b3, b2, b1, b0] = normReal;
  console.log('Real caps k_osc (Routh):', ((b1 * (b3 * b2 - b1)) / (b3 * b3) - b0).toFixed(3));
}

// ---------- 2. poles, -3 dB, slopes ----------
const D = normTb; // in units of wc
const polesTb = roots(D);
console.log('\nPoles of G_tb at k=0 (units of wc):', polesTb.map((p) => `${p[0].toFixed(4)}${p[1] >= 0 ? '+' : ''}${p[1].toFixed(4)}j`).join(', '));
const magDb = (coef, w, k = 0) => {
  const d = cadd(polyEval(coef, [0, w]), [k, 0]);
  return -20 * Math.log10(cabs(d));
};
let lo = 1e-3,
  hi = 10;
for (let i = 0; i < 100; i++) {
  const mid = Math.sqrt(lo * hi);
  if (magDb(D, mid) > -3.0103) lo = mid;
  else hi = mid;
}
console.log(`-3 dB point at k=0: ${lo.toFixed(4)} wc  (${Math.log2(1 / lo).toFixed(2)} octaves below wc)`);
console.log('|G_tb(j wc)| at k=0:', magDb(D, 1).toFixed(2), 'dB');
console.log('\nSlope (dB/oct) at k=0 over octave bands, in units of wc:');
for (const [a, b] of [[0.0625, 0.125], [0.125, 0.25], [0.25, 0.5], [0.5, 1], [1, 2], [2, 4], [4, 8], [8, 16], [16, 32]]) {
  console.log(`  ${a}..${b} wc: ${(magDb(D, b) - magDb(D, a)).toFixed(2)}`);
}
const moog = [1, 4, 6, 4, 1];
console.log('Moog (1+s)^4 slopes for reference:', [[0.5, 1], [1, 2], [2, 4], [4, 8]].map(([a, b]) => `${a}..${b}: ${(magDb(moog, b) - magDb(moog, a)).toFixed(2)}`).join('  '));

// ---------- 3. self-oscillation k (Routh) and resonance table ----------
const [, a3, a2, a1, a0] = D;
const kOsc = (a1 * (a3 * a2 - a1)) / (a3 * a3) - a0;
console.log(`\nSelf-oscillation k (Routh, no HP): ${kOsc.toFixed(4)}`);
const s_ = (w) => [0, w];
const peakOf = (coef, k, hp = null) => {
  let best = -Infinity,
    bw = 0;
  for (let i = 0; i <= 4000; i++) {
    const w = Math.pow(10, -2 + (i / 4000) * 3);
    let fb = [k, 0];
    if (hp) {
      const s = [0, w];
      fb = cmul([k, 0], cdiv(s, cadd(s, [hp, 0])));
    }
    const d = cadd(polyEval(coef, s_(w)), fb);
    const m = -20 * Math.log10(cabs(d));
    if (m > best) {
      best = m;
      bw = w;
    }
  }
  return { peakDb: best, w: bw };
};
console.log('\nk -> DC gain, peak (dB, at w/wc), damping of the dominant pair, Q = 1/(2 zeta):');
for (const k of [0, 0.5, 1, 2, 4, 8, 12, 14, 15, 16, 16.5, 17]) {
  const coef = D.slice();
  coef[4] = a0 + k;
  const rs = roots(coef);
  const cplx = rs.filter((r) => Math.abs(r[1]) > 1e-6).sort((p, q) => q[0] - p[0]);
  const dom = cplx[0];
  const zeta = dom ? -dom[0] / Math.hypot(dom[0], dom[1]) : NaN;
  const pk = peakOf(D, k);
  console.log(`  k=${k.toString().padEnd(5)} DC ${(-20 * Math.log10(1 + k)).toFixed(2).padStart(7)} dB  peak ${pk.peakDb.toFixed(2).padStart(7)} dB at ${pk.w.toFixed(3)} wc  zeta ${isNaN(zeta) ? '  real ' : zeta.toFixed(4)}  Q ${isNaN(zeta) ? '-' : (1 / (2 * zeta)).toFixed(2)}`);
}
console.log('\nk=16 with a 150 Hz HP in the feedback path, by cutoff fc = wc/2pi:');
for (const fc of [100, 150, 200, 300, 500, 1000, 2000, 5000]) {
  const whp = 150 / fc;
  const pk = peakOf(D, 16, whp);
  const pkNo = peakOf(D, 16);
  console.log(`  fc=${String(fc).padStart(5)} Hz: peak ${pk.peakDb.toFixed(2).padStart(6)} dB at ${(pk.w * fc).toFixed(0)} Hz   (no HP: ${pkNo.peakDb.toFixed(2)} dB at ${(pkNo.w * fc).toFixed(0)} Hz)`);
}
console.log('\nk at self-oscillation with the 150 Hz HP, by cutoff (bisection on the largest real part of the loop poles):');
function maxRealPartWithHp(k, whp) {
  // Loop: D(s) * (s + whp) + k*s = 0, a 5th-order polynomial
  const prod = new Array(6).fill(0);
  D.forEach((c, i) => {
    prod[i] += c;
    prod[i + 1] += c * whp;
  });
  prod[4] += k;
  const rs = roots(prod);
  return Math.max(...rs.map((r) => r[0]));
}
for (const fc of [100, 200, 300, 500, 1000, 2000, 5000]) {
  const whp = 150 / fc;
  let klo = 0,
    khi = 60;
  for (let i = 0; i < 60; i++) {
    const km = (klo + khi) / 2;
    if (maxRealPartWithHp(km, whp) < 0) klo = km;
    else khi = km;
  }
  console.log(`  fc=${String(fc).padStart(5)} Hz: k_osc = ${klo.toFixed(3)}`);
}

// ---------- 4. TPT discretisation in integrator-memory form ----------
const SR = 48000;
/**
 * The nonlinear chain, trapezoidal: x+ = x + h (f + f+) = s + h f+, with
 * s = x + h f carried from the previous sample (s+ = 2 x+ - s after the
 * solve, the SVF's `ic = 2v - ic`). The high-pass is a TPT one-pole on x4
 * with its own state; its output at the new endpoint enters the input
 * pair's tanh. `oversample` runs that many sub-steps per input sample on a
 * linearly interpolated input and returns the last sub-step (no decimation
 * filter: the matrix measures the solver, not aliasing).
 */
// eslint-disable-next-line max-lines-per-function -- the prototype ladder: one closure over its state and its step, as the plan reads it
function makeLadder({ fc, k, hpHz = 150, newton = 3, c1 = 0.5, sr = SR, oversample = 1 }) {
  const srI = sr * oversample;
  const wc = 2 * Math.PI * fc;
  const tau = Math.pow(2, 0.25) / wc;
  const T = 1 / srI;
  const gPre = Math.tan((Math.PI * fc) / srI) / ((Math.PI * fc) / srI);
  const h = T / 2 / (tau / gPre); // half-step over tau, prewarped
  const ghp = Math.tan((Math.PI * hpHz) / srI);
  const Ghp = ghp / (1 + ghp);
  const cs = [c1, 1, 1, 1];
  const s = [0, 0, 0, 0]; // integrator memory: x + h f
  let hpS = 0;
  let lastIn = 0;
  const tanh = Math.tanh;
  const dtanh = (v) => {
    const t = Math.tanh(v);
    return 1 - t * t;
  };
  const f = (xs, u) => [
    (tanh(xs[1] - xs[0]) - tanh(u)) / cs[0],
    (tanh(xs[2] - xs[1]) - tanh(xs[1] - xs[0])) / cs[1],
    (tanh(xs[3] - xs[2]) - tanh(xs[2] - xs[1])) / cs[2],
    (-tanh(xs[3]) - tanh(xs[3] - xs[2])) / cs[3],
  ];
  const hpOf = (x4) => x4 - ((x4 - hpS) * Ghp + hpS);
  function step(input) {
    // Initial guess: the previous endpoint, x = s - h f_prev; cheaper and
    // as good at small h to start from s itself (x+ = s at f+ = 0).
    let xn = s.slice();
    for (let it = 0; it < newton; it++) {
      const un = input + k * hpOf(xn[3]);
      const fn = f(xn, un);
      const F = xn.map((v, i) => v - s[i] - h * fn[i]);
      const d01 = dtanh(xn[1] - xn[0]),
        d12 = dtanh(xn[2] - xn[1]),
        d23 = dtanh(xn[3] - xn[2]),
        d3 = dtanh(xn[3]);
      const du = dtanh(un);
      const dhp = 1 - Ghp;
      const J = [
        [1 - (h * -d01) / cs[0], (-h * d01) / cs[0], 0, (-h * (-du * k * dhp)) / cs[0]],
        [(-h * d01) / cs[1], 1 - (h * (-d12 - d01)) / cs[1], (-h * d12) / cs[1], 0],
        [0, (-h * d12) / cs[2], 1 - (h * (-d23 - d12)) / cs[2], (-h * d23) / cs[2]],
        [0, 0, (-h * d23) / cs[3], 1 - (h * (-d3 - d23)) / cs[3]],
      ];
      const A = J.map((r, i) => [...r, -F[i]]);
      for (let c = 0; c < 4; c++) {
        let p = c;
        for (let r = c + 1; r < 4; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
        [A[c], A[p]] = [A[p], A[c]];
        for (let r = c + 1; r < 4; r++) {
          const m = A[r][c] / A[c][c];
          for (let cc = c; cc < 5; cc++) A[r][cc] -= m * A[c][cc];
        }
      }
      const dx = [0, 0, 0, 0];
      for (let r = 3; r >= 0; r--) {
        let acc = A[r][4];
        for (let cc = r + 1; cc < 4; cc++) acc -= A[r][cc] * dx[cc];
        dx[r] = acc / A[r][r];
      }
      xn = xn.map((v, i) => v + dx[i]);
    }
    for (let i = 0; i < 4; i++) s[i] = 2 * xn[i] - s[i];
    const v = (xn[3] - hpS) * Ghp;
    hpS = v + hpS + v;
    return -xn[3]; // output polarity matched to the Lowpass mode
  }
  return function process(input) {
    let out = 0;
    for (let i = 1; i <= oversample; i++) out = step(lastIn + ((input - lastIn) * i) / oversample);
    lastIn = input;
    return out;
  };
}
// eslint-disable-next-line max-params -- a research reading whose defaults are the plan's settings
function responseDb(fc, k, probeHz, amp = 1e-4, hpHz = 150, newton = 3) {
  const ladder = makeLadder({ fc, k, hpHz, newton });
  const n = Math.round(SR * 0.5);
  const warm = Math.round(SR * 0.25);
  let re = 0,
    im = 0,
    cnt = 0;
  for (let i = 0; i < n + warm; i++) {
    const y = ladder(amp * Math.sin((2 * Math.PI * probeHz * i) / SR));
    if (i >= warm) {
      re += y * Math.cos((2 * Math.PI * probeHz * i) / SR);
      im += y * Math.sin((2 * Math.PI * probeHz * i) / SR);
      cnt++;
    }
  }
  return 20 * Math.log10((2 * Math.hypot(re, im)) / cnt / amp);
}
/** The analog response at the digital frequency's prewarped image, so the bilinear warp is not read as error. */
function analogDb(fc, k, probeHz, hpHz = 150, warped = true) {
  const image = (hz) => (warped ? (SR / Math.PI) * Math.tan((Math.PI * hz) / SR) : hz);
  const wcImage = image(fc); // the design maps the digital fc to wc exactly
  const w = image(probeHz) / wcImage;
  const s = [0, w];
  let fb = [k, 0];
  if (hpHz > 0) {
    const whp = image(hpHz) / wcImage;
    fb = cmul([k, 0], cdiv(s, cadd(s, [whp, 0])));
  }
  return -20 * Math.log10(cabs(cadd(polyEval(D, s), fb)));
}
console.log('\nTPT (integrator form) + 3 Newton steps, small signal (1e-4), vs the analog response at the prewarped image (dB, digital/analog):');
for (const [fc, k] of [[500, 0], [500, 8], [500, 16], [2000, 0], [2000, 16], [200, 16], [10000, 0], [18000, 0], [18000, 16]]) {
  const line = [];
  for (const mult of [0.125, 0.25, 0.5, 0.8, 1, 1.1, 1.25, 2, 4]) {
    const probe = fc * mult;
    if (probe > SR / 2.2) continue;
    line.push(`${mult}wc: ${responseDb(fc, k, probe).toFixed(2)}/${analogDb(fc, k, probe).toFixed(2)}`);
  }
  console.log(`  fc=${fc} k=${k}: ${line.join('  ')}`);
}
console.log('At the cutoff itself the unwarped analog value is -21.91 dB at every fc (the first prototype read -13.57 at 18 kHz, finding 1):',
  [10000, 18000].map((fc) => `${fc} Hz: ${responseDb(fc, 0, fc).toFixed(2)}`).join('  '));

console.log('\nLarge signal at fc=1 kHz, k=12, 110 Hz sine: RMS gain and harmonics relative to the fundamental:');
for (const amp of [0.05, 0.5, 1, 2, 4]) {
  const ladder = makeLadder({ fc: 1000, k: 12 });
  const n = SR,
    warm = SR / 4;
  const acc = { 1: [0, 0], 2: [0, 0], 3: [0, 0], 5: [0, 0] };
  let rms = 0,
    cnt = 0;
  for (let i = 0; i < n + warm; i++) {
    const y = ladder(amp * Math.sin((2 * Math.PI * 110 * i) / SR));
    if (i >= warm) {
      rms += y * y;
      cnt++;
      for (const hmc of [1, 2, 3, 5]) {
        acc[hmc][0] += y * Math.cos((2 * Math.PI * 110 * hmc * i) / SR);
        acc[hmc][1] += y * Math.sin((2 * Math.PI * 110 * hmc * i) / SR);
      }
    }
  }
  const hAmp = (m) => (2 * Math.hypot(...acc[m])) / cnt;
  console.log(`  amp ${amp}: out RMS/in RMS ${(Math.sqrt(rms / cnt) / (amp / Math.SQRT2)).toFixed(3)}  H2 ${(20 * Math.log10(hAmp(2) / hAmp(1))).toFixed(1)} dB  H3 ${(20 * Math.log10(hAmp(3) / hAmp(1))).toFixed(1)} dB  H5 ${(20 * Math.log10(hAmp(5) / hAmp(1))).toFixed(1)} dB`);
}

// ---------- 5. the solver convergence matrix (finding 2) ----------
/** A band-limited 110 Hz saw or square, harmonics through 127, scaled to `peak`. */
function bandlimited(kind, peak, sr) {
  const n = Math.round(sr * 0.5);
  const out = new Float64Array(n);
  let max = 0;
  for (let i = 0; i < n; i++) {
    let v = 0;
    for (let hmc = 1; hmc <= 127; hmc += kind === 'square' ? 2 : 1) v += Math.sin((2 * Math.PI * 110 * hmc * i) / sr) / hmc;
    out[i] = v;
    max = Math.max(max, Math.abs(v));
  }
  for (let i = 0; i < n; i++) out[i] *= peak / max;
  return out;
}
/** Peak-relative max error (dBr) of each Newton count against 24 steps, over the second quarter second. */
function convergence(input, cfg, counts) {
  const ref = makeLadder({ ...cfg, newton: 24 });
  const trial = counts.map((newton) => makeLadder({ ...cfg, newton }));
  const errs = counts.map(() => 0);
  let peak = 0;
  for (let i = 0; i < input.length; i++) {
    const r = ref(input[i]);
    const ys = trial.map((t) => t(input[i]));
    if (i >= input.length / 2) {
      peak = Math.max(peak, Math.abs(r));
      ys.forEach((y, j) => (errs[j] = Math.max(errs[j], Math.abs(y - r))));
    }
  }
  return errs.map((e) => 20 * Math.log10(e / peak));
}
if (process.argv.includes('--matrix')) {
  const counts = [1, 2, 3, 4, 6, 8];
  console.log(`\nSolver matrix: peak-relative max error (dBr) against 24 Newton steps, by Newton count ${counts.join('/')}; the first count under -60 and under -90 dBr. 110 Hz band-limited waves (harmonics through 127), 48 kHz.`);
  for (const oversample of [1, 2]) {
    console.log(`\n-- ${oversample}x --`);
    for (const fc of [500, 2000, 5000, 10000, 18000]) {
      for (const k of [0, 8, 16.5]) {
        // eslint-disable-next-line max-depth -- the matrix's five axes, one loop each
        for (const kind of ['saw', 'square']) {
          // eslint-disable-next-line max-depth -- the matrix's five axes, one loop each
          for (const peak of [2, 8]) {
            const errs = convergence(bandlimited(kind, peak, SR), { fc, k, oversample }, counts);
            const first = (limit) => {
              const idx = errs.findIndex((e) => e < limit);
              return idx < 0 ? '>8' : String(counts[idx]);
            };
            console.log(`  fc=${String(fc).padStart(5)} k=${String(k).padEnd(4)} ${kind.padEnd(6)} peak ${peak}: ${errs.map((e) => e.toFixed(0).padStart(5)).join(' ')}   <-60: ${first(-60).padStart(2)}  <-90: ${first(-90).padStart(2)}`);
          }
        }
      }
    }
  }
}
