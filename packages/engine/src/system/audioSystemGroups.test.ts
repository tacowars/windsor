/**
 * Group buses on the live system (windsor#285; record
 * `2026-10-01-group-buses`): a grouped part's dry signal runs through its
 * group's chain, pan, level and gate into the music bus; a move between
 * Master and the groups is one edge inside a gate fade; mute and solo follow
 * the one rule; a live partial adds, edits and removes groups in order, and
 * refuses a ninth; and a song with no groups builds no group.
 */
import { afterAll, describe, expect, it } from 'vitest';

import { rms } from '../__fixtures__/audioAnalysis';
import type { FakeContext } from '../__fixtures__/fakeAudioContext';
import { renderGraph } from '../__fixtures__/fakeAudioContext';
import type { FakeGain, FakeNode } from '../__fixtures__/fakeAudioNodes';
import {
  BASS,
  DRUMS,
  DRUMS_ID,
  KICK,
  SNARE,
  drumSong,
  groupRig,
  installGroupWorklets,
} from '../__fixtures__/groupRig';
import { fake, sources, targets } from '../__fixtures__/stripRig';
import { MAX_GROUPS } from '../audioConstants';
import { DEFAULT_COMPRESSOR } from '../inserts/compressorSpec';
import { INSERT_FADE_SECONDS } from '../inserts/insertConstants';
import type { PartStrip } from '../mixer/channelStrip';
import type { GroupSpec } from '../mixer/mix';
import type { ArrangementDocument, DocumentPartial } from '../song/arrangementDocument';
import { musicPartName } from '../song/documentParts';
import type { AudioSystem } from './audioSystem';

const restore = installGroupWorklets();
afterAll(restore);

const SECONDS = 0.1;
/** The strip tests' tolerance: equal to six decimal places. */
const CLOSE = 1e-6;
const AUDIBLE = 1e-3;

const strip = (system: AudioSystem, slot: number): PartStrip => system.strip(musicPartName(slot))!;
const drums = (system: AudioSystem) => system.groupBus(DRUMS_ID)!;
const plain = (id: number, name = `Group ${id}`): GroupSpec => ({
  id,
  name,
  level: 1,
  pan: 0,
  inserts: [],
});
const PERC = plain(6, 'Perc');
/** The music bus's input: where a group and an ungrouped part play. */
const musicIn = (system: AudioSystem): FakeNode => targets(strip(system, BASS).rotation.output)[0]!;
const gateOf = (s: PartStrip): FakeGain => targets(s.head)[0] as FakeGain;
const peak = (samples: Float32Array): number =>
  samples.reduce((max, x) => Math.max(max, Math.abs(x)), 0);
const settled = (samples: Float32Array): number => rms(samples, samples.length / 2);
const set = (slot: number, fields: Record<string, unknown>): DocumentPartial =>
  ({ parts: { [slot]: { strip: fields } } }) as DocumentPartial;

