/**
 * A live patch edit under a voice lane (windsor#346, fix round 2 of PR #385):
 * with live retune on, a ringing voice rebound to the edited patch keeps the
 * lane's absolute value through the edit, with no ramp, though the patch
 * message arrives before the lane's offset against the new patch
 * (`ArrangementPlayer.apply` posts the patch, then `AudioSystem.apply`
 * resyncs the lanes). The rebind keeps what an automated target plays until
 * the next control block reads the offsets against the new patch; a target
 * no lane moves is still heard at once.
 *
 * One control block a call, so the block of the edit is seen alone. The
 * harness hands the message to the processor before the block's params,
 * which is the order the main thread writes them in.
 */
import { describe, expect, it } from 'vitest';

import type { ProcessorLike } from '../__fixtures__/workletHarness';
import { loadProcessor } from '../__fixtures__/workletHarness';
import { catalogRow, voiceTargetId } from '../automation/automationTargets';
import { FILTER_MODE, WAVE, makeEnvelope, makePatch, type Patch } from '../patch/patch';
import { voiceSlotParamName } from './audioPart';
import { voiceOffset } from './voiceAutomation';

const loaded = loadProcessor();
const SLOTS = 8;
const NOTE = 60;
const BLOCKS = 12;
/** The control block the patch edit lands before. */
const EDIT = 5;

/** The internals these tests read off a voice. */
interface VoiceView {
  active: boolean;
  fbFrom: Float32Array;
  fbTo: Float32Array;
  fbRamp: number;
  width: Float32Array;
  widthInc: Float32Array;
  svfA: { cutoffHz: number };
}

const held = (): ReturnType<typeof makeEnvelope> =>
  makeEnvelope({ attackTime: 0.002, decayTime: 0.05, sustainLevel: 0.75 });

/** Two sine carriers through a low-pass, nothing else moving them. */
const base = makePatch({
  algorithm: 7,
  ops: [
    { wave: WAVE.SINE, level: 0.5, feedback: 0, width: 0.75, env: held() },
    { wave: WAVE.SINE, ratio: 2, level: 0.5, feedback: 0, env: held() },
  ],
  filter: { mode: FILTER_MODE.LOWPASS, cutoff: 1200, resonance: 0.707, env: held() },
});

/** `patch` with each number at its path set. */
function edited(patch: Patch, values: Record<string, number>): Patch {
  const copy = structuredClone(patch);
  for (const [path, value] of Object.entries(values)) {
    const keys = path.split('.');
    let at = copy as unknown as Record<string, unknown>;
    for (const key of keys.slice(0, -1)) at = at[key] as Record<string, unknown>;
    at[keys.at(-1)!] = value;
  }
  return copy;
}

const offsetFor = (patch: Patch, path: string, value: number): number =>
  voiceOffset(patch, path, catalogRow(voiceTargetId(path))!, value);

interface Edit {
  /** The lanes, by slot, and their absolute values. */
  lanes: readonly (readonly [string, number])[];
  /** The patch the voice is edited to. */
  to: Patch;
  /** After each control block, with the held note's voice. */
  after: (b: number, voice: VoiceView) => void;
  /** Right after the edit's message, before its block renders. */
  rebound?: (voice: VoiceView) => void;
}

/** A held note with its lanes, the patch edited before block `EDIT` with the offsets resynced. */
function editUnderLanes(e: Edit): void {
  const slots = e.lanes.map(([path]) => path);
  const processor = loaded.create(base, 4, undefined, { voiceSlots: slots });
  const params: Record<string, Float32Array> = {
    pitchBend: new Float32Array([0]),
    modWheel: new Float32Array([0]),
    gain: new Float32Array([1]),
  };
  for (let i = 0; i < SLOTS; i++) params[voiceSlotParamName(i)] = new Float32Array([0]);
  const frames = loaded.ctrlInterval;
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  const voiceOf = (p: ProcessorLike): VoiceView =>
    (p.voices as unknown as VoiceView[]).find((v) => v.active)!;
  processor.inbox({ type: 'liveRetune', enabled: true } as never);
  processor.inbox({ type: 'noteOn', id: 1, note: NOTE, velocity: 1, frame: 0 });
  for (let b = 0; b < BLOCKS; b++) {
    loaded.setFrame(b * frames);
    if (b === EDIT) {
      processor.inbox({ type: 'patch', patch: e.to } as never);
      e.rebound?.(voiceOf(processor));
    }
    const patch = b >= EDIT ? e.to : base;
    e.lanes.forEach(([path, value], i) => {
      params[voiceSlotParamName(i)]![0] = offsetFor(patch, path, value);
    });
    processor.process([], [[left, right]], params);
    e.after(b, voiceOf(processor));
  }
}

