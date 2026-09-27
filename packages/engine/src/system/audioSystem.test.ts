/**
 * The mixer's acceptance criteria (#68), asserted on headless renders of the
 * real routing: `AudioSystem` and `FmEngine` run unchanged on the graph
 * stand-in, the plate return is the real bundled plate
 * (`worklet/generated/reverb-processor.js`, from `worklet/reverb/`), and every
 * part plays a known test signal. Nothing is listened to; #69 does that.
 */
import { afterAll, describe, expect, it } from 'vitest';

import {
  burst,
  maxAbsDiff,
  nodesBetween,
  reaches,
  rms,
  tones,
} from '../__fixtures__/audioAnalysis';
import type { Capture } from '../__fixtures__/fakeAudioContext';
import {
  FakeContext,
  SAMPLE_RATE,
  installFakeAudioWorklet,
  renderGraph,
  sourceOf,
} from '../__fixtures__/fakeAudioContext';
import type { FakeGain, FakeNode } from '../__fixtures__/fakeAudioNodes';
import type { AudioSystemOptions } from './audioSystem';
import { AudioSystem } from './audioSystem';
import { FmEngine } from '../synth/fmEngine';
import type { ChannelStrip, ReturnSpec } from '../mixer/mix';
import { RETURNS } from '../mixer/mix';
import { SPACES } from '../mixer/reverbSpace';
import { REVERB_PROCESSOR_NAME } from '../synth/workletMessages';
import { PRESETS } from '../patch/presets';
import { LOW_CUT_MIN_HZ } from '../audioConstants';

const restore = installFakeAudioWorklet();
afterAll(() => restore());

const fake = (node: AudioNode): FakeNode => node as unknown as FakeNode;
const gainOf = (node: AudioNode): number => (node as unknown as FakeGain).gain.value;

const MONO = tones(440, 440, 0.5);
const BURST = burst(MONO, 0.3);
const RENDER_SECONDS = 1.5;

interface Rig {
  context: FakeContext;
  engine: FmEngine;
  system: AudioSystem;
}

async function rig(options: AudioSystemOptions = {}): Promise<Rig> {
  const context = new FakeContext();
  const engine = new FmEngine(context.asAudioContext());
  const system = new AudioSystem(engine, options);
  await system.init();
  return { context, engine, system };
}

function returnOutput(system: AudioSystem, name: string): FakeNode {
  const bus = system.returnBus(name);
  if (!bus) throw new Error(`no return "${name}"`);
  return fake(bus.output);
}

/** Build parts named in `mix` (all on the music bus), feed them, render the room return. */
async function roomRender(
  mix: Record<string, ChannelStrip>,
  feed: ReturnType<typeof tones>,
  onBlock?: (system: AudioSystem, block: number, time: number) => void,
): Promise<{ room: Capture; master: Capture; system: AudioSystem }> {
  const { system, engine } = await rig({ mix });
  for (const name of Object.keys(mix)) {
    sourceOf(system.createMusicPart(name, PRESETS['pad-drift']!)).feed = feed;
  }
  const [room, master] = renderGraph(
    system.engine.context as unknown as FakeContext,
    RENDER_SECONDS,
    [returnOutput(system, 'room'), fake(engine.master)],
    onBlock ? (b, t) => onBlock(system, b, t) : undefined,
  );
  if (!room || !master) throw new Error('render produced no captures');
  return { room, master, system };
}

const strip = (sends: ChannelStrip['sends'], pan = 0, level = 1): ChannelStrip => ({
  level,
  pan,
  lowCut: LOW_CUT_MIN_HZ,
  inserts: [],
  sends,
});

