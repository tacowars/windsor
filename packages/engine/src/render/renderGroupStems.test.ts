/**
 * `renderStems` with group buses (windsor#286; record
 * `2026-10-01-group-buses` decision 9): each group renders one stem after
 * its inserts, pan and level, its members none, and the stems still sum to
 * the master with its inserts and output stage bypassed.
 *
 * The song is the acceptance criteria's: a Drums group (the kick and a
 * snare, the shipped compressor on it, hard enough to work), a bass on
 * Master, and Send A fed by the snare. The fixture's hat stands in for the
 * snare and its arp for the bass, as in `groupRig.ts`. The fake `fm-part`
 * plays a tone per part while its notes sound, the same in every render.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { FakeContext } from '../__fixtures__/fakeAudioContext';
import { FakeWorkletNode } from '../__fixtures__/fakeAudioContext';
import { FakeOfflineContext } from '../__fixtures__/fakeOfflineContext';
import { BASS, DRUM_COMPRESSOR, KICK, SNARE, drumSong } from '../__fixtures__/groupRig';
import { noteToneFeed } from '../__fixtures__/noteFeeds';
import { TapeNode } from '../__fixtures__/groupRig';
import { DetectorNode } from '../__fixtures__/sidechainRig';
import { COMPRESSOR_NAME } from '../inserts/compressorConstants';
import { TAPE_NAME } from '../inserts/tapeConstants';
import { DEFAULT_TAPE } from '../inserts/tapeSpec';
import type { ChannelStrip, GroupSpec } from '../mixer/mix';
import type { ArrangementDocument } from '../song/arrangementDocument';
import { PROCESSOR_NAME } from '../synth/workletMessages';
import { RENDER_QUANTUM_FRAMES } from './renderConstants';
import { renderStems } from './renderStems';
import type { Stem } from './stemPlan';

/** Parts built per context, so each render gives each part the same tone. */
const partsBuilt = new WeakMap<object, number>();

function workletNode(
  context: FakeContext,
  name: string,
  options: AudioWorkletNodeOptions = {},
): AudioNode {
  if (name === COMPRESSOR_NAME) return new DetectorNode(context, options) as unknown as AudioNode;
  if (name === TAPE_NAME) return new TapeNode(context, options) as unknown as AudioNode;
  const node = new FakeWorkletNode(context, name, options);
  const probe = (context as Partial<FakeOfflineContext>).length === RENDER_QUANTUM_FRAMES;
  if (name === PROCESSOR_NAME && !probe) {
    const index = partsBuilt.get(context) ?? 0;
    partsBuilt.set(context, index + 1);
    node.feed = noteToneFeed(node, 180 + 211 * index, 0.3);
  }
  return node as unknown as AudioNode;
}

let previous: typeof AudioWorkletNode | undefined;
beforeAll(() => {
  previous = globalThis.AudioWorkletNode;
  globalThis.AudioWorkletNode = workletNode as unknown as typeof AudioWorkletNode;
});
afterAll(() => {
  if (previous === undefined)
    delete (globalThis as { AudioWorkletNode?: unknown }).AudioWorkletNode;
  else globalThis.AudioWorkletNode = previous;
});

const RATE = 8000;
const TAIL = 0.5;
const DRUMS_ID = 4;
const DRUMS: GroupSpec = {
  id: DRUMS_ID,
  name: 'Drums',
  level: 0.8,
  pan: 0.3,
  inserts: [DRUM_COMPRESSOR],
};

/** `document` with one part's strip changed. */
const withStrip = (
  document: ArrangementDocument,
  slot: number,
  strip: Partial<ChannelStrip>,
): ArrangementDocument => ({
  ...document,
  parts: document.parts.map((p) =>
    p.slot === slot ? { ...p, strip: { ...p.strip, ...strip } } : p,
  ),
});

/** `document` with its one group changed. */
const withGroup = (
  document: ArrangementDocument,
  group: Partial<GroupSpec>,
): ArrangementDocument => ({
  ...document,
  groups: document.groups!.map((g) => ({ ...g, ...group })),
});

/** No master insert, a master level off unity; the snare feeds Send A. */
const SONG: ArrangementDocument = withStrip(
  { ...drumSong(DRUMS), master: { inserts: [], level: 0.7 } },
  SNARE,
  { sends: { a: 0.4 } },
);

const label = (stem: Stem): string => {
  switch (stem.kind) {
    case 'master':
      return 'master';
    case 'part':
      return `part ${stem.slot}`;
    case 'group':
      return `group ${stem.position} ${stem.name}`;
    case 'return':
      return stem.name;
  }
};

const peak = (channel: Float32Array): number =>
  channel.reduce((m, s) => Math.max(m, Math.abs(s)), 0);

