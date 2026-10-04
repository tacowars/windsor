/**
 * The FM bundle for the Acid Ladder's readings (windsor#573): one root's
 * `packages/engine/src/worklet/generated/fm-processor.js`, evaluated once
 * with a stand-in worklet scope, as the Formant bench loads it. Returns the
 * processor class, the frame setter and, where the bundle has them, the
 * ladder's class and its tuning (`Ladder`, `tuneLadder`, read by their
 * top-level names). `candidate` puts a ladder on one of the two solver
 * candidates of decision 6 and tunes it directly, without the shipped cap,
 * so a reading can run the other candidate and cutoffs past the top.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const SR = 48000;

export function loadBundle(root) {
  const source = readFileSync(
    join(root, 'packages', 'engine', 'src', 'worklet', 'generated', 'fm-processor.js'),
    'utf8',
  );
  let Processor = null;
  class PortShim {
    constructor() {
      this.port = { postMessage() {}, onmessage: null };
    }
  }
  const scope = new Function(
    'sampleRate',
    'AudioWorkletProcessor',
    'registerProcessor',
    `let currentFrame = 0; ${source};
    return {
      setFrame: (f) => { currentFrame = f; },
      Ladder: typeof Ladder === 'undefined' ? null : Ladder,
      tuneLadder: typeof tuneLadder === 'undefined' ? null : tuneLadder,
    };`,
  )(SR, PortShim, (_name, cls) => {
    Processor = cls;
  });
  return { Processor, ...scope };
}

/** The two solver candidates of decision 6 (the decimator is the 2× one's). */
export const CANDIDATES = {
  '1x4': { oversample: 1, steps: 4, capHz: 10000 },
  '2x3': { oversample: 2, steps: 3, capHz: Infinity },
};

/**
 * Put `ladder` on `candidate` at `cutoffHz` (held to its cap) and feedback
 * `k`, the high-pass at `hpHz`, with `taps` as its decimator if given:
 * h = tan(π f_c / (M f_s)) / 2^¼ and G = g / (1 + g) worked out here with
 * `Math.tan`, as the shipped tuning works them out in portable arithmetic.
 * On a bundle with the output mix (windsor#577) its gain is `mixGain` (0,
 * off, unless given) and its high-pass's corner `mixHz`, at the base rate.
 * On a bundle with the makeup (windsor#587) it is `makeup` (1, none, unless
 * given).
 */
export function candidate(
  ladder,
  name,
  { cutoffHz, k, hpHz = 150, taps, rate: baseRate = SR, mixGain = 0, mixHz = 400, makeup = 1 } = {},
) {
  const c = CANDIDATES[name];
  ladder.oversample = c.oversample;
  ladder.steps = c.steps;
  if (taps) {
    ladder.taps = Float64Array.from(taps);
    ladder.history = new Float64Array(taps.length);
  }
  const rate = baseRate * c.oversample;
  const fc = Math.min(cutoffHz, c.capHz);
  ladder.h = Math.tan((Math.PI * fc) / rate) / 2 ** 0.25;
  const g = Math.tan((Math.PI * hpHz) / rate);
  ladder.hpG = g / (1 + g);
  ladder.k = k;
  if ('mixG' in ladder) {
    const gm = Math.tan((Math.PI * mixHz) / baseRate);
    ladder.mixG = gm / (1 + gm);
    ladder.mixGain = mixGain;
  }
  if ('makeup' in ladder) ladder.makeup = makeup;
  ladder.reset();
  return ladder;
}

/** One sample through `ladder`, in the carrier's units. */
export function step(ladder, x) {
  ladder.point = x;
  ladder.process();
  return ladder.point;
}
