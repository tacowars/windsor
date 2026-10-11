/**
 * A roll's clip envelopes on the live system (windsor#702): read from the
 * document at `initMusic`, heard on a held note through the part's voice
 * slot as the transport plays, and dropped by a live edit. A song with no
 * envelopes takes no slot. A part added live finds its targets again on a
 * patch edit, and a part on a preset switch. The player's own rules are
 * `automation/clipEnvelopePlayer.test.ts`.
 */
import { afterAll, describe, expect, it } from 'vitest';

import { envPoint, envelope, envelopeOffsetAt } from '../__fixtures__/clipEnvelopeRig';
import type { FakeContext, FakeWorkletNode } from '../__fixtures__/fakeAudioContext';
import type { FakeParam } from '../__fixtures__/fakeAudioNodes';
import { FULL_DOCUMENT, FULL_SLOT, withDocumentPart } from '../__fixtures__/fullArrangement';
import { installSidechainWorklet, sidechainRig } from '../__fixtures__/sidechainRig';
import { SCHEDULER_START_DELAY_SECONDS } from '../audioConstants';
import { makeMacro, makePatch } from '../patch/patch';
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

interface Live {
  sys: AudioSystem;
  context: FakeContext;
  play(until: number): void;
}

/** The system on `document`, and a clock that plays it to a time. */
async function live(document: ArrangementDocument): Promise<Live> {
  const { system: sys, context } = await sidechainRig(document);
  const play = (until: number): void => {
    for (let t = context.currentTime; t <= until; t += 0.025) {
      context.currentTime = t;
      sys.update(0);
    }
    context.currentTime = until;
  };
  return { sys, context, play };
}

const droneOf = (sys: AudioSystem): AudioPart => sys.strip(musicPartName(FULL_SLOT.drone))!.part;

async function rig(document: ArrangementDocument): Promise<Live & { drone: AudioPart }> {
  const built = await live(document);
  return { ...built, drone: droneOf(built.sys) };
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

  it('re-reads a live loop length: shrunk past every point it frees the slot, grown back it plays', async () => {
    const LATE = envelope('filter.cutoff', [envPoint(LOOP / 2, 1)]);
    const { sys, context, drone, play } = await rig(droneRoll([LATE]));
    const loop = (loopTicks: number): void => {
      expect(sys.apply({ parts: { [FULL_SLOT.drone]: { sequencer: { loopTicks } } } }).ok).toBe(
        true,
      );
    };
    sys.startMusic();
    play(1);
    expect(drone.voiceSlotOf('filter.cutoff')).toBeDefined();
    loop(LOOP / 2);
    play(context.currentTime + 0.5);
    expect(drone.voiceSlotOf('filter.cutoff')).toBeUndefined();
    loop(LOOP);
    play(context.currentTime + 0.5);
    expect(slotParam(drone, 'filter.cutoff').valueAt(context.currentTime)).toBeCloseTo(
      envelopeOffsetAt(LATE, 0, LOOP),
      9,
    );
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

  it('plays a live-added roll once a patch edit unmaps its target from a macro', async () => {
    const mapped = makePatch({ name: 'mapped' });
    const added = {
      ...droneRoll([RISE]).parts.find((part) => part.slot === FULL_SLOT.drone)!,
      preset: 'mapped',
    };
    expect('automation' in added).toBe(false);
    const { sys, context, play } = await live({
      ...FULL_DOCUMENT,
      parts: FULL_DOCUMENT.parts.filter((part) => part.slot !== FULL_SLOT.drone),
      patches: {
        ...FULL_DOCUMENT.patches,
        mapped: { ...mapped, macros: [makeMacro({ mappings: [{ target: 'filter.cutoff' }] })] },
      },
    });
    sys.startMusic();
    play(0.5);
    expect(sys.apply({ parts: { [FULL_SLOT.drone]: added } })).toEqual({ ok: true, ignored: [] });
    play(1);
    const drone = droneOf(sys);
    // The macro maps Cutoff: the envelope is refused a slot.
    expect(drone.voiceSlotOf('filter.cutoff')).toBeUndefined();
    expect(sys.apply({ patches: { mapped: { macros: [] } } }).ok).toBe(true);
    play(2);
    const slot = slotParam(drone, 'filter.cutoff');
    const tick = Math.ceil((context.currentTime - tickTime(0)) / TICK) - 4;
    expect(slot.valueAt(tickTime(tick))).toBeCloseTo(envelopeOffsetAt(RISE, tick % LOOP, LOOP), 9);
    expect(slot.valueAt(tickTime(tick))).not.toBe(0);
  });

  describe('a preset switch finds the envelope’s target again', () => {
    /** A patch whose macro maps Cutoff, so an envelope on it is refused (windsor#560). */
    const MAPPED = {
      ...makePatch({ name: 'mapped' }),
      macros: [makeMacro({ mappings: [{ target: 'filter.cutoff' }] })],
    };
    const PLAIN = FULL_DOCUMENT.parts.find((part) => part.slot === FULL_SLOT.drone)!.preset;
    const onPreset = (preset: string): ArrangementDocument => {
      const document = withDocumentPart(droneRoll([RISE]), 'drone', { preset });
      return { ...document, patches: { ...document.patches, mapped: MAPPED } };
    };
    const switchTo = (sys: AudioSystem, preset: string): void => {
      expect(sys.apply({ parts: { [FULL_SLOT.drone]: { preset } } })).toEqual({
        ok: true,
        ignored: [],
      });
    };

    it('plays once the part switches from a preset mapping it to one that does not', async () => {
      const { sys, context, drone, play } = await rig(onPreset('mapped'));
      sys.startMusic();
      play(1);
      expect(drone.voiceSlotOf('filter.cutoff')).toBeUndefined();
      switchTo(sys, PLAIN);
      play(2);
      const slot = slotParam(drone, 'filter.cutoff');
      const tick = Math.ceil((context.currentTime - tickTime(0)) / TICK) - 4;
      expect(slot.valueAt(tickTime(tick))).toBeCloseTo(
        envelopeOffsetAt(RISE, tick % LOOP, LOOP),
        9,
      );
      expect(slot.valueAt(tickTime(tick))).not.toBe(0);
    });

    it('goes silent and gives the slot back once the part switches to a preset mapping it', async () => {
      const { sys, context, drone, play } = await rig(onPreset(PLAIN));
      sys.startMusic();
      play(1);
      const slot = slotParam(drone, 'filter.cutoff');
      switchTo(sys, 'mapped');
      play(context.currentTime + 0.5);
      expect(slot.valueAt(context.currentTime)).toBe(0);
      expect(drone.voiceSlotOf('filter.cutoff')).toBeUndefined();
    });
  });
});
