/**
 * The legato slide (#602): a `slide` note-on in mono re-targets the sounding
 * voice instead of allocating one. Nothing retriggers — the carrier's
 * amplitude envelope stays in sustain across the slide, the sample stream has
 * no discontinuity at the slide frame, and the pitch glides to the target
 * over the slide time. Outside mono, or with nothing sounding, the flag is
 * ignored and the note-on is ordinary.
 */
import { describe, expect, it } from 'vitest';

import type { LoadedProcessor, ProcessorLike, ScheduledEvent } from './__fixtures__/workletHarness';
import { loadProcessor, render } from './__fixtures__/workletHarness';
import { makeEnvelope, makePatch, type PartialPatch } from './patch';

const loaded: LoadedProcessor = loadProcessor();
const BLOCK = 128;
const FROM = 60;
const TO = 67;
/** Blocks before the slide: past a 5 ms attack and well into sustain. */
const BEFORE = 20;
/** Blocks after: over five slide time constants at 20 ms. */
const AFTER = 60;
const SLIDE_SECONDS = 0.02;

interface VoiceInternals {
  active: boolean;
  gate: boolean;
  fading: boolean;
  voiceId: number;
  note: number;
  pitchCur: number;
  ampEnv: Array<{ state: number }>;
}

const internals = (processor: ProcessorLike): VoiceInternals[] =>
  processor.voices as unknown as VoiceInternals[];

const active = (processor: ProcessorLike): VoiceInternals[] =>
  internals(processor).filter((v) => v.active);

/** One sine carrier (op A alone), sustaining at full level. */
const sustaining = (over: PartialPatch = {}): unknown =>
  makePatch({
    mono: true,
    glide: 0,
    ops: [
      {
        level: 1,
        env: makeEnvelope({ attackTime: 0.005, decayTime: 0.005, peakLevel: 1, sustainLevel: 1 }),
      },
      { level: 0 },
      { level: 0 },
      { level: 0 },
    ],
    ...over,
  });

const SLIDE_FRAME = BEFORE * BLOCK;

/** Note 60 from frame 0, then at the slide frame a slide to 67 and the old handle's off — the grid's order. */
const slideEvents: ScheduledEvent[] = [
  { type: 'noteOn', id: 1, note: FROM, velocity: 0.8, frame: 0 },
  { type: 'noteOn', id: 2, note: TO, velocity: 0.8, frame: SLIDE_FRAME, slide: true },
  { type: 'noteOff', id: 1, frame: SLIDE_FRAME },
];

function maxStep(samples: Float32Array, fromFrame: number, toFrame: number): number {
  let max = 0;
  for (let i = fromFrame + 1; i < toFrame; i++) {
    const step = Math.abs((samples[i * 2] ?? 0) - (samples[(i - 1) * 2] ?? 0));
    if (step > max) max = step;
  }
  return max;
}

describe('slide (#602)', () => {
  it('keeps one voice, no envelope restart, no discontinuity, and glides to the target', () => {
    const processor = loaded.create(sustaining(), 4, undefined, { slideSeconds: SLIDE_SECONDS });
    // Render up to the slide, note the carrier's envelope stage, then carry on.
    const before = render(loaded, processor, BEFORE, slideEvents);
    const [voice] = active(processor);
    expect(active(processor)).toHaveLength(1);
    expect(voice!.ampEnv[0]!.state).toBe(loaded.sustainState);
    expect(voice!.voiceId).toBe(1);

    // The slide block and after: same voice object, now under handle 2.
    const events = slideEvents.map((e) => ({ ...e, frame: e.frame - SLIDE_FRAME })).slice(1);
    const after = render(loaded, processor, AFTER, events);
    expect(active(processor)).toHaveLength(1);
    expect(active(processor)[0]).toBe(voice);
    expect(voice!.voiceId).toBe(2);
    expect(voice!.note).toBe(TO);
    expect(voice!.gate).toBe(true);
    expect(voice!.ampEnv[0]!.state).toBe(loaded.sustainState);
    expect(Math.abs(voice!.pitchCur - TO)).toBeLessThan(0.05);

    // No jump at the slide frame: the step across it is no larger than a
    // sine at the higher pitch moves anyway (twice the pre-slide maximum is a
    // generous bound; a retrigger from zero or a phase reset is many times it).
    const steady = maxStep(before.samples, BLOCK, BEFORE * BLOCK);
    const acrossSlide = Math.abs(
      (after.samples[0] ?? 0) - (before.samples[(BEFORE * BLOCK - 1) * 2] ?? 0),
    );
    expect(acrossSlide).toBeLessThan(2 * steady);
    expect(maxStep(after.samples, 0, 2 * BLOCK)).toBeLessThan(2 * steady);
    expect(after.nonFinite).toBe(0);
    expect(after.peak).toBeGreaterThan(0.1);
  });

  it('the old handle’s note-off is a no-op after the slide; the new handle releases the voice', () => {
    const processor = loaded.create(sustaining(), 4, undefined, { slideSeconds: SLIDE_SECONDS });
    render(loaded, processor, BEFORE + 4, slideEvents);
    const [voice] = active(processor);
    expect(voice!.gate).toBe(true);
    render(loaded, processor, 2, [{ type: 'noteOff', id: 2, frame: 0 }]);
    expect(voice!.gate).toBe(false);
  });

  it('uses the patch’s own glide when it is set, and is instant when neither is', () => {
    const slow = loaded.create(sustaining({ glide: 0.5 }), 4, undefined, {
      slideSeconds: SLIDE_SECONDS,
    });
    render(loaded, slow, BEFORE + AFTER, slideEvents);
    const [slowVoice] = active(slow);
    // Half a second of glide has barely started after 160 ms.
    expect(slowVoice!.pitchCur).toBeGreaterThan(FROM);
    expect(slowVoice!.pitchCur).toBeLessThan(FROM + (TO - FROM) * 0.5);

    const instant = loaded.create(sustaining(), 4);
    render(loaded, instant, BEFORE + 2, slideEvents);
    expect(active(instant)[0]!.pitchCur).toBe(TO);
  });

  it('with nothing sounding a slide is an ordinary note-on', () => {
    const processor = loaded.create(sustaining(), 4);
    render(loaded, processor, 4, [
      { type: 'noteOn', id: 1, note: TO, velocity: 0.8, frame: 0, slide: true },
    ]);
    expect(active(processor)).toHaveLength(1);
    expect(active(processor)[0]!.voiceId).toBe(1);
    expect(active(processor)[0]!.note).toBe(TO);
  });

  it('outside mono the flag is ignored: the slid note is a second voice', () => {
    const processor = loaded.create(sustaining({ mono: false }), 4);
    render(loaded, processor, BEFORE + 2, slideEvents);
    // Two voices: the released first note is still in its release tail.
    const voices = active(processor);
    expect(voices).toHaveLength(2);
    expect(voices.map((v) => v.note).sort()).toEqual([FROM, TO]);
  });

  it('a plain mono retrigger, for contrast, restarts the envelope in a fresh voice', () => {
    const processor = loaded.create(sustaining(), 4);
    const plain = slideEvents.map((e) => (e.slide ? { ...e, slide: false } : e));
    render(loaded, processor, BEFORE, plain);
    const [first] = active(processor);
    render(
      loaded,
      processor,
      1,
      plain.slice(1).map((e) => ({ ...e, frame: 0 })),
    );
    const sounding = active(processor).filter((v) => v.gate);
    expect(sounding).toHaveLength(1);
    expect(sounding[0]).not.toBe(first);
    expect(sounding[0]!.ampEnv[0]!.state).not.toBe(loaded.sustainState);
  });
});
