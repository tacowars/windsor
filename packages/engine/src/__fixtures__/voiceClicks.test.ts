/**
 * windsor#7: a retriggered voice under a low filter ends without a click.
 *
 * A mono note-on steals the sounding voice with the 4 ms fade, and the fade's
 * end kills it. Before the fix the fade ran ahead of the filter, so a low
 * cutoff was still ringing when the kill came, and `renderBlock` went on
 * rendering the killed voice (whose `fade` the kill resets to 1) to the end
 * of the segment: the ring came back at full level and was then cut to 0.
 * On `main` this line's largest step was 0.24 against a steady-state 0.025.
 *
 * The threshold is 0.05, twice the largest step the reproduction makes on
 * its own (0.025, the brightest accented note, well away from any
 * boundary): above it is a discontinuity no note in this line produces.
 * Measurements: `docs/research/2026-09-28-voice-clicks/`.
 */
import { describe, expect, it } from 'vitest';

import {
  CLICKS_LINE,
  CLICKS_PATCH,
  CLIPPY_PATCH,
  FIRST_FRAME,
  SLIDE_SECONDS,
  STEP_FRAMES,
  blocksFor,
  lineEvents,
  maxStep,
} from './voiceClicks';
import type { ScheduledEvent } from './workletHarness';
import { loadProcessor, render } from './workletHarness';

const loaded = loadProcessor();
const CLICK_THRESHOLD = 0.05;
/** Twice through the line, so step 0's slide has a held note to slide from. */
const LOOPS = 2;
const STEPS = CLICKS_LINE.length * LOOPS;
const BLOCK = 128;
/** A stop lands mid-step, with the note held in sustain. */
const STOP_INTO_STEP = 3000;
/** Long enough for the 0.4 s release and the filter's ring after it. */
const TAIL_SECONDS = 3;

function renderLine(patch: unknown, maxVoices = 16): Float32Array {
  const processor = loaded.create(patch, maxVoices, undefined, { slideSeconds: SLIDE_SECONDS });
  const result = render(loaded, processor, blocksFor(STEPS), lineEvents(CLICKS_LINE, LOOPS));
  expect(result.nonFinite).toBe(0);
  return result.samples;
}

/** The largest step inside step `k`'s window, from its note-on to the next. */
const stepWindow = (samples: Float32Array, k: number): number =>
  maxStep(samples, FIRST_FRAME + k * STEP_FRAMES, FIRST_FRAME + (k + 1) * STEP_FRAMES);

describe('voice clicks (windsor#7)', () => {
  const mono = renderLine(CLICKS_PATCH);

  it('retriggers a mono voice under a low filter without a click', () => {
    expect(maxStep(mono)).toBeLessThan(CLICK_THRESHOLD);
  });

  it('slides into the next step without a click', () => {
    const slid = CLICKS_LINE.length; // the second pass's step 0
    expect(stepWindow(mono, slid)).toBeLessThan(CLICK_THRESHOLD);
    expect(stepWindow(mono, slid + 1)).toBeLessThan(CLICK_THRESHOLD);
  });

  it('plays an accented step, and the step after it, without a click', () => {
    CLICKS_LINE.forEach((step, k) => {
      if (!step.accent) return;
      for (const at of [k, k + 1, k + CLICKS_LINE.length, k + CLICKS_LINE.length + 1]) {
        if (at < STEPS) expect(stepWindow(mono, at)).toBeLessThan(CLICK_THRESHOLD);
      }
    });
  });

  // Stop and pause both reach the worklet as the held note's off and an
  // `allNotesOff` (`AudioSystem.stopMusic` / `setMuted`, through
  // `ArrangementPlayer.releaseAll`): every voice releases. On `main` the
  // voice ended when its carrier envelopes did, cutting the resonant
  // filter's ring (0.07–0.12) to 0 in one sample at the end of the release.
  it.each([7, 15])('rings out after a stop at step %i and ends in silence', (step) => {
    const stopAt = FIRST_FRAME + step * STEP_FRAMES + STOP_INTO_STEP;
    const events = lineEvents(CLICKS_LINE, 1).filter((e) => e.frame < stopAt);
    events.push({ type: 'noteOff', id: step + 1, frame: stopAt });
    events.push({ type: 'allNotesOff', id: 0, frame: stopAt }); // the worklet reads no id on it
    const processor = loaded.create(CLIPPY_PATCH, 16, undefined, { slideSeconds: SLIDE_SECONDS });
    const blocks = Math.ceil((stopAt + TAIL_SECONDS * loaded.sampleRate) / BLOCK);
    const { samples, nonFinite } = render(loaded, processor, blocks, events);
    expect(nonFinite).toBe(0);
    expect(maxStep(samples, stopAt)).toBeLessThan(CLICK_THRESHOLD);
    expect(processor.voices.filter((v) => v.active)).toHaveLength(0);
  });

  it('retriggers the same note on a poly patch without a click, stealing or not', () => {
    const poly = { ...CLICKS_PATCH, mono: false };
    const same: ScheduledEvent[] = lineEvents(
      CLICKS_LINE.map(() => ({ note: 36 })),
      LOOPS,
    );
    for (const maxVoices of [16, 1]) {
      const processor = loaded.create(poly, maxVoices, undefined, { slideSeconds: SLIDE_SECONDS });
      const result = render(loaded, processor, blocksFor(STEPS), same);
      expect(result.nonFinite).toBe(0);
      expect(maxStep(result.samples)).toBeLessThan(CLICK_THRESHOLD);
    }
  });
});