describe('a song with a Drums group', () => {
  it('runs the kick and snare through the group chain into the music bus, and the bass past it', async () => {
    const { system } = await groupRig(drumSong(DRUMS));
    const group = drums(system);
    for (const slot of [KICK, SNARE]) {
      expect(targets(strip(system, slot).rotation.output)).toEqual([fake(group.input)]);
    }
    const [compressor, tape] = group.inserts;
    expect(group.inserts.map((s) => s.kind)).toEqual(['compressor', 'tape']);
    expect(targets(group.input)).toEqual([fake(compressor!.input)]);
    expect(targets(compressor!.output)).toEqual([fake(tape!.input)]);
    expect(targets(group.output)).toEqual([musicIn(system)]);
    expect(sources(group.input)).toHaveLength(2);
    expect(group.spec.inserts[0]).toMatchObject({ kind: 'compressor', sidechain: 'internal' });
    system.dispose();
  });

  it("reduces the summed drums through the group's own compressor", async () => {
    const { system, context } = await groupRig(drumSong(DRUMS));
    const group = drums(system);
    const compressor = group.inserts[0]!;
    const [summed, compressed] = renderGraph(context, 0.3, [
      fake(group.input),
      fake(compressor.output),
    ]);
    const reduction = settled(compressed!.left) / settled(summed!.left);
    expect(reduction).toBeLessThan(0.5);
    expect(peak(compressed!.left)).toBeGreaterThan(AUDIBLE);
    system.dispose();
  });

  it('renders a grouped part as on Master with an empty chain, unity level and centre pan', async () => {
    const onMaster = await groupRig(drumSong());
    const onGroup = await groupRig(drumSong(plain(DRUMS_ID)));
    expect(targets(strip(onGroup.system, KICK).rotation.output)).toEqual([
      fake(drums(onGroup.system).input),
    ]);
    const [a] = renderGraph(onMaster.context, SECONDS, [musicIn(onMaster.system)]);
    const [b] = renderGraph(onGroup.context, SECONDS, [musicIn(onGroup.system)]);
    expect(peak(a!.left)).toBeGreaterThan(AUDIBLE);
    for (let i = 0; i < a!.left.length; i++) {
      expect(Math.abs(a!.left[i]! - b!.left[i]!)).toBeLessThan(CLOSE);
      expect(Math.abs(a!.right[i]! - b!.right[i]!)).toBeLessThan(CLOSE);
    }
    onMaster.system.dispose();
    onGroup.system.dispose();
  });

  it('builds a part that starts on a group straight onto it, with no move', async () => {
    const waits: number[] = [];
    const { system } = await groupRig(drumSong(DRUMS), (run, seconds) => {
      waits.push(seconds);
      run();
    });
    expect(waits).toEqual([]);
    expect(gateOf(strip(system, KICK)).gain.automation.map((a) => a.call)).not.toContain(
      'linearRampToValueAtTime',
    );
    system.dispose();
  });
});

describe('moving a part between Master and the groups', () => {
  it('leaves one dry edge each time, with the gate down around the move and up after', async () => {
    const queue: (() => void)[] = [];
    const doc = { ...drumSong(DRUMS), groups: [DRUMS, PERC] };
    const { system } = await groupRig(doc, (run) => queue.push(run));
    const bass = strip(system, BASS);
    const gate = gateOf(bass).gain;
    const steps: [Record<string, unknown>, FakeNode][] = [
      [{ group: DRUMS_ID }, fake(drums(system).input)],
      [{ group: PERC.id }, fake(system.groupBus(PERC.id)!.input)],
      ['master', musicIn(system)],
    ] as [Record<string, unknown>, FakeNode][];
    let from = targets(bass.rotation.output);
    for (const [output, to] of steps) {
      expect(system.apply(set(BASS, { output }))).toEqual({ ok: true, ignored: [] });
      // Inside the fade: closed, and still on the old destination.
      expect(gate.value).toBe(0);
      expect(gate.automation.at(-1)).toMatchObject({ call: 'linearRampToValueAtTime', value: 0 });
      expect(targets(bass.rotation.output)).toEqual(from);
      for (const run of queue.splice(0)) run();
      expect(targets(bass.rotation.output)).toEqual([to]);
      expect(gate.value).toBe(1);
      expect(gate.automation.at(-1)).toMatchObject({ call: 'linearRampToValueAtTime', value: 1 });
      from = [to];
    }
    expect(sources(drums(system).input).filter((n) => n === fake(bass.rotation.output))).toEqual(
      [],
    );
    system.dispose();
  });

  it('closes the gate for Sidechain and leaves the edge where it was', async () => {
    const { system } = await groupRig(drumSong(DRUMS));
    const kick = strip(system, KICK);
    system.apply(set(KICK, { output: 'sidechain' }));
    expect(targets(kick.rotation.output)).toEqual([fake(drums(system).input)]);
    expect(gateOf(kick).gain.value).toBe(0);
    system.dispose();
  });

  it('routes a part to Master and reports it when its Output names a group the song lacks', async () => {
    const { system } = await groupRig(drumSong(DRUMS));
    const result = system.apply(set(BASS, { output: { group: 9 } }));
    expect(result).toEqual({ ok: true, ignored: [`parts.${BASS}.strip.output`] });
    expect(strip(system, BASS).output).toBe('master');
    system.dispose();
  });
});

/** Whether each slot's dry output and Send A sound. */
function heard(system: AudioSystem, context: FakeContext, slots: number[]): boolean[][] {
  const taps = slots.flatMap((slot) => {
    const s = strip(system, slot);
    return [fake(s.rotation.output), fake(s.sends.get('a')!)];
  });
  const captures = renderGraph(context, 0.05, taps);
  return slots.map((_, k) => captures.slice(2 * k, 2 * k + 2).map((c) => peak(c.left) > AUDIBLE));
}

