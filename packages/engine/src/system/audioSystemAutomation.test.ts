/**
 * A part's strip lanes on the live engine (windsor#344): built from the
 * document and held where the transport rests, edited live through `apply`
 * (a partial carrying `automation` is neither refused nor reported, as
 * windsor#342 decision 7 has it), never fought by a knob, and leaving mute,
 * solo and the Output's gate alone. A song with no lanes schedules nothing.
 */
import { afterAll, describe, expect, it } from 'vitest';

import { lane, point } from '../__fixtures__/automationRig';
import { AUTOMATION_LANES } from '../__fixtures__/automationSong';
import type { FakeContext } from '../__fixtures__/fakeAudioContext';
import { renderGraph, sourceOf } from '../__fixtures__/fakeAudioContext';
import type { FakeParam } from '../__fixtures__/fakeAudioNodes';
import {
  FULL_DOCUMENT,
  FULL_PARTS,
  FULL_SLOT,
  FULL_STRIPS,
  withDocumentPart,
} from '../__fixtures__/fullArrangement';
import { installSidechainWorklet, sidechainRig } from '../__fixtures__/sidechainRig';
import { fake } from '../__fixtures__/stripRig';
import type { AutomationLane } from '../automation/automationLane';
import type { PartStrip } from '../mixer/channelStrip';
import type { ArrangementDocument } from '../song/arrangementDocument';
import { musicPartName } from '../song/documentParts';
import type { AudioSystem } from './audioSystem';
import { withoutAutomation } from './automationPartial';

const restore = installSidechainWorklet();
afterAll(() => restore());

const { hat, kick, drone } = FULL_SLOT;

const stripOf = (sys: AudioSystem, slot: number): PartStrip => sys.strip(musicPartName(slot))!;
const param = (p: AudioParam): FakeParam => p as unknown as FakeParam;
const level = (sys: AudioSystem, slot: number = hat): FakeParam =>
  param(stripOf(sys, slot).part.gain);
/** Every param a strip lane can write on `slot`: the fader, the four pan gains, the sends. */
const stripParams = (sys: AudioSystem, slot: number): FakeParam[] => {
  const strip = stripOf(sys, slot);
  return [
    strip.part.gain,
    ...Object.values(strip.rotation.gains).map((g) => g.gain),
    ...[...strip.sends.values()].map((s) => s.gain),
  ].map(param);
};

/**
 * The fixture's strip and voice lanes on the hat: the fake context has no
 * Tape worklet to build its inserts with. Its level lane is on (0.5 at tick
 * 0), its pan lane off.
 */
const STRIP_AND_VOICE = AUTOMATION_LANES.filter((l) => !l.target.startsWith('insert.'));
const WITH_LANES = withDocumentPart(FULL_DOCUMENT, 'hat', { automation: STRIP_AND_VOICE });
const FLAT_LEVEL = lane('strip.level', [point(0, 0.5)]);

const lanes = (sys: AudioSystem, slot: number, automation: readonly AutomationLane[]) =>
  sys.apply({ parts: { [slot]: { automation } } });

async function system(document: ArrangementDocument): Promise<AudioSystem> {
  return (await sidechainRig(document)).system;
}

describe('lanes from the document', () => {
  it('holds each lane that is on at the rest tick, and leaves the off ones to the knob', async () => {
    const sys = await system(WITH_LANES);
    expect(level(sys).automation).toEqual([
      { call: 'cancelScheduledValues', value: FULL_STRIPS.hat.level, time: 0 },
      { call: 'setValueAtTime', value: 0.5, time: 0 },
    ]);
    const rotation = stripOf(sys, hat).rotation;
    expect(rotation.pan).toBe(FULL_STRIPS.hat.pan);
    for (const gain of Object.values(rotation.gains))
      expect(param(gain.gain).automation).toEqual([]);
  });

  it('schedules nothing for a song with no lanes', async () => {
    const { system: sys, context } = await sidechainRig(FULL_DOCUMENT);
    sys.startMusic();
    for (let t = 0; t < 2; t += 0.05) {
      context.currentTime = t;
      sys.update(0);
    }
    sys.stopMusic();
    for (const part of FULL_DOCUMENT.parts) {
      for (const p of stripParams(sys, part.slot)) expect(p.automation).toEqual([]);
    }
  });
});

