/**
 * An envelope's 0 is the patch's own value in the worklet too (windsor#718):
 * the slot map and slot values a real part's clip envelope writes, played
 * by the FM processor block by block. Over a decay time and an LFO rate of
 * exactly 0, an envelope at 0 renders sample for sample as no envelope;
 * the same slot floored, as a lane's is (windsor#347), would not. Once the
 * envelope rises above 0 the target moves.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { RIG_START } from '../__fixtures__/automationRig';
import {
  ENVELOPE_SONG_TICKS,
  ENVELOPE_TICK,
  clipEnvelopeRig,
  envPoint,
  envelope,
  rollPart,
  rollPattern,
} from '../__fixtures__/clipEnvelopeRig';
import type { FakeParam } from '../__fixtures__/fakeAudioNodes';
import { installWorklet } from '../__fixtures__/stripRig';
import type { ScheduledEvent } from '../__fixtures__/workletHarness';
import { loadProcessor } from '../__fixtures__/workletHarness';
import { WAVE, makeEnvelope, makePatch, type Patch } from '../patch/patch';
import type { RollEnvelope } from '../sequencing/rollEnvelope';
import { voiceSlotParamName } from '../synth/audioPart';
import type { VoiceSlotsMessage } from '../synth/workletMessages';

let restore: () => void = () => {};
beforeAll(() => {
  restore = installWorklet();
});
afterAll(() => restore());

const loaded = loadProcessor();
const SR = loaded.sampleRate;
const BLOCK = 128;
const SLOTS = 8;
const ADDITIVE = 7;
const NOTE = 57;
/** Ticks the rig plays, and the blocks rendered: about ten ticks at 120 BPM. */
const TICKS = 12;
const BLOCKS = 80;

/** One carrier whose decay is instant, and an LFO on its pitch that stands still. */
const PATCH: Patch = makePatch({
  algorithm: ADDITIVE,
  ops: [1, 2, 3, 4].map((ratio, i) => ({
    wave: WAVE.SINE,
    ratio,
    level: i === 0 ? 1 : 0,
    env: makeEnvelope({ attackTime: 0.002, decayTime: 0, sustainLevel: 0.5 }),
  })),
  lfo: { amount: 0.5, rate: 0, toPitch: 0.5 },
});

interface Played {
  readonly map: VoiceSlotsMessage;
  readonly slot: FakeParam;
  readonly index: number;
}

/** What a part playing `env` over the whole song tells the processor: its slot map and its slot. */
async function play(env: RollEnvelope): Promise<Played> {
  const part = rollPart([
    { start: 0, duration: ENVELOPE_SONG_TICKS, pattern: rollPattern(96, [env]) },
  ]);
  const rig = await clipEnvelopeRig(part, { patch: PATCH });
  rig.run(TICKS);
  const index = rig.part.voiceSlotOf(env.target)!;
  return { map: rig.lastSlotMap() as VoiceSlotsMessage, slot: rig.slot(env.target), index };
}

/** The processor's render of a held note, with `played`'s map and its slot read at each block's start. */
function render(played?: Played): Float32Array {
  const processor = loaded.create(PATCH, 4);
  const params: Record<string, Float32Array> = {
    pitchBend: new Float32Array([0]),
    modWheel: new Float32Array([0]),
    gain: new Float32Array([1]),
  };
  for (let i = 0; i < SLOTS; i++) params[voiceSlotParamName(i)] = new Float32Array([0]);
  const left = new Float32Array(BLOCK);
  const right = new Float32Array(BLOCK);
  const out = new Float32Array(BLOCKS * BLOCK);
  for (let b = 0; b < BLOCKS; b++) {
    loaded.setFrame(b * BLOCK);
    if (b === 0) {
      // The harness's event type carries a frame; a slot map arrives as the port delivers it.
      if (played) processor.inbox(played.map as unknown as ScheduledEvent);
      const on: ScheduledEvent = { type: 'noteOn', id: 1, note: NOTE, velocity: 1, frame: 0 };
      processor.inbox(on);
    }
    if (played) {
      params[voiceSlotParamName(played.index)]![0] = played.slot.valueAt(
        RIG_START + (b * BLOCK) / SR,
      );
    }
    processor.process([], [[left, right]], params);
    out.set(left, b * BLOCK);
  }
  return out;
}

/** `played` with its slot floored, as a lane's slot map leaves it. */
const floored = (played: Played): Played => ({
  ...played,
  map: { type: 'voiceSlots', slots: played.map.slots },
});

describe('an envelope at 0 over a target at exactly 0', () => {
  const plain = render();

  it.each([['ops.0.env.decayTime'], ['lfo.rate']] as const)(
    'renders %s as no envelope does, sample for sample',
    async (path) => {
      const played = await play(envelope(path, [envPoint(0, 0)]));
      expect(played.map.relative?.[played.index]).toBe(true);
      expect(render(played)).toEqual(plain);
      // The same slot floored plays the row's floor, 1 ms or 0.02 Hz, not 0.
      expect(render(floored(played))).not.toEqual(plain);
    },
  );

  it('moves the decay once the envelope is above 0', async () => {
    const played = await play(envelope('ops.0.env.decayTime', [envPoint(0, 1)]));
    expect(render(played)).not.toEqual(plain);
  });

  it('starts the LFO where the envelope rises from 0, and not before', async () => {
    const played = await play(envelope('lfo.rate', [envPoint(4, 0), envPoint(8, 1)]));
    const moving = render(played);
    // Up to tick 4 the slot reads exactly 0: the LFO stands still, as the patch has it.
    const still = Math.floor((4 * ENVELOPE_TICK * SR) / BLOCK);
    expect(moving.subarray(0, still * BLOCK)).toEqual(plain.subarray(0, still * BLOCK));
    expect(moving.subarray(still * BLOCK)).not.toEqual(plain.subarray(still * BLOCK));
  });
});