describe('a live patch edit under a voice lane (windsor#346)', () => {
  it('keeps a feedback lane at 0.5 through an edit of its base from 0 to -0.25, with no ramp', () => {
    editUnderLanes({
      lanes: [['ops.0.feedback', 0.5]],
      to: edited(base, { 'ops.0.feedback': -0.25 }),
      rebound: (voice) => {
        expect(voice.fbFrom[0]).toBe(0.5);
        expect(voice.fbTo[0]).toBe(0.5);
      },
      after: (_b, voice) => {
        expect(voice.fbFrom[0]).toBe(0.5);
        expect(voice.fbTo[0]).toBe(0.5);
        expect(voice.fbRamp & 1).toBe(0);
      },
    });
  });

  it('still hears an edit to a feedback no lane moves at once', () => {
    editUnderLanes({
      lanes: [['ops.0.feedback', 0.5]],
      to: edited(base, { 'ops.1.feedback': 0.25 }),
      rebound: (voice) => {
        expect(voice.fbFrom[1]).toBe(0.25);
        expect(voice.fbTo[1]).toBe(0.25);
        expect(voice.fbRamp & 2).toBe(0);
      },
      after: (b, voice) => {
        expect(voice.fbTo[0]).toBe(0.5);
        expect(voice.fbTo[1]).toBe(b >= EDIT ? 0.25 : 0);
        expect(voice.fbRamp).toBe(0);
      },
    });
  });

  it('keeps a width lane at 0.5 through an edit of its base from 0.75 to 0.25', () => {
    editUnderLanes({
      lanes: [['ops.0.width', 0.5]],
      to: edited(base, { 'ops.0.width': 0.25 }),
      after: (_b, voice) => {
        // A sine reads width as a phase scale: 1 / 0.5.
        expect(voice.width[0]).toBe(2);
        expect(voice.widthInc[0]).toBe(0);
      },
    });
  });

  it('keeps a width lane at 0.5 through a switch to PULSE that also edits its base', () => {
    editUnderLanes({
      lanes: [['ops.0.width', 0.5]],
      to: edited(base, { 'ops.0.wave': WAVE.PULSE, 'ops.0.width': 0.25 }),
      after: (b, voice) => {
        // A pulse reads width as its duty, a sine as a phase scale.
        expect(voice.width[0]).toBe(b >= EDIT ? 0.5 : 2);
        expect(voice.widthInc[0]).toBe(0);
      },
    });
  });

  it('keeps the cutoff lane at 2400 Hz through an edit of its base from 1200 to 600 Hz', () => {
    editUnderLanes({
      lanes: [['filter.cutoff', 2400]],
      to: edited(base, { 'filter.cutoff': 600 }),
      after: (_b, voice) => expect(voice.svfA.cutoffHz / 2400).toBeCloseTo(1, 9),
    });
  });

  it('keeps every lane through one edit that moves all their bases', () => {
    editUnderLanes({
      lanes: [
        ['ops.0.feedback', 0.5],
        ['ops.0.width', 0.5],
        ['filter.cutoff', 2400],
      ],
      to: edited(base, { 'ops.0.feedback': -0.25, 'ops.0.width': 0.25, 'filter.cutoff': 600 }),
      after: (_b, voice) => {
        expect(voice.fbFrom[0]).toBe(0.5);
        expect(voice.fbTo[0]).toBe(0.5);
        expect(voice.width[0]).toBe(2);
        expect(voice.widthInc[0]).toBe(0);
        expect(voice.svfA.cutoffHz / 2400).toBeCloseTo(1, 9);
      },
    });
  });
});
