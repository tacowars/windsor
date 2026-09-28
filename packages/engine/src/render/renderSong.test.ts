/**
 * `renderSong` (windsor#40) over the headless graph: the offline render is the
 * live `AudioSystem` on another context, so a 4-bar song must come out as the
 * live pump plays it, sample for sample; two renders must be identical; the
 * tail must set the length; a cancel must return nothing.
 *
 * The fake `fm-part` plays a tone per part while its scheduled notes sound
 * (`noteFeeds.ts`), so what is compared is every note's frame and every
 * strip, return and master stage between the parts and the destination —
 * the real FM DSP is pinned by its own goldens.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  FakeContext,
  FakeWorkletNode,
  installFakeAudioWorklet,
  renderGraph,
} from '../__fixtures__/fakeAudioContext';
import type { FakeNode } from '../__fixtures__/fakeAudioNodes';
import { FakeOfflineContext } from '../__fixtures__/fakeOfflineContext';
import { FULL_DOCUMENT, FULL_PART_IDS, FULL_SLOT } from '../__fixtures__/fullArrangement';
import { noteToneFeed } from '../__fixtures__/noteFeeds';
import { SCHEDULER_START_DELAY_SECONDS } from '../audioConstants';
import type { ArrangementDocument } from '../song/arrangementDocument';
import { musicPartName } from '../song/documentParts';
import { FmEngine } from '../synth/fmEngine';
import type { ProcessorOptions } from '../synth/workletMessages';
import { PROCESSOR_NAME } from '../synth/workletMessages';
import { AudioSystem } from '../system/audioSystem';
import type { RenderSongOptions } from './renderSong';
import { renderSong, songSeconds } from './renderSong';

/** Every `fm-part` built, with the options it was built with. */
const built: { node: FakeWorkletNode; options: ProcessorOptions }[] = [];

class RecordingWorkletNode extends FakeWorkletNode {
  constructor(context: FakeContext, name: string, options: { processorOptions?: unknown } = {}) {
    super(context, name, options);
    if (name === PROCESSOR_NAME) {
      built.push({ node: this, options: options.processorOptions as ProcessorOptions });
      // A tone per engine part, the same for the live and the offline graph.
      const index = built.length;
      this.feed = noteToneFeed(this, 200 + 173 * (index % 8));
    }
  }
}

let restore: () => void = () => {};
beforeAll(() => {
  restore = installFakeAudioWorklet();
  (globalThis as { AudioWorkletNode?: unknown }).AudioWorkletNode = RecordingWorkletNode;
});
afterAll(() => restore());

const RATE = 48000;

function offline(
  document: ArrangementDocument,
  options: RenderSongOptions = {},
): { render: ReturnType<typeof renderSong>; contexts: FakeOfflineContext[] } {
  const contexts: FakeOfflineContext[] = [];
  built.length = 0;
  const render = renderSong(document, {
    sampleRate: RATE,
    createContext: (init) => {
      const context = new FakeOfflineContext(init);
      contexts.push(context);
      return context;
    },
    ...options,
  });
  return { render, contexts };
}

/** The live path: the system on a real-time stand-in, pumped every block like the app's timer. */
async function liveRender(document: ArrangementDocument, seconds: number): Promise<Float32Array> {
  built.length = 0;
  const context = new FakeContext();
  const system = new AudioSystem(new FmEngine(context.asAudioContext()));
  await system.init();
  system.initMusic(document);
  system.startMusic();
  const destination = context.destination as unknown as FakeNode;
  const [capture] = renderGraph(context, seconds, [destination], () => system.update(0));
  if (!capture) throw new Error('no capture');
  return capture.left;
}