describe('sends are per part', () => {
  it('lets two parts sit in one room at different depths', async () => {
    const shallow = await roomRender({ a: strip({ room: 0.2 }) }, BURST);
    const deep = await roomRender({ b: strip({ room: 0.6 }) }, BURST);

    const shallowRms = rms(shallow.room.left);
    expect(shallowRms).toBeGreaterThan(0);
    // The plate is linear: three times the send is three times the room.
    expect(rms(deep.room.left) / shallowRms).toBeCloseTo(3, 1);
  });

  it('silences a part at send 0 without altering the tail of a part still sending', async () => {
    const both = await roomRender({ a: strip({ room: 0.4 }), b: strip({ room: 0.4 }) }, BURST);
    const aMuted = await roomRender({ a: strip({ room: 0 }), b: strip({ room: 0.4 }) }, BURST);
    const bAlone = await roomRender({ b: strip({ room: 0.4 }) }, BURST);

    const tailFrom = Math.round(1.0 * SAMPLE_RATE);
    expect(rms(bAlone.room.left, tailFrom)).toBeGreaterThan(1e-4);
    expect(maxAbsDiff(aMuted.room.left, bAlone.room.left)).toBe(0);
    expect(maxAbsDiff(aMuted.room.right, bAlone.room.right)).toBe(0);
    expect(rms(both.room.left)).toBeGreaterThan(rms(bAlone.room.left));
  });

  it('turns a send down live, and what is already in the room keeps ringing', async () => {
    const both = await roomRender({ a: strip({ room: 0.4 }), b: strip({ room: 0.4 }) }, BURST);
    const bAlone = await roomRender({ b: strip({ room: 0.4 }) }, BURST);
    const cutAt = 0.4;
    const cut = await roomRender(
      { a: strip({ room: 0.4 }), b: strip({ room: 0.4 }) },
      BURST,
      (system, _block, time) => {
        if (time >= cutAt) system.strip('a')?.setSend('room', 0);
      },
    );

    const cutFrame = Math.round(cutAt * SAMPLE_RATE);
    expect(
      maxAbsDiff(cut.room.left.subarray(0, cutFrame), both.room.left.subarray(0, cutFrame)),
    ).toBe(0);
    // The send gates what enters the room, not what is already in it: a's
    // earlier contribution is still decaying, so the tail exceeds b's alone.
    expect(rms(cut.room.left, cutFrame)).toBeGreaterThan(rms(bAlone.room.left, cutFrame) * 1.2);
  });

  it('refuses a send to a return that does not exist', async () => {
    const { system } = await rig({ mix: { x: strip({ nowhere: 0.5 }) } });
    expect(() => system.createMusicPart('x', PRESETS['pad-drift']!)).toThrow(
      /unknown return "nowhere"/,
    );
    expect(() => system.strip('drone')?.setSend('nowhere', 0.1)).not.toThrow();
  });
});

describe('the fader and the dry path', () => {
  it('sets the strip level on the k-rate gain param and adds no GainNode to the dry path', async () => {
    const { system, engine } = await rig();
    const drone = strip({ room: 0.45 }, 0, 0.8);
    const part = system.createMusicPart('drone', PRESETS['pad-drift']!, undefined, drone);
    const live = system.strip('drone');
    if (!live) throw new Error('no strip');

    expect(drone.level).not.toBe(1);
    expect(part.gain.value).toBe(drone.level);

    // The low cut (#640), the tap's fade gain (#652) and the rotation's four
    // gains, plus the audible-output gate (#667): none is the strip fader.
    const rotationPath = nodesBetween(fake(part.output), fake(live.rotation.output));
    expect(rotationPath.map((n) => n.kind).sort()).toEqual([
      'biquad',
      'gain',
      'gain',
      'gain',
      'gain',
      'gain',
      'gain',
      'splitter',
    ]);
    expect((live.head as unknown as FakeGain).gain.value).toBe(1);
    const busPath = nodesBetween(fake(live.rotation.output), fake(engine.master));
    // Dry bus input/output plus master input, structural-edit fade and level.
    expect(busPath.map((n) => n.kind).sort()).toEqual([
      'biquad',
      'gain',
      'gain',
      'gain',
      'gain',
      'gain',
    ]);
    for (const node of busPath) {
      if (node.kind === 'gain') expect((node as FakeGain).gain.value).toBe(1);
    }
    for (const gain of Object.values(live.rotation.gains)) {
      expect(Math.abs(gainOf(gain))).toBeLessThanOrEqual(1);
    }
  });

  it('applies the fader exactly once on the way to the master', async () => {
    const level = 0.8;
    const { system, engine, context } = await rig({ mix: { p: strip({}, 0, level) } });
    const part = system.createMusicPart('p', PRESETS['pad-drift']!);
    sourceOf(part).feed = MONO;
    const [source, master] = renderGraph(context, 0.5, [sourceOf(part), fake(engine.master)]);
    if (!source || !master) throw new Error('render produced no captures');

    // The fake fm-part applies its gain param the way the worklet does, so the
    // source capture is already post-fader; the master adds only its own 0.9.
    expect(rms(source.left)).toBeCloseTo(level * 0.5 * Math.SQRT1_2, 3);
    expect(rms(master.left, Math.round(0.1 * SAMPLE_RATE))).toBeCloseTo(0.9 * rms(source.left), 2);
  });
});

describe('sends are pre-pan', () => {
  it('leaves the room where it was when the part is panned', async () => {
    const centred = await roomRender({ p: strip({ room: 0.4 }, 0) }, BURST);
    const panned = await roomRender({ p: strip({ room: 0.4 }, 1) }, BURST);

    expect(maxAbsDiff(centred.room.left, panned.room.left)).toBe(0);
    expect(maxAbsDiff(centred.room.right, panned.room.right)).toBe(0);
    // ... while the dry signal did move.
    expect(maxAbsDiff(centred.master.left, panned.master.left)).toBeGreaterThan(0.1);
  });
});

