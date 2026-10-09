/**
 * Candidates A and C as edits to the shipped FM bundle's text (windsor#652,
 * decision 3). Research only: nothing under `packages/` changes.
 *
 * **Who takes it.** A synced Saw, Square or Pulse with no incoming
 * modulator in its algorithm, feedback 0, no LFO on its width, a Saw or
 * Square at width 1, and the patch's Tone at 1, all at the bind
 * (`syncDirectKind`). Every other synced operator keeps today's path.
 *
 * **The shape.** Computed directly, with Windsor's polarity and the tables'
 * level: the table is `Σ aₙ sin(2πnp)` over its peak, so its fundamental is
 * `g = 1 / peak` and the ideal wave is that sum carried to every harmonic,
 * scaled by `g`.
 *   - Saw: `g · π/2 · (1 − 2p)`, a falling ramp, a rise of `g·π` at phase 0.
 *   - Square: `±g · π/4`, rising at phase 0, falling at 0.5.
 *   - Pulse: `saw(p) − saw(p + w)`, so `g·π·w` up to phase `1 − w` and
 *     `g·π·(w − 1)` after: zero mean, a rise of `g·π` at 0, a fall at `1 − w`.
 *   `g` is read off the operator's current table (`syncTableGain`), so the
 *   level follows the table's mip as the table path's does.
 *
 * **The edges, in time order.** After each sample's resets, an operator's
 * edges between this sample and the next are found from its phase at this
 * sample and its increment: the wraps and duty edges on the free-running
 * path up to the reset (all of the interval when there is none), then the
 * reset's step, from the left limit at the free-running phase just before
 * it to the wave at phase 0, then any duty edge after it.
 *
 * **The polyBLEP.** Each edge of step `h` at `dd` of a sample before the
 * next sample adds `h · r(t)` at the samples around it, `t` their distance
 * from the edge:
 *   - two points (A): `r = (t + 1)²/2` before, `−(1 − t)²/2` after, so the
 *     operator's wave goes on a sample late;
 *   - four points (C): the integrated cubic B-spline less the step, over
 *     `t` in [−2, 2], two samples late.
 * The operator's feedback taps keep the raw shape (feedback is 0 here).
 */

const HALF_PI = '1.5707963267948966';
const QUARTER_PI = '0.7853981633974483';

/** The direct shape at phase `x` (a left limit at 1), as an expression over `k3`, `g` and `w`. */
const naive = (x) =>
  `(k3 === 0 ? g * ${HALF_PI} * (1 - 2 * ${x}) : k3 === 1 ? (${x} < 0.5 ? g * ${QUARTER_PI} : -g * ${QUARTER_PI}) : (${x} < 1 - w ? g * Math.PI * w : g * Math.PI * (w - 1)))`;

/** One edge of step `h` at `dd` before the next sample onto the held samples. */
function edgeCode(points) {
  if (points === 2) {
    return `dq0[i] += h * dd * dd * 0.5; da1[i] -= h * (1 - dd) * (1 - dd) * 0.5;`;
  }
  return `{ const t0 = dd - 1, u2 = dd * dd, t2 = t0 * t0, e1 = 1 - dd, e2 = e1 * e1;
            dq1[i] += h * u2 * u2 * (1 / 24);
            dq0[i] += h * (0.5 + t0 * (2 / 3) - t2 * t0 * (1 / 3) - t2 * t2 * 0.125);
            da1[i] += h * (-0.5 + dd * (2 / 3) - u2 * dd * (1 / 3) + u2 * u2 * 0.125);
            da2[i] -= h * e2 * e2 * (1 / 24); }`;
}

/** The operator's wave out of its delay line: one sample (A) or two (C). */
function delayCode(points) {
  if (points === 2) return `const late = dq0[i]; dq0[i] = v + da1[i]; da1[i] = 0; v = late;`;
  return `const late = dq1[i]; dq1[i] = dq0[i]; dq0[i] = v + da1[i]; da1[i] = da2[i]; da2[i] = 0; v = late;`;
}

/** Every direct operator's edges between this sample and the next, after the resets. */
function edgesCode(points) {
  const edge = edgeCode(points);
  return `
      if (direct !== 0) {
        for (let i = 0; i < 4; i++) {
          if ((direct & 1 << i) === 0) continue;
          const inc = phaseInc[i], p0 = dirPrev[i], g = dirG[i], k3 = dirKind[i], w = width[i];
          const dR = dirReset[i];
          const isReset = dR === dR;
          const end = isReset ? p0 + (1 - dR) * inc : p0 + inc;
          const duty = k3 === 0 ? -1 : k3 === 1 ? 0.5 : 1 - w;
          const jump = k3 === 1 ? g * ${HALF_PI} : g * Math.PI;
          let h, dd;
          for (let x = Math.floor(p0) + 1; isReset ? x < end : x <= end; x++) {
            h = jump; dd = 1 - (x - p0) / inc; ${edge}
          }
          if (duty >= 0) {
            for (let x = Math.floor(p0 - duty) + 1 + duty; isReset ? x < end : x <= end; x++) {
              h = -jump; dd = 1 - (x - p0) / inc; ${edge}
            }
          }
          if (isReset) {
            let x = end - Math.floor(end);
            if (x === 0) x = 1;
            h = ${naive('0')} - ${naive('x')}; dd = dR; ${edge}
            if (duty >= 0 && duty <= dR * inc) { h = -jump; dd = dR - duty / inc; ${edge} }
            dirReset[i] = NaN;
          }
        }
      }`;
}

