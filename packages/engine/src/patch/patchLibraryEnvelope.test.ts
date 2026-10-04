/**
 * Long-note checks: every library patch in a sustained category is finite and audible through its whole
 * envelope and releases; the chord families keep headroom for four notes.
 * Driven by the files' own categories, so a patch saved from the editor is
 * held to the same bar as the bank it joins. Real worklet, dry output.
 */
import { describe, expect, it } from 'vitest';
import { loadProcessor, render } from '../__fixtures__/workletHarness';
import { FILTER_MODE, type Patch } from './patch';
import { PATCH_LIBRARY } from './presets';

const dsp = loadProcessor();
const BLOCK = 128;
/** The scoring families (#475): sustained voices, checked through the full envelope. */
const SUSTAINED = ['Strings', 'Pads', 'Plucks', 'Basses', 'Soundtrack FX'];
const CHORDED = ['Strings', 'Pads', 'Plucks'];
/**
 * The pre-#475 bank was levelled for the game mix, not the scoring bar
 * (`lead-bell` peaks 2.4 on a four-note chord at full velocity), and its
 * files say so in their tags. Everything else in a sustained category —
 * the scoring bank and any patch saved from the editor — is held to the bar.
 */
const LEGACY_TAGS = ['original', 'authored', 'legacy'];
const LIBRARY = Object.values(PATCH_LIBRARY);
const isLegacy = (tags: readonly string[]): boolean =>
  tags.some((tag) => LEGACY_TAGS.includes(tag));
const sustained = LIBRARY.filter(
  (entry) => SUSTAINED.includes(entry.category) && !isLegacy(entry.tags),
);
const rest = LIBRARY.filter((entry) => !sustained.includes(entry));
/**
 * The Acid mode's ring after the envelopes end (windsor#574): with
 * resonance, the ladder's feedback loop through its high-pass has a slow
 * mode (about 20 ms), and the voice ends only when every ladder state is
 * under the dormancy floor (about −180 dB), 0.31–0.55 s after the note-off
 * on the factory acid patches (`docs/research/2026-10-04-acid-ladder-filter/`).
 */
const LADDER_RING_S = 0.6;
/** How long a released note may take to end: its longest release, a margin, and the ladder's ring. */
const tailSeconds = (patch: Patch): number =>
  Math.max(...patch.ops.map((op) => op.env.releaseTime)) +
  0.1 +
  (patch.filter.mode === FILTER_MODE.LADDER ? LADDER_RING_S : 0);

describe('every other patch', () => {
  it.each(rest)('$id is finite, audible and releases', ({ patch }) => {
    const hold = Math.max(
      ...patch.ops.map((op) => op.env.attackTime + op.env.decayTime),
      patch.filter.env.attackTime + patch.filter.env.decayTime,
      2,
    );
    const tail = tailSeconds(patch);
    const processor = dsp.create(patch, 16, 0xa204);
    const result = render(
      dsp,
      processor,
      Math.ceil(((hold + tail) * dsp.sampleRate) / BLOCK),
      [
        { type: 'noteOn', id: 1, note: 60, velocity: 1, frame: 0 },
        { type: 'noteOff', id: 1, frame: Math.ceil(hold * dsp.sampleRate) },
      ],
      { collectSamples: false },
    );
    expect(result.nonFinite).toBe(0);
    expect(result.peak).toBeGreaterThan(0.002);
    expect(processor.voices.filter((voice) => voice.active)).toHaveLength(0);
  });
});

describe('sustained patches through the envelope and release', () => {
  it('covers the scoring bank', () => {
    expect(sustained.length).toBeGreaterThanOrEqual(100);
  });
  it.each(sustained)(
    '$id is finite and audible through its envelope and release',
    ({ patch, category }) => {
      const hold = Math.max(
        ...patch.ops.map((op) => op.env.attackTime + op.env.decayTime),
        patch.filter.env.attackTime + patch.filter.env.decayTime,
        2,
      );
      const tail = tailSeconds(patch);
      const frames = Math.ceil(hold * dsp.sampleRate);
      const blocks = Math.ceil(((hold + tail) * dsp.sampleRate) / BLOCK);
      const notes = category === 'Basses' ? [24, 36, 48] : [36, 60, 84];
      for (const note of notes) {
        const processor = dsp.create(patch, 16, 0xa204);
        const result = render(
          dsp,
          processor,
          blocks,
          [
            { type: 'noteOn', id: 1, note, velocity: 1, frame: 0 },
            { type: 'noteOff', id: 1, frame: frames },
          ],
          { collectSamples: false },
        );
        expect(result.nonFinite, `note ${note}`).toBe(0);
        expect(result.peak, `note ${note}`).toBeGreaterThan(0.002);
        expect(result.peak, `note ${note}`).toBeLessThan(0.8);
        expect(
          processor.voices.filter((voice) => voice.active),
          `note ${note} releases`,
        ).toHaveLength(0);
      }
    },
  );
  it.each(sustained.filter((entry) => CHORDED.includes(entry.category)))(
    '$id keeps headroom for a four-note chord',
    ({ patch }) => {
      const seconds = Math.max(...patch.ops.map((op) => op.env.attackTime + op.env.decayTime), 2);
      const events = [48, 55, 60, 63].map((note, id) => ({
        type: 'noteOn' as const,
        id,
        note,
        velocity: 1,
        frame: 0,
      }));
      const result = render(
        dsp,
        dsp.create(patch, 16),
        Math.ceil((seconds * dsp.sampleRate) / BLOCK),
        events,
        { collectSamples: false },
      );
      expect(result.nonFinite).toBe(0);
      expect(result.peak).toBeGreaterThan(0.002);
      expect(result.peak).toBeLessThan(1);
    },
  );
});