describe('renderSong', () => {
  it('renders a 4-bar song bit-identical to the live pump', async () => {
    const song = songSeconds(FULL_DOCUMENT);
    const lead = Math.round(SCHEDULER_START_DELAY_SECONDS * RATE);
    const frames = Math.round(song * RATE);
    const live = await liveRender(FULL_DOCUMENT, song + 2 * SCHEDULER_START_DELAY_SECONDS);
    const { render } = offline(FULL_DOCUMENT, { tailSeconds: 0 });
    const rendered = await render;
    const left = rendered.channels[0]!;
    expect(left.length).toBe(frames);
    let energy = 0;
    for (const sample of left) energy += sample * sample;
    expect(energy).toBeGreaterThan(1);
    // Tolerance: none. The same ticks land on the same frames through the same graph.
    const reference = live.subarray(lead, lead + frames);
    let firstDiff = -1;
    for (let i = 0; i < frames && firstDiff < 0; i++) if (left[i] !== reference[i]) firstDiff = i;
    expect(firstDiff).toBe(-1);
  });

  it('renders the same song twice bit-identically, each part on its own fixed seed', async () => {
    const first = offline(FULL_DOCUMENT, { tailSeconds: 1 });
    const a = await first.render;
    const seedsA = built.map((b) => b.options.seed);
    const second = offline(FULL_DOCUMENT, { tailSeconds: 1 });
    const b = await second.render;
    const seedsB = built.map((entry) => entry.options.seed);
    expect(a.channels[0]).toEqual(b.channels[0]);
    expect(a.channels[1]).toEqual(b.channels[1]);
    expect(seedsA).toHaveLength(FULL_PART_IDS.length);
    expect(seedsA.every((seed) => typeof seed === 'number')).toBe(true);
    expect(new Set(seedsA).size).toBe(seedsA.length);
    expect(seedsB).toEqual(seedsA);
    // The stops are identical too: the render is driven, not timed.
    expect(second.contexts[0]!.suspendFrames).toEqual(first.contexts[0]!.suspendFrames);
  });

  it('leaves live parts unseeded', async () => {
    built.length = 0;
    const system = new AudioSystem(new FmEngine(new FakeContext().asAudioContext()));
    await system.init();
    system.initMusic(FULL_DOCUMENT);
    expect(built.map((b) => 'seed' in b.options)).toEqual(FULL_PART_IDS.map(() => false));
    expect(system.strip(musicPartName(FULL_SLOT.kick))).toBeDefined();
  });

  it('adds the tail after the last bar: 0 s and 10 s, at 44.1 kHz too', async () => {
    const empty: ArrangementDocument = { ...FULL_DOCUMENT, parts: [] };
    const song = songSeconds(empty);
    for (const [sampleRate, tail] of [
      [48000, 0],
      [44100, 10],
      [44100, 0],
    ] as const) {
      const { render } = offline(empty, { sampleRate, tailSeconds: tail });
      const rendered = await render;
      const expected = Math.round(song * sampleRate) + Math.round(tail * sampleRate);
      expect(rendered.channels).toHaveLength(2);
      expect(rendered.channels[0]).toHaveLength(expected);
      expect(rendered.channels[1]).toHaveLength(expected);
      expect(rendered.sampleRate).toBe(sampleRate);
    }
  });

  it('clamps the tail to 0–10 s', async () => {
    const empty: ArrangementDocument = { ...FULL_DOCUMENT, parts: [] };
    const frames = Math.round(songSeconds(empty) * RATE);
    const long = await offline(empty, { tailSeconds: 60 }).render;
    expect(long.channels[0]).toHaveLength(frames + 10 * RATE);
    const negative = await offline(empty, { tailSeconds: -3 }).render;
    expect(negative.channels[0]).toHaveLength(frames);
  });

  it('renders a song with no parts as silence of the right length', async () => {
    const empty: ArrangementDocument = { ...FULL_DOCUMENT, parts: [] };
    const rendered = await offline(empty, { tailSeconds: 2 }).render;
    expect(rendered.channels[0]).toHaveLength(Math.round((songSeconds(empty) + 2) * RATE));
    // Silence: the plate's alternating anti-denormal offset (~1e-20) sits far
    // below half a 24-bit step, so every PCM word the writer makes is 0.
    const peak = Math.max(
      ...rendered.channels.map((c) => c.reduce((m, s) => Math.max(m, Math.abs(s)), 0)),
    );
    expect(peak).toBeLessThan(2 ** -24);
    expect(built).toHaveLength(0);
  });

  it('reports rising progress that ends at 1', async () => {
    const seen: number[] = [];
    await offline(FULL_DOCUMENT, { tailSeconds: 0, onProgress: (f) => seen.push(f) }).render;
    expect(seen.length).toBeGreaterThan(10);
    expect(seen.at(-1)).toBe(1);
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]!);
  });

  it('cancels: an abort mid-render rejects with AbortError and returns no audio', async () => {
    const controller = new AbortController();
    const { render } = offline(FULL_DOCUMENT, {
      signal: controller.signal,
      onProgress: (fraction) => {
        if (fraction > 0.2) controller.abort();
      },
    });
    await expect(render).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('refuses before building anything when already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const { render, contexts } = offline(FULL_DOCUMENT, { signal: controller.signal });
    await expect(render).rejects.toMatchObject({ name: 'AbortError' });
    expect(contexts).toHaveLength(0);
  });
});

describe('songSeconds', () => {
  it('is the bars at the tempo, whatever the swing', () => {
    const straight = { ...FULL_DOCUMENT, transport: { bpm: 120, bars: 4 } };
    expect(songSeconds(straight)).toBeCloseTo(8, 12);
    const swung = {
      ...FULL_DOCUMENT,
      transport: { bpm: 120, bars: 4, swing: { amount: 66, grid: 16 as const } },
    };
    expect(songSeconds(swung)).toBeCloseTo(8, 9);
  });
});