describe('returns', () => {
  const plates = (context: FakeContext): number =>
    context.workletNodes.filter((n) => n.name === REVERB_PROCESSOR_NAME).length;

  it('instantiates exactly one plate for the default returns, however many parts exist', async () => {
    const { system, context } = await rig();
    expect(plates(context)).toBe(1);
    system.createMusicPart('drone', PRESETS['pad-drift']!);
    system.createMusicPart('arp', PRESETS['lead-bell']!);
    system.createAuxPart('ui', PRESETS['pickup-blip']!);
    expect(plates(context)).toBe(1);
    expect(system.returnBus('room')?.spec).toBe(RETURNS.room);
  });

  it('takes a second plate as one more RETURNS entry, with no change to the types or routing', async () => {
    const returns = {
      ...RETURNS,
      short: { kind: 'reverb', space: SPACES.plate, level: 0.5 },
    } satisfies Record<string, ReturnSpec>;
    const mix = {
      p: strip({ short: 0.5 }),
    } satisfies Record<string, ChannelStrip<keyof typeof returns>>;

    const { system, context } = await rig({ returns, mix });
    expect(plates(context)).toBe(2);
    sourceOf(system.createMusicPart('p', PRESETS['pad-drift']!)).feed = BURST;
    const [short, room] = renderGraph(context, 1, [
      returnOutput(system, 'short'),
      returnOutput(system, 'room'),
    ]);
    expect(rms(short?.left ?? new Float32Array(1))).toBeGreaterThan(1e-3);
    // Nothing was sent to the hall; what remains is the plate's anti-denormal floor.
    expect(rms(room?.left ?? new Float32Array(1))).toBeLessThan(1e-12);
    expect(system.strip('p')?.sends.size).toBe(3);
  });

  it('echoes through the delay return after delayTime, quieter each repeat', async () => {
    const { system, context } = await rig({ mix: { h: strip({ echo: 0.5 }) } });
    sourceOf(system.createMusicPart('h', PRESETS['lead-bell']!)).feed = burst(MONO, 0.05);
    const [echo] = renderGraph(context, 1, [returnOutput(system, 'echo')]);
    if (!echo) throw new Error('render produced no captures');

    const at = (from: number, to: number): number =>
      rms(echo.left, Math.round(from * SAMPLE_RATE), Math.round(to * SAMPLE_RATE));
    const { delayTime } = RETURNS.echo;
    expect(at(0.1, delayTime - 0.01)).toBe(0);
    const first = at(delayTime, delayTime + 0.05);
    const second = at(2 * delayTime, 2 * delayTime + 0.05);
    expect(first).toBeGreaterThan(0.01);
    expect(second).toBeGreaterThan(0);
    expect(second).toBeLessThan(first * 0.5);
  });
});

describe('aux parts', () => {
  it('reach the master through a strip, with level and pan applied and no bus inserts', async () => {
    const level = 0.5;
    const { system, engine, context } = await rig({ mix: { ui: strip({}, -1, level) } });
    const part = system.createAuxPart('ui', PRESETS['pickup-blip']!);
    const live = system.strip('ui');
    if (!live) throw new Error('no strip');
    sourceOf(part).feed = MONO;

    expect(part.gain.value).toBe(level);
    // One node stands between the strip and the master, and it is the aux
    // fader at unity (#518): still no bus insert, and the rendered level
    // below is unchanged because multiplying by exactly 1 is exact.
    const dryPath = nodesBetween(fake(live.rotation.output), fake(engine.master));
    expect(dryPath.map((node) => node.kind)).toEqual(['gain']);
    expect(gainOf(dryPath[0] as unknown as AudioNode)).toBe(1);
    expect(reaches(fake(part.output), fake(engine.master))).toBe(true);

    const [master] = renderGraph(context, 0.5, [fake(engine.master)]);
    if (!master) throw new Error('render produced no captures');
    // Hard left on a centred source: L' = sqrt2 * s, R' = 0; then level and the 0.9 master.
    expect(rms(master.right)).toBeLessThan(1e-6);
    expect(rms(master.left)).toBeCloseTo(0.9 * level * Math.SQRT2 * 0.5 * Math.SQRT1_2, 3);
  });

  it('can have a touch of room, the same way a music part does', async () => {
    const { system, context } = await rig({ mix: { blip: strip({ room: 0.3 }) } });
    sourceOf(system.createAuxPart('blip', PRESETS['pickup-blip']!)).feed = BURST;
    const [room] = renderGraph(context, 1, [returnOutput(system, 'room')]);
    expect(rms(room?.left ?? new Float32Array(1))).toBeGreaterThan(1e-3);
  });
});

describe('lifecycle', () => {
  it('refuses parts before init, and tears every strip down on dispose', async () => {
    const early = new AudioSystem(new FmEngine(new FakeContext().asAudioContext()));
    expect(() => early.createMusicPart('x', PRESETS['pad-drift']!)).toThrow(/init\(\)/);

    const { system, engine } = await rig();
    const part = system.createMusicPart('drone', PRESETS['pad-drift']!);
    expect(reaches(fake(part.output), fake(engine.master))).toBe(true);
    system.dispose();
    expect(system.isStarted).toBe(false);
    expect(system.strip('drone')).toBeUndefined();
    expect(fake(part.output).outbound).toEqual([]);
  });
});
