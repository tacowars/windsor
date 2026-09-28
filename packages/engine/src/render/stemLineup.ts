/**
 * Whether two stem passes line up (windsor#41): every pass renders the
 * master on channels 0–1, so a later pass's master is compared with the
 * first's.
 *
 * Not bit for bit. The stems themselves come out bit-identical from pass to
 * pass in Chrome, but the master does not: Chrome sums a node's inputs in an
 * order it does not fix, and the master's input sums three or more sources
 * (the dry bus and each return), so float rounding differs from render to
 * render — by up to 1.0e-6 between two renders of the same song, measured in
 * headless Chrome 153 on an Apple M1. What a pass that drifted would show is
 * a note in another place: whole blocks of the envelope changed. So the
 * check keeps each channel's summed magnitude per render quantum — a few
 * kilobytes, not a second copy of the master — and allows each block
 * `RENDER_STEM_LINEUP_TOLERANCE` per sample.
 */
import { RENDER_QUANTUM_FRAMES, RENDER_STEM_LINEUP_TOLERANCE } from './renderConstants';

/** Per channel, the sum of |sample| over each render quantum, in order. */
export function blockEnvelope(channels: readonly Float32Array[]): Float64Array {
  const frames = channels[0]?.length ?? 0;
  const blocks = Math.ceil(frames / RENDER_QUANTUM_FRAMES);
  const envelope = new Float64Array(blocks * channels.length);
  channels.forEach((channel, c) => {
    for (let i = 0; i < channel.length; i++) {
      envelope[c * blocks + Math.floor(i / RENDER_QUANTUM_FRAMES)]! += Math.abs(channel[i]!);
    }
  });
  return envelope;
}

/** Whether two envelopes agree block for block, within `tolerance` per sample. */
export function envelopesMatch(
  a: Float64Array,
  b: Float64Array,
  tolerance: number = RENDER_STEM_LINEUP_TOLERANCE,
): boolean {
  if (a.length !== b.length) return false;
  const allowed = tolerance * RENDER_QUANTUM_FRAMES;
  return a.every((value, i) => Math.abs(value - b[i]!) <= allowed);
}
