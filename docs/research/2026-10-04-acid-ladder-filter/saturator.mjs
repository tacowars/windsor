/* global console */
/**
 * The Acid Ladder's diode law (windsor#573, record decision 6): which
 * rational `tanh` the ladder ships. Each candidate is a truncation of
 * Lambert's continued fraction for tanh, x · P(x²) / Q(x²), held at ±1 from
 * the first |x| where it reaches 1. Reported per order: that limit, the
 * largest error against `Math.tanh` over 0..10, the largest error of its
 * own derivative against 1 − tanh², whether it is monotone, the kink in the
 * slope at the limit, and the cost of one value and slope in ns (Node, the
 * machine it runs on; a tight loop, so a relative reading only).
 *
 *   node saturator.mjs
 */
import { performance } from 'node:perf_hooks';

const ORDERS = {
  '3/2': [
    [15, 1],
    [15, 6],
  ],
  '5/4': [
    [945, 105, 1],
    [945, 420, 15],
  ],
  '7/6': [
    [135135, 17325, 378, 1],
    [135135, 62370, 3150, 28],
  ],
  '9/8': [
    [34459425, 4729725, 135135, 990, 1],
    [34459425, 16216200, 945945, 13860, 45],
  ],
};

function limitOf(f) {
  let x = 0.5;
  while (f(x)[0] < 1 && x < 40) x += 1e-3;
  let lo = x - 1e-3;
  let hi = x;
  for (let i = 0; i < 80; i++) {
    const m = (lo + hi) / 2;
    if (f(m)[0] < 1) lo = m;
    else hi = m;
  }
  return lo;
}

for (const [name, coefficients] of Object.entries(ORDERS)) {
  const [P, Q] = coefficients;
  // The slope written as the shipped one is: N' Q − N Q', N = x p, Q' = x q'.
  const valueSlope = (x) => {
    const z = x * x;
    let p = 0;
    let dp = 0;
    let q = 0;
    let dq = 0;
    for (let i = P.length - 1; i >= 0; i--) {
      p = p * z + P[i];
      dp = dp * z + (2 * i + 1) * P[i];
    }
    for (let i = Q.length - 1; i >= 0; i--) q = q * z + Q[i];
    for (let i = Q.length - 1; i >= 1; i--) dq = dq * z + 2 * i * Q[i];
    // dq here is Σ 2i Qᵢ z^(i−1), so Q' = x dq
    const r = 1 / q;
    return [x * p * r, (dp * q - z * p * dq) * r * r];
  };
  const limit = limitOf(valueSlope);
  let maxErr = 0;
  let maxSlopeErr = 0;
  let monotone = true;
  let prev = 0;
  for (let i = 0; i <= 400000; i++) {
    const x = (i * 10) / 400000;
    const [y, d] = x >= limit ? [1, 0] : valueSlope(x);
    if (y < prev) monotone = false;
    prev = y;
    const t = Math.tanh(x);
    maxErr = Math.max(maxErr, Math.abs(y - t));
    maxSlopeErr = Math.max(maxSlopeErr, Math.abs(d - (1 - t * t)));
  }
  const kink = valueSlope(limit * (1 - 1e-12))[1];
  // Cost: value and slope over a spread of arguments, clamped as shipped,
  // as straight-line Horner code with the coefficients inlined (the shipped
  // form), the result in a typed array so nothing is boxed.
  const horner = (terms, variable) =>
    terms.reduceRight((acc, c) => (acc === '' ? `${c}` : `(${acc}) * ${variable} + ${c}`), '');
  const dP = P.map((c, i) => (2 * i + 1) * c);
  const dQ = Q.slice(1).map((c, i) => 2 * (i + 1) * c);
  const timed = new Function(
    'out',
    'n',
    'limit',
    `let sink = 0;
    for (let i = 0; i < n; i++) {
      const x = ((i % 1000) - 500) * 0.012;
      if (x >= limit) sink += 1;
      else if (x <= -limit) sink -= 1;
      else {
        const z = x * x;
        const p = ${horner(P, 'z')};
        const q = ${horner(Q, 'z')};
        const dp = ${horner(dP, 'z')};
        const dq = ${horner(dQ, 'z')};
        const r = 1 / q;
        sink += x * p * r + (dp * q - z * p * dq) * r * r;
      }
    }
    out[0] = sink;`,
  );
  const out = new Float64Array(1);
  const n = 2e7;
  const run = () => {
    const started = performance.now();
    timed(out, n, limit);
    return ((performance.now() - started) * 1e6) / n;
  };
  run();
  const ns = Math.min(run(), run(), run());
  console.log(
    `${name.padEnd(4)} limit ${limit.toFixed(4)}  max|R − tanh| ${maxErr.toExponential(2)}  ` +
      `max|R' − tanh'| ${maxSlopeErr.toExponential(2)}  monotone ${monotone}  slope at limit ${kink.toExponential(2)}  ` +
      `${ns.toFixed(2)} ns`,
  );
}