const withSends = (doc: ArrangementDocument): ArrangementDocument => ({
  ...doc,
  parts: doc.parts.map((p) => ({ ...p, strip: { ...p.strip, sends: { a: 0.5 } } })),
});

describe('mute and solo with groups', () => {
  it("silences a muted group's members, dry and sends, and Send A keeps its tail", async () => {
    const { system, context } = await groupRig(withSends(drumSong(DRUMS)));
    const room = system.returnBus('a')!;
    renderGraph(context, 0.3);
    expect(system.apply({ groups: { [DRUMS_ID]: { mute: true } } })).toEqual({
      ok: true,
      ignored: [],
    });
    expect(drums(system).open).toBe(false);
    expect(drums(system).spec.mute).toBe(true);
    // Send A is still ringing with what the drums sent before the mute.
    const [tail] = renderGraph(context, 0.05, [fake(room.output)]);
    expect(peak(tail!.left)).toBeGreaterThan(AUDIBLE);
    expect(heard(system, context, [KICK, SNARE, BASS])).toEqual([
      [false, false],
      [false, false],
      [true, true],
    ]);
    system.apply({ groups: { [DRUMS_ID]: { mute: false } } });
    expect(drums(system).open).toBe(true);
    expect(heard(system, context, [KICK, SNARE])).toEqual([
      [true, true],
      [true, true],
    ]);
    system.dispose();
  });

  it('opens every member of a soloed group, and soloes out the rest', async () => {
    const { system, context } = await groupRig(withSends(drumSong(DRUMS)));
    system.apply({ groups: { [DRUMS_ID]: { solo: true } } });
    expect(drums(system).open).toBe(true);
    expect(heard(system, context, [KICK, SNARE, BASS])).toEqual([
      [true, true],
      [true, true],
      [false, false],
    ]);
    system.dispose();
  });

  it('keeps the group of a soloed member open, and soloes out its siblings', async () => {
    const { system, context } = await groupRig(withSends(drumSong(DRUMS)));
    system.apply(set(KICK, { solo: true }));
    expect(drums(system).open).toBe(true);
    expect(heard(system, context, [KICK, SNARE, BASS])).toEqual([
      [true, true],
      [false, false],
      [false, false],
    ]);
    // A solo on Master soloes the group out with every member.
    system.apply({
      parts: { [KICK]: { strip: { solo: false } }, [BASS]: { strip: { solo: true } } },
    });
    expect(drums(system).open).toBe(false);
    system.dispose();
  });

  it('lets a kick keyed into a compressor duck while soloed out or in a muted group', async () => {
    const { system, context } = await groupRig(drumSong(DRUMS));
    const keyed = { ...DEFAULT_COMPRESSOR, threshold: -30, sidechain: { track: KICK } };
    expect(system.apply(set(BASS, { inserts: [keyed] })).ok).toBe(true);
    const detector = strip(system, BASS).inserts[0]!.detector!.input;
    expect(sources(detector)).toEqual([fake(strip(system, KICK).head)]);
    const key = (): number => peak(renderGraph(context, 0.05, [fake(detector)])[0]!.left);
    const open = key();
    expect(open).toBeGreaterThan(AUDIBLE);
    system.apply(set(SNARE, { solo: true }));
    expect(strip(system, KICK).soloedOut).toBe(true);
    expect(key()).toBeGreaterThan(0.9 * open);
    system.apply({
      parts: { [SNARE]: { strip: { solo: false } } },
      groups: { [DRUMS_ID]: { mute: true } },
    });
    expect(strip(system, KICK).soloedOut).toBe(true);
    expect(key()).toBeGreaterThan(0.9 * open);
    system.dispose();
  });
});

/** Every edge into or out of the group's own nodes. */
const groupEdges = (system: AudioSystem, id: number, bus = system.groupBus(id)!) =>
  [...sources(bus.input), ...targets(bus.input), ...targets(bus.output)].length;

