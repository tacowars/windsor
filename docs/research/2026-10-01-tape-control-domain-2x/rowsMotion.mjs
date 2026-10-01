/** windsor#315 (fix round on PR #317): the motion gate. A trial whose knobs did not move as
 * commanded tests nothing about motion, so it fails the run, whatever it survived. From each
 * saved record and its scheduled trial:
 *
 * - a **static** trial holds its point exactly, on every axis;
 * - a **sweep** holds its other two controls exactly at their values, and on its swept axis
 *   stays inside the box (to `epsilon`) and reaches within the glide's tracking lag of both
 *   ends. The lag is the bound of a first-order glide, time constant `TAPE_DSP.smoothSeconds`,
 *   after a ramp of the sweep's slope a = span / (period / 2), with the per-sample step and
 *   the block's held target: a (tau + (block + 1) / rate). A trial that never moved misses
 *   the far end by the whole span;
 * - a **walk** stays inside the box (to `epsilon`), and at every one of its holds' ends
 *   (one per hold of the program) every control is at a value it took at no other hold's end.
 */
const kinds = { static: staticGate, sweep: sweepGate, walk: walkGate };

const inBox = (reached, box, eps) =>
  reached.every(([lo, hi], i) => lo >= box[i][0] - eps && hi <= box[i][1] + eps);
const held = (r, c) => Boolean(c) && r[0] === r[1] && c[0] === c[1] && r[0] === c[0];

function staticGate(trial, record) {
  const p = trial.path.point;
  return record.reached.every(([lo, hi], i) => lo === p[i] && hi === p[i]) ? [] : ['static: moved'];
}

/** The tracking lag a first-order glide may keep behind the sweep's ramp. */
export function sweepLag(trial, S) {
  const { path, rate, box } = trial,
    span = box[path.axis][1] - box[path.axis][0];
  const slope = span / (path.period / 2);
  return slope * (S.TAPE_DSP.smoothSeconds + (S.CONTROL.block + 1) / rate);
}

function sweepGate(trial, record, S) {
  const { axis } = trial.path,
    box = trial.box,
    eps = S.ROWS.motion.epsilon;
  const lag = sweepLag(trial, S),
    [lo, hi] = record.reached[axis];
  const out = [];
  record.reached.forEach((r, i) => {
    if (i !== axis && !held(r, record.commanded?.[i])) out.push(`sweep: axis ${i} moved`);
  });
  if (!inBox([record.reached[axis]], [box[axis]], eps)) out.push('sweep: left the box');
  if (lo > box[axis][0] + lag) out.push('sweep: low end not reached');
  if (hi < box[axis][1] - lag) out.push('sweep: high end not reached');
  return out;
}

function walkGate(trial, record, S) {
  const { holds, distinct } = record.holdEnds ?? { holds: 0, distinct: [0, 0, 0] };
  const want = Math.ceil(S.CONTROL.seconds / trial.path.hold);
  const out = [];
  if (!inBox(record.reached, trial.box, S.ROWS.motion.epsilon)) out.push('walk: left the box');
  if (holds !== want) out.push(`walk: ${holds} hold ends of ${want}`);
  if (!distinct.every((d) => d === want)) out.push('walk: a hold end repeated a point');
  return out;
}

/** Each record against its trial: the failures, with reasons; per sweep period, the smallest
 * fraction of its span a sweep reached; per walk kind, the largest distance (on any axis)
 * from a hold's end to the target then in force. */
export function motionResult(records, trials, S) {
  const byId = new Map(trials.map((t) => [t.id, t]));
  const failures = [],
    minSweepReach = {},
    maxHoldLag = {};
  for (const record of records) {
    const trial = byId.get(record.id);
    if (!trial) continue;
    const reasons = kinds[trial.path.kind](trial, record, S);
    if (reasons.length) failures.push({ id: record.id, reasons });
    if (trial.path.kind === 'sweep') {
      const [lo, hi] = trial.box[trial.path.axis],
        r = record.reached[trial.path.axis];
      const key = String(trial.path.period),
        fraction = (r[1] - r[0]) / (hi - lo);
      minSweepReach[key] = Math.min(minSweepReach[key] ?? Infinity, fraction);
    }
    if (trial.path.kind === 'walk') {
      const key = trial.path.name;
      maxHoldLag[key] = Math.max(maxHoldLag[key] ?? 0, record.holdEnds?.holdLag ?? Infinity);
    }
  }
  return { checked: records.length, passed: !failures.length, failures, minSweepReach, maxHoldLag };
}

/** The gate's cases, run by `--check`: each part's saved record passes, and the same record
 * with its controls frozen at the start (what PR #317's first run recorded) fails. */
export function motionGateCases(saved, trials, S) {
  const byId = new Map(trials.map((t) => [t.id, t]));
  const pick = (kind) => saved.find((r) => byId.get(r.id)?.path.kind === kind);
  const frozen = (record) => {
    const start = record.commanded.map(([lo]) => [lo, lo]);
    const walk = record.holdEnds && { ...record.holdEnds, distinct: [1, 1, 1] };
    return { ...record, reached: start, ...(walk ? { holdEnds: walk } : {}) };
  };
  const moved = (record) => !motionResult([record], trials, S).failures.length;
  return ['sweep', 'walk'].flatMap((kind) => {
    const record = pick(kind);
    return [
      { name: `${kind}: saved record passes`, pass: Boolean(record) && moved(record) },
      { name: `${kind}: frozen record fails`, pass: Boolean(record) && !moved(frozen(record)) },
    ];
  });
}