/**
 * The largest gap between the master and the sum of the stems. The stem-sum
 * test's tolerance (`renderStems.test.ts`) applies: float32 rounding of a sum
 * taken in another order, each stem through its own highpass.
 */
function sumError(stems: Map<string, Float32Array[]>): number {
  const [master, ...rest] = [...stems.values()];
  let error = 0;
  for (let c = 0; c < 2; c++) {
    const want = master![c]!;
    for (let i = 0; i < want.length; i++) {
      let sum = 0;
      for (const stem of rest) sum += stem[c]![i]!;
      error = Math.max(error, Math.abs(sum - want[i]!));
    }
  }
  return error;
}

/** Every stem handed on, by label, its channels copied. */
async function collect(document: ArrangementDocument): Promise<Map<string, Float32Array[]>> {
  const stems = new Map<string, Float32Array[]>();
  await renderStems(
    document,
    {
      sampleRate: RATE,
      tailSeconds: TAIL,
      createContext: (init) => new FakeOfflineContext(init),
    },
    async ({ stem, channels }) =>
      void stems.set(
        label(stem),
        channels.map((c) => c.slice()),
      ),
  );
  return stems;
}

describe('renderStems with group buses (windsor#286)', () => {
  it('renders the bass, Drums and Send A, and no stem for the kick or the snare', async () => {
    const stems = await collect(SONG);
    expect([...stems.keys()]).toEqual(['master', `part ${BASS}`, 'group 1 Drums', 'a']);
    for (const [, channels] of [...stems].slice(1)) {
      expect(peak(channels[0]!)).toBeGreaterThan(1e-3);
    }
    expect(stems.has(`part ${KICK}`) || stems.has(`part ${SNARE}`)).toBe(false);
  });

  it('sums to the master with its dynamics bypassed, within 1e-6 of full scale', async () => {
    const stems = await collect(SONG);
    expect(peak(stems.get('master')![0]!)).toBeGreaterThan(0.1);
    expect(sumError(stems)).toBeLessThan(1e-6);
  });

  it("takes the group's stem after its compressor, pan and level", async () => {
    const plain = await collect(withGroup(SONG, { inserts: [], level: 1, pan: 0 }));
    const shaped = await collect(SONG);
    const drums = (stems: Map<string, Float32Array[]>): Float32Array[] =>
      stems.get('group 1 Drums')!;
    // The compressor and the fader both pull it down; the pan right leaves the right louder.
    expect(peak(drums(shaped)[0]!)).toBeLessThan(peak(drums(plain)[0]!) * 0.5);
    expect(peak(drums(shaped)[1]!)).toBeGreaterThan(peak(drums(shaped)[0]!));
    // Two renders: the budget is for a slow CI runner (windsor#80), not a claim about speed.
  }, 30_000);

  it("renders a muted group's stem silent, with its members' sends", async () => {
    const stems = await collect(withGroup(SONG, { mute: true }));
    expect(peak(stems.get('group 1 Drums')![0]!)).toBe(0);
    // The muted snare's send goes with it, so Send A has no stem.
    expect([...stems.keys()]).toEqual(['master', `part ${BASS}`, 'group 1 Drums']);
  });

  it("gives a soloed member's group stem that member alone", async () => {
    const soloed = await collect(withStrip(SONG, SNARE, { solo: true }));
    const kickMuted = await collect(withStrip(SONG, KICK, { mute: true }));
    expect(soloed.get('group 1 Drums')).toEqual(kickMuted.get('group 1 Drums'));
    expect(peak(soloed.get('group 1 Drums')![0]!)).toBeGreaterThan(1e-3);
    expect(peak(soloed.get(`part ${BASS}`)![0]!)).toBe(0);
  }, 30_000);

  it('gives an empty group a stem, silent when its chain makes nothing', async () => {
    const empty: GroupSpec = { id: 1, name: 'Empty', level: 1, pan: 0, inserts: [] };
    const stems = await collect({ ...SONG, groups: [empty, DRUMS] });
    expect([...stems.keys()]).toEqual([
      'master',
      `part ${BASS}`,
      'group 1 Empty',
      'group 2 Drums',
      'a',
    ]);
    expect(peak(stems.get('group 1 Empty')![0]!)).toBe(0);
  });

  it("puts an empty group's Tape hiss in its stem, and the stems still sum to the master", async () => {
    const hiss: GroupSpec = {
      id: 1,
      name: 'Hiss',
      level: 1,
      pan: 0,
      inserts: [{ ...DEFAULT_TAPE, hiss: -30 }],
    };
    const stems = await collect({ ...SONG, groups: [hiss, DRUMS] });
    expect([...stems.keys()]).toContain('group 1 Hiss');
    expect(peak(stems.get('group 1 Hiss')![0]!)).toBeGreaterThan(1e-4);
    expect(sumError(stems)).toBeLessThan(1e-6);
  });
});
