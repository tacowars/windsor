/**
 * A roll's clip envelopes on the live system (windsor#702): read from the
 * document at `initMusic`, heard on a held note through the part's voice
 * slot as the transport plays, and dropped by a live edit. A song with no
 * envelopes takes no slot. The player's own rules are
 * `automation/clipEnvelopePlayer.test.ts`.
 */
import { afterAll, describe, expect, it } from 'vitest';

import { envPoint, envelope, envelopeOffsetAt } from '../__fixtures__/clipEnvelopeRig';
import type { FakeContext, FakeWorkletNode } from '../__fixtures__/fakeAudioContext';
import type { FakeParam } from '../__fixtures__/fakeAudioNodes';
import { FULL_DOCUMENT, FULL_SLOT, withDocumentPart } from '../__fixtures__/fullArrangement';
import { installSidechainWorklet, sidechainRig } from '../__fixtures__/sidechainRig';
import { SCHEDULER_START_DELAY_SECONDS } from '../audioConstants';
import { PPQ, TICKS_PER_BAR } from '../sequencing/scheduler';
import type { RollSequencerConfig } from '../sequencing/rollSequencer';
import type { ArrangementDocument } from '../song/arrangementDocument';
import { musicPartName } from '../song/documentParts';
import type { AudioPart } from '../synth/audioPart';
import type { AudioSystem } from './audioSystem';

const restore = installSidechainWorklet();
afterAll(() => restore());

const LOOP = 4 * TICKS_PER_BAR;
/** The fixture's 96 BPM. */
const TICK = 60 / FULL_DOCUMENT.transport.bpm / PPQ;
const tickTime = (tick: number): number => SCHEDULER_START_DELAY_SECONDS + tick * TICK;
const RISE = envelope('filter.cutoff', [envPoint(0, -1), envPoint(LOOP - 1, 1)]);
/** The drone as a roll: one note held across the loop, under `envelopes`. */
const droneRoll = (envelopes: RollSequencerConfig['envelopes']): ArrangementDocument =>
  withDocumentPart(FULL_DOCUMENT, 'drone', {
    sequencer: {
      kind: 'roll',
      loopTicks: LOOP,
      notes: [{ tick: 0, ticks: LOOP, pitch: 50 }],
      ...(envelopes ? { envelopes } : {}),
    },
  });

async function rig(document: ArrangementDocument): Promise<{
  sys: AudioSystem;
  context: FakeContext;
  drone: AudioPart;
  play(until: number): void;
}> {
  const { system: sys, context } = await sidechainRig(document);
  const drone = sys.strip(musicPartName(FULL_SLOT.drone))!.part;
  const play = (until: number): void => {
    for (let t = context.currentTime; t <= until; t += 0.025) {
      context.currentTime = t;
      sys.update(0);
    }
    context.currentTime = until;
  };
  return { sys, context, drone, play };
}

const posted = (part: AudioPart): { type: string }[] =>
  (part.node as unknown as FakeWorkletNode).posted as { type: string }[];
const slotParam = (part: AudioPart, path: string): FakeParam =>
  part.voiceSlotParams[part.voiceSlotOf(path)!] as unknown as FakeParam;

describe('clip envelopes on the live system', () => {
  it('raises a held note’s Cutoff slot tick by tick as the song plays', async () => {
    const { sys, drone, play } = await rig(droneRoll([RISE]));
    sys.startMusic();
    play(2);
    expect(posted(drone).filter((m) => m.type === 'noteOn')).toHaveLength(1);
    expect(posted(drone).filter((m) => m.type === 'noteOff')).toHaveLength(0);
    const slot = slotParam(drone, 'filter.cutoff');
    let before = -Infinity;
    for (let tick = 1; tick < 64; tick++) {
      const value = slot.valueAt(tickTime(tick));
      expect(value).toBeCloseTo(envelopeOffsetAt(RISE, tick, LOOP), 9);
      expect(value).toBeGreaterThan(before);
      before = value;
    }
  });

  it('lets a live edit drop the envelopes: the offset ramps to 0 and the slot is given back', async () => {
    const { sys, context, drone, play } = await rig(droneRoll([RISE]));
    sys.startMusic();
    play(1);
    sys.apply({ parts: { [FULL_SLOT.drone]: { sequencer: { envelopes: [] } } } });
    const slot = slotParam(drone, 'filter.cutoff');
    play(context.currentTime + 0.5);
    expect(slot.valueAt(context.currentTime)).toBe(0);
    expect(drone.voiceSlotOf('filter.cutoff')).toBeUndefined();
    expect(
      posted(drone)
        .filter((m) => m.type === 'voiceSlots')
        .at(-1),
    ).toEqual({
      type: 'voiceSlots',
      slots: Array(8).fill(null),
    });
  });

  it('takes no slot and posts no slot map for a roll with no envelopes', async () => {
    const { sys, drone, play } = await rig(droneRoll(undefined));
    sys.startMusic();
    play(2);
    sys.stopMusic();
    expect(posted(drone).some((m) => m.type === 'voiceSlots')).toBe(false);
    for (const param of drone.voiceSlotParams) {
      expect((param as unknown as FakeParam).automation).toEqual([]);
    }
  });
});