describe('groups in a live partial', () => {
  it('adds a group and moves a part onto it in one partial, and edits its fields live', async () => {
    const { system } = await groupRig(drumSong(DRUMS));
    const result = system.apply({
      groups: { [PERC.id]: PERC },
      parts: { [BASS]: { strip: { output: { group: PERC.id } } } },
    } as DocumentPartial);
    expect(result).toEqual({ ok: true, ignored: [] });
    const perc = system.groupBus(PERC.id)!;
    expect(targets(strip(system, BASS).rotation.output)).toEqual([fake(perc.input)]);
    expect(
      system.apply({ groups: { [PERC.id]: { level: 9, pan: 0.5, colour: 1 } } } as unknown as DocumentPartial),
    ).toEqual({ ok: true, ignored: [`groups.${PERC.id}.colour`] });
    expect(perc.spec).toMatchObject({ level: 4, pan: 0.5 });
    system.dispose();
  });

  it('removes a group whose members move to Master in the same partial, leaving no edge', async () => {
    const { system } = await groupRig(drumSong(DRUMS));
    const group = drums(system);
    const result = system.apply({
      groups: { [DRUMS_ID]: null },
      parts: { [KICK]: { strip: { output: 'master' } }, [SNARE]: { strip: { output: 'master' } } },
    } as DocumentPartial);
    expect(result).toEqual({ ok: true, ignored: [] });
    expect(system.groupBus(DRUMS_ID)).toBeUndefined();
    expect(groupEdges(system, DRUMS_ID, group)).toBe(0);
    for (const slot of [KICK, SNARE]) {
      expect(targets(strip(system, slot).rotation.output)).toEqual([musicIn(system)]);
    }
    system.dispose();
  });

  it('routes the members of a removed group to Master and reports them', async () => {
    const { system } = await groupRig(drumSong(DRUMS));
    const group = drums(system);
    const result = system.apply({ groups: { [DRUMS_ID]: null } } as DocumentPartial);
    expect(result).toEqual({
      ok: true,
      ignored: [`parts.${KICK}.strip.output`, `parts.${SNARE}.strip.output`],
    });
    expect(groupEdges(system, DRUMS_ID, group)).toBe(0);
    expect(strip(system, KICK).output).toBe('master');
    expect(targets(strip(system, SNARE).rotation.output)).toEqual([musicIn(system)]);
    system.dispose();
  });

  it('disposes a removed group only once the members have moved and its fade has landed', async () => {
    const queue: [() => void, number][] = [];
    const { system } = await groupRig(drumSong(DRUMS), (run, seconds) =>
      queue.push([run, seconds]),
    );
    const group = drums(system);
    system.apply({ groups: { [DRUMS_ID]: null } } as DocumentPartial);
    expect(group.open).toBe(false);
    expect(queue.map(([, s]) => s)).toEqual([
      INSERT_FADE_SECONDS,
      INSERT_FADE_SECONDS,
      INSERT_FADE_SECONDS,
    ]);
    // Still standing while the members fade: their edges have not moved yet.
    expect(sources(group.input)).toHaveLength(2);
    for (const [run] of queue.splice(0)) run();
    expect(groupEdges(system, DRUMS_ID, group)).toBe(0);
    system.dispose();
  });

  it('refuses a ninth group, and changes nothing', async () => {
    const eight = Array.from({ length: MAX_GROUPS }, (_, i) => plain(i));
    const { system, context } = await groupRig({ ...drumSong(), groups: eight });
    const before = context.nodes.length;
    const result = system.apply({
      groups: { 20: plain(20) },
      parts: { [BASS]: { strip: { level: 0.5 } } },
    } as DocumentPartial);
    expect(result).toEqual({
      ok: false,
      ignored: [],
      error: `groups: a song holds at most ${MAX_GROUPS} groups`,
    });
    expect(system.groupBus(20)).toBeUndefined();
    expect(context.nodes.length).toBe(before);
    expect(strip(system, BASS).part.gain.value).not.toBe(0.5);
    system.dispose();
  });
});

describe('a song with no groups', () => {
  it('builds no group, and every part plays straight into the music bus', async () => {
    const { system } = await groupRig(drumSong());
    for (const slot of [KICK, SNARE, BASS]) {
      expect(targets(strip(system, slot).rotation.output)).toEqual([musicIn(system)]);
      expect(strip(system, slot).output).toBeUndefined();
    }
    expect([0, 1, DRUMS_ID].map((id) => system.groupBus(id))).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
    system.dispose();
  });
});

describe('disposing the system', () => {
  it('disposes every group', async () => {
    const { system } = await groupRig(drumSong(DRUMS));
    const group = drums(system);
    system.dispose();
    expect(groupEdges(system, DRUMS_ID, group)).toBe(0);
  });
});