const FIELDS = ['dq0', 'dq1', 'da1', 'da2'];

/** The voice's sync state, the bind and the reset's record: the same for A and C. */
const STATE_EDITS = [
  {
    from: '    this.after = new Float64Array(OPERATOR_COUNT);\n  }',
    to: `    this.after = new Float64Array(OPERATOR_COUNT);
    this.direct = 0;
    this.dirKind = new Int32Array(OPERATOR_COUNT);
    this.dirPrev = new Float64Array(OPERATOR_COUNT);
    this.dirReset = new Float64Array(OPERATOR_COUNT).fill(NaN);
    this.dirG = new Float64Array(OPERATOR_COUNT);
    this.dirTab = [null, null, null, null];
${FIELDS.map((f) => `    this.${f} = new Float64Array(OPERATOR_COUNT);`).join('\n')}
  }`,
  },
  {
    from: '    this.after.fill(0);\n  }',
    to: `    this.after.fill(0);
${FIELDS.map((f) => `    this.${f}.fill(0);`).join('\n')}
    this.dirReset.fill(NaN);
  }`,
  },
  {
    from: 'function bindVoiceSync(voice, patch) {',
    to: `var SYNC_TABLE_GAIN = new WeakMap();
function syncTableGain(t) {
  let g = SYNC_TABLE_GAIN.get(t);
  if (g !== undefined) return g;
  let acc = 0;
  for (let k = 0; k < TABLE_SIZE; k++) acc += t[k] * SIN_TAB[k];
  g = (2 * acc) / TABLE_SIZE;
  SYNC_TABLE_GAIN.set(t, g);
  return g;
}
function syncDirectKind(voice, patch, i) {
  const op = patch.ops[i];
  const alg = ALGORITHMS[patch.algorithm] || ALGORITHMS[0];
  if (alg.mods[i].length !== 0 || op.feedback !== 0 || patch.tone !== 1) return -1;
  if (patch.lfo.toWidth[i] !== 0 || patch.lfo2.toWidth[i] !== 0) return -1;
  const k = voice.kind[i];
  if (k === KIND_PULSE) return 2;
  if (k !== KIND_TABLE || op.width !== 1) return -1;
  return op.wave === WAVE.SAW ? 0 : op.wave === WAVE.SQUARE ? 1 : -1;
}
function bindVoiceSync(voice, patch) {`,
  },
  {
    from: '  let blep = 0;\n  let masters = 0;',
    to: '  let blep = 0;\n  let direct = 0;\n  let masters = 0;',
  },
  {
    from: '    if (syncCorrected(voice.kind[i], patch.ops[i].wave)) blep |= 1 << i;',
    to: `    const dk = syncDirectKind(voice, patch, i);
    if (dk >= 0) {
      direct |= 1 << i;
      s.dirKind[i] = dk;
    } else if (syncCorrected(voice.kind[i], patch.ops[i].wave)) blep |= 1 << i;`,
  },
  {
    from: '  s.blep = blep;\n',
    to: `  const freshDirect = direct & ~s.direct;
  for (let i = 0; i < OPERATOR_COUNT; i++) {
    if ((freshDirect & 1 << i) === 0) continue;
${FIELDS.map((f) => `    s.${f}[i] = 0;`).join('\n')}
    s.dirReset[i] = NaN;
  }
  s.blep = blep;
  s.direct = direct;
`,
  },
  {
    from: '    phase[i] = reset;\n    if ((s.blep & 1 << i) === 0) continue;',
    to: '    phase[i] = reset;\n    s.dirReset[i] = d;\n    if ((s.blep & 1 << i) === 0) continue;',
  },
];

/** The generic loop's edits: the hoisting, the read, the delay line and the edges. */
function renderEdits(points) {
  return [
    {
      from: '  let notePhase = sync.notePhase;\n  let ramping',
      to: `  let notePhase = sync.notePhase;
  const direct = sync.direct, dirKind = sync.dirKind, dirPrev = sync.dirPrev, dirReset = sync.dirReset, dirG = sync.dirG;
  const dq0 = sync.dq0, dq1 = sync.dq1, da1 = sync.da1, da2 = sync.da2;
  for (let i = 0; i < 4; i++) {
    if ((direct & 1 << i) !== 0 && sync.dirTab[i] !== tables[i]) {
      sync.dirTab[i] = tables[i];
      dirG[i] = syncTableGain(tables[i]);
    }
  }
  let ramping`,
    },
    {
      from: '      if ((squeezed & 1 << i) !== 0) {\n        const pw = ph * width[i];',
      to: `      if ((direct & 1 << i) !== 0) {
        const g = dirG[i], k3 = dirKind[i], w = width[i];
        dirPrev[i] = ph;
        v = ${naive('ph')};
      } else if ((squeezed & 1 << i) !== 0) {
        const pw = ph * width[i];`,
    },
    {
      from: '      if ((blep & 1 << i) !== 0) {\n        const late = syncHeld[i];',
      to: `      if ((direct & 1 << i) !== 0) {
        ${delayCode(points)}
      }
      if ((blep & 1 << i) !== 0) {
        const late = syncHeld[i];`,
    },
    {
      from: '        applySyncResets(voice);\n      }\n    }\n    let sig = 0;',
      to: `        applySyncResets(voice);
      }${edgesCode(points)}
    }
    let sig = 0;`,
    },
  ];
}

/** Every edit, in the bundle's order of appearance. */
export const DIRECT_EDITS = (points) => [...STATE_EDITS, ...renderEdits(points)];
