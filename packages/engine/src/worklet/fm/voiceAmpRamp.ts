/* eslint-disable no-magic-numbers -- DSP: MIDI 60 and the octave's 12 are the level key scaling's arithmetic; the tunables are fmConstants.ts (#654) */
/**
 * An operator's amplitude ramp for one control block (windsor#301): its
 * envelope advanced with every segment end at its own sample
 * (`Envelope.advanceExact`), and the per-sample ramp the render loops add
 * set to pass through those ends. With no end inside the block the ramp is
 * the old one, `(target - amp) / n`, and the block renders as it did. An end
 * at the block's first sample is a step before it; one inside it is a knot:
 * the loops count `ampBreak` down to it, land on `knotAmp`, take `knotInc`
 * and count `knotGap` to the next, so the ramp reaches the segment's target
 * at the segment's own sample and runs on the next segment's slope for the
 * rest of the block. An end that rounds to the block's last sample is left
 * to the block-end level, which the envelope has already moved past it.
 *
 * Invariant: allocation free and no double crosses a call (windsor#233): the
 * LFO levels are the voice's `lfoLevel` and `lfo2Level`, and the knots go to
 * the voice's preallocated rows. The level is the old update's expression,
 * term for term, so a block with no end inside it is the same bits
 * (`fmProcessorGolden.test.ts`, `synth/fmEnvelopeEdges.test.ts`); both
 * render loops read the knots alike (`fmProcessorKernel.test.ts`).
 */

import type { Voice } from './voice';
import { ENVELOPE_BREAKS_MAX } from './fmConstants';
import { VT_OP_BASE, VT_OP_LEVEL, VT_OP_STRIDE } from './voiceTargetTables';

/**
 * Advance operator `i`'s envelope by `n` samples and set its ramp: the
 * level is envelope × level² × velocity × key scale × the LFOs, as it has
 * always been, and each segment end inside the block becomes a knot at the
 * nearest sample. Two ends on one sample keep the later. Allocates nothing.
 */
function updateOperatorAmp(voice: Voice, i: number, n: number): void {
  const patch = voice.patch!;
  const op = patch.ops[i];
  const ampEnv = voice.ampEnv[i];
  ampEnv.advanceExact(n);
  const env = ampEnv.value;
  const velAmp = 1 - op.velSens + op.velSens * voice.velocity;
  const keyAmp = voice.specialise
    ? voice.levelKeyAmp[i]
    : Math.pow(2, -op.levelKeyScale * ((voice.note - 60) / 12));
  const lfoAmp = 1 + voice.lfoLevel * patch.lfo.toOp[i] + voice.lfo2Level * patch.lfo2.toOp[i];
  const lfo = lfoAmp < 0 ? 0 : lfoAmp;
  // The patch's, or the step's (windsor#17), with a song lane's offset (windsor#346).
  const level = voice.liveValues[VT_OP_BASE + i * VT_OP_STRIDE + VT_OP_LEVEL];
  const target = env * level * level * velAmp * keyAmp * lfo;

  voice.ampBreak[i] = 0;

  // The knots, in order: `knotGap` holds each one's sample until the ramps
  // are set from them below. With none, the one ramp below is the old
  // `(target - amp) / n`, operation for operation.
  const base = i * ENVELOPE_BREAKS_MAX;
  const knotAmp = voice.knotAmp,
    knotAt = voice.knotGap;
  let count = 0;
  for (let j = 0; j < ampEnv.breaks; j++) {
    const at = Math.round(ampEnv.breakAt[j]);
    if (at >= n) break;
    const v = ampEnv.breakLevel[j] * level * level * velAmp * keyAmp * lfo;
    if (at === 0) {
      voice.amp[i] = v; // a step at the block's first sample
    } else if (count > 0 && knotAt[base + count - 1] === at) {
      knotAmp[base + count - 1] = v;
    } else {
      knotAt[base + count] = at;
      knotAmp[base + count] = v;
      count++;
    }
  }

  // Each ramp runs from where the last one landed (the knot's float32 level)
  // to the next knot, and the last to the block-end level.
  let from = voice.amp[i],
    fromAt = 0;
  for (let k = 0; k < count; k++) {
    const to = knotAmp[base + k],
      toAt = knotAt[base + k];
    const inc = (to - from) / (toAt - fromAt);
    if (k === 0) {
      voice.ampInc[i] = inc;
      voice.ampBreak[i] = toAt;
    } else {
      voice.knotInc[base + k - 1] = inc;
      knotAt[base + k - 1] = toAt - fromAt;
    }
    from = to;
    fromAt = toAt;
  }
  const inc = (target - from) / (n - fromAt);
  if (count === 0) voice.ampInc[i] = inc;
  else {
    voice.knotInc[base + count - 1] = inc;
    knotAt[base + count - 1] = 0;
    voice.ampKnot[i] = base;
  }
}

export { updateOperatorAmp };