describe('lanes from a partial', () => {
  it('accepts lanes on a part built without any, unreported, and plays them', async () => {
    const sys = await system(FULL_DOCUMENT);
    expect(lanes(sys, kick, AUTOMATION_LANES)).toEqual({ ok: true, ignored: [] });
    expect(level(sys, kick).value).toBe(0.5);
  });

  it('accepts lanes beside other edits: the knob lands, then the lanes go', async () => {
    const sys = await system(WITH_LANES);
    const partial = { parts: { [hat]: { automation: [], strip: { level: 0.3 }, velocity: 0.4 } } };
    expect(sys.apply(partial)).toEqual({ ok: true, ignored: [] });
    expect(level(sys).value).toBe(0.3);
  });

  it('accepts a whole part added with lanes, and holds them', async () => {
    const sys = await system({
      ...FULL_DOCUMENT,
      parts: FULL_DOCUMENT.parts.filter((part) => part.slot !== drone),
    });
    const added = { ...FULL_PARTS.drone, strip: FULL_STRIPS.drone, automation: AUTOMATION_LANES };
    expect(sys.apply({ parts: { [drone]: added } })).toEqual({ ok: true, ignored: [] });
    expect(level(sys, drone).automation.at(-1)).toEqual({
      call: 'setValueAtTime',
      value: 0.5,
      time: 0,
    });
  });

  it('forgets a part removed while its lanes play', async () => {
    const { system: sys, context } = await sidechainRig(WITH_LANES);
    sys.startMusic();
    sys.update(0);
    expect(sys.apply({ parts: { [hat]: null } }).ok).toBe(true);
    context.currentTime = 1;
    expect(() => sys.update(0)).not.toThrow();
  });
});

describe('a knob never fights a lane', () => {
  it('records a level while the lane is on, and applies it when the lane goes off', async () => {
    const { system: sys, context } = await sidechainRig(WITH_LANES);
    const before = level(sys).automation.length;
    sys.apply({ parts: { [hat]: { strip: { level: 0.3 } } } });
    expect(level(sys).automation).toHaveLength(before);
    expect(level(sys).value).toBe(0.5);
    context.currentTime = 2;
    const off = STRIP_AND_VOICE.map((l) => (l.target === 'strip.level' ? { ...l, on: false } : l));
    lanes(sys, hat, off);
    expect(level(sys).automation.slice(before)).toEqual([
      { call: 'cancelScheduledValues', value: 0.5, time: 2 },
      { call: 'setValueAtTime', value: 0.3, time: 2 },
    ]);
    sys.apply({ parts: { [hat]: { strip: { level: 0.2 } } } });
    expect(level(sys).value).toBe(0.2);
  });

  it('records a pan and a send while their lanes are on, and restores them when deleted', async () => {
    const sweep = lane('strip.pan', [point(0, -1), point(96, 1)]);
    const send = lane('strip.send.b', [point(0, 0.75)]);
    const sys = await system(withDocumentPart(FULL_DOCUMENT, 'hat', { automation: [sweep, send] }));
    const strip = stripOf(sys, hat);
    const ll = param(strip.rotation.gains.ll.gain);
    const sendB = param(strip.sends.get('b')!.gain);
    sys.apply({ parts: { [hat]: { strip: { pan: 0.5, sends: { b: 0.1 } } } } });
    expect(strip.rotation.pan).toBe(0.5);
    expect(ll.value).toBeCloseTo(Math.cos(-Math.PI / 4), 12);
    expect(sendB.value).toBe(0.75);
    lanes(sys, hat, []);
    expect(ll.value).toBeCloseTo(Math.cos(Math.PI / 8), 12);
    expect(sendB.value).toBe(0.1);
  });
});

describe('the gates over an automated part', () => {
  /** Whether the hat's dry output sounds, with a steady tone into every part. */
  function sounds(sys: AudioSystem, context: FakeContext): boolean {
    for (const part of FULL_DOCUMENT.parts) {
      // A tone, not DC, which the strip's low cut would take out.
      sourceOf(stripOf(sys, part.slot).part).feed = (b, l, r) => {
        for (let i = 0; i < l.length; i++) l[i] = r[i] = 0.4 * Math.sin((b * l.length + i) * 0.05);
      };
    }
    const [capture] = renderGraph(context, 0.05, [fake(stripOf(sys, hat).rotation.output)]);
    return capture!.left.some((s) => Math.abs(s) > 1e-3);
  }

  it('mutes, soloes out and gates the Output with the level lane untouched', async () => {
    const doc = withDocumentPart(FULL_DOCUMENT, 'hat', { automation: [FLAT_LEVEL] });
    const { system: sys, context } = await sidechainRig(doc);
    const calls = level(sys).automation.length;
    expect(sounds(sys, context)).toBe(true);
    sys.apply({ parts: { [hat]: { strip: { mute: true } } } });
    expect(sounds(sys, context)).toBe(false);
    sys.apply({ parts: { [hat]: { strip: { mute: false } }, [kick]: { strip: { solo: true } } } });
    expect(sounds(sys, context)).toBe(false);
    sys.apply({ parts: { [kick]: { strip: { solo: false } } } });
    expect(sounds(sys, context)).toBe(true);
    sys.apply({ parts: { [hat]: { strip: { output: 'sidechain' } } } });
    expect(sounds(sys, context)).toBe(false);
    expect(level(sys).automation).toHaveLength(calls);
    expect(level(sys).value).toBe(0.5);
  });
});

describe('withoutAutomation', () => {
  it("takes out each slot's lanes and leaves removals, junk and absence as they came", () => {
    expect(withoutAutomation(undefined)).toBeUndefined();
    expect(withoutAutomation({ 1: { automation: [], velocity: 0.5 }, 2: null })).toEqual({
      1: { velocity: 0.5 },
      2: null,
    });
    expect(withoutAutomation('junk' as never)).toBe('junk');
  });
});
