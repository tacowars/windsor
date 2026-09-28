/**
 * `renderStems` (windsor#41) over the headless graph: the acceptance
 * criteria. The stems summed are the master with its inserts and limiter
 * bypassed (the fake limiter is a pass-through, and the song here has no
 * master insert), within a stated tolerance; every stem has the master's
 * length and start; a render split into passes lines up exactly with one
 * that is not.
 *
 * The fake `fm-part` plays a tone per part while its notes sound
 * (`noteFeeds.ts`), the same tone in every pass, so what is compared is the
 * routing: strips, the music bus's highpass, sends, returns and the master's
 * gains. The real DSP is pinned by its own goldens.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { FakeContext } from '../__fixtures__/fakeAudioContext';
import { FakeWorkletNode, installFakeAudioWorklet } from '../__fixtures__/fakeAudioContext';
import { FakeOfflineContext } from '../__fixtures__/fakeOfflineContext';
import { FULL_DOCUMENT, FULL_SLOT } from '../__fixtures__/fullArrangement';
import { noteToneFeed } from '../__fixtures__/noteFeeds';
import { BARS_MAX, BPM_MIN } from '../audioConstants';
import type { ArrangementDocument } from '../song/arrangementDocument';
import { PROCESSOR_NAME } from '../synth/workletMessages';
import { RENDER_QUANTUM_FRAMES } from './renderConstants';
import { renderSong, songSeconds } from './renderSong';
import type { RenderStemsOptions, RenderedStem } from './renderStems';
import { renderStems } from './renderStems';
import type { Stem } from './stemPlan';

/** Parts built per context, so each pass gives each part the same tone. */
const partsBuilt = new WeakMap<object, number>();

class TonePart extends FakeWorkletNode {
  constructor(context: FakeContext, name: string, options: { processorOptions?: unknown } = {}) {
    super(context, name, options);
    const probe = (context as Partial<FakeOfflineContext>).length === RENDER_QUANTUM_FRAMES;
    if (name !== PROCESSOR_NAME || probe) return;
    const index = partsBuilt.get(context) ?? 0;
    partsBuilt.set(context, index + 1);
    this.feed = noteToneFeed(this, 180 + 211 * index, 0.3);
  }
}

let restore: () => void = () => {};
beforeAll(() => {
  restore = installFakeAudioWorklet();
  (globalThis as { AudioWorkletNode?: unknown }).AudioWorkletNode = TonePart;
});
afterAll(() => restore());

const RATE = 8000;
const TAIL = 0.5;

/** No master insert, a master level off unity: the gains are what the stems must carry. */
const SONG: ArrangementDocument = { ...FULL_DOCUMENT, master: { inserts: [], level: 0.7 } };

interface Collected {
  stems: { stem: Stem; channels: Float32Array[] }[];
  contexts: FakeOfflineContext[];
  passes: number;
}

async function collect(
  document: ArrangementDocument,
  options: Partial<RenderStemsOptions> = {},
): Promise<Collected> {
  const contexts: FakeOfflineContext[] = [];
  const stems: Collected['stems'] = [];
  const result = await renderStems(
    document,
    {
      sampleRate: RATE,
      tailSeconds: TAIL,
      createContext: (init) => {
        const context = new FakeOfflineContext(init);
        contexts.push(context);
        return context;
      },
      ...options,
    },
    async ({ stem, channels }: RenderedStem) => {
      // Copies: the views are valid only until this promise settles.
      stems.push({ stem, channels: channels.map((c) => c.slice()) });
    },
  );
  return { stems, contexts, passes: result.passes };
}

const label = (stem: Stem): string =>
  stem.kind === 'master' ? 'master' : stem.kind === 'part' ? `part ${stem.slot}` : stem.name;

const peak = (channel: Float32Array): number =>
  channel.reduce((m, s) => Math.max(m, Math.abs(s)), 0);

describe('renderStems', () => {
  it('hands on the master, then each part by slot, then each return', async () => {
    const { stems, passes } = await collect(SONG);
    expect(passes).toBe(1);
    expect(stems.map((s) => label(s.stem))).toEqual([
      'master',
      'part 0',
      'part 1',
      'part 2',
      'part 3',
      'room',
      'echo',
    ]);
    for (const { channels } of stems.slice(1)) expect(peak(channels[0]!)).toBeGreaterThan(1e-3);
  });

  it("hands on the song render's master, bit for bit", async () => {
    const { stems } = await collect(SONG);
    const song = await renderSong(SONG, {
      sampleRate: RATE,
      tailSeconds: TAIL,
      createContext: (init) => new FakeOfflineContext(init),
    });
    expect(stems[0]!.channels).toEqual(song.channels);
  });

  it('sums to the master with its dynamics bypassed, within 1e-6 of full scale', async () => {
    const { stems } = await collect(SONG);
    const [master, ...rest] = stems;
    let error = 0;
    for (let c = 0; c < 2; c++) {
      const want = master!.channels[c]!;
      for (let i = 0; i < want.length; i++) {
        let sum = 0;
        for (const stem of rest) sum += stem.channels[c]![i]!;
        error = Math.max(error, Math.abs(sum - want[i]!));
      }
    }
    // Measured: 9.2e-8 against a 0.54 peak here (Node 24.20, Apple M1), and
    // 2.35e-7 against a 1.42 peak in headless Chrome 153's own offline
    // context (docs/research/2026-09-29-stem-render-accuracy). The residue is
    // float32 rounding: each stem runs its own copy of the music bus's
    // highpass, and the sum is taken in another order than the master's.
    expect(peak(master!.channels[0]!)).toBeGreaterThan(0.1);
    expect(error).toBeLessThan(1e-6);
  });

  it('gives every stem the master length and start: bar 1 on the first sample, then the tail', async () => {
    const { stems } = await collect(SONG);
    const frames = Math.round(songSeconds(SONG) * RATE) + Math.round(TAIL * RATE);
    for (const { channels } of stems) {
      expect(channels).toHaveLength(2);
      for (const channel of channels) expect(channel).toHaveLength(frames);
    }
    // The kick is on the downbeat: its stem, like the master, sounds in the first block.
    const kick = stems.find((s) => s.stem.kind === 'part' && s.stem.slot === FULL_SLOT.kick)!;
    const firstBlock = (channel: Float32Array): number => peak(channel.subarray(0, 128));
    expect(firstBlock(kick.channels[0]!)).toBeGreaterThan(1e-3);
    expect(firstBlock(stems[0]!.channels[0]!)).toBeGreaterThan(1e-3);
  });

  it('renders in passes that line up exactly with one pass', async () => {
    const one = await collect(SONG);
    // Two stems a pass: six channels, four passes for six stems.
    const narrow = await collect(SONG, { passLimits: { maxChannels: 6, maxSamples: 1e12 } });
    expect(narrow.passes).toBe(3);
    const rendered = narrow.contexts.filter((c) => c.length !== RENDER_QUANTUM_FRAMES);
    expect(rendered.map((c) => c.numberOfChannels)).toEqual([6, 6, 6]);
    expect(narrow.stems.map((s) => s.stem)).toEqual(one.stems.map((s) => s.stem));
    narrow.stems.forEach((stem, i) => expect(stem.channels).toEqual(one.stems[i]!.channels));
  });

  it('fails, writing nothing more, when a later pass does not line up', async () => {
    let songContexts = 0;
    const handed: string[] = [];
    const run = renderStems(
      SONG,
      {
        sampleRate: RATE,
        tailSeconds: 0,
        passLimits: { maxChannels: 6, maxSamples: 1e12 },
        createContext: (init) => {
          const context = new FakeOfflineContext(init);
          // The second pass's master comes out a block late, as a drifted pass would.
          if (init.length !== RENDER_QUANTUM_FRAMES && ++songContexts === 2) {
            const start = context.startRendering.bind(context);
            context.startRendering = async () => {
              const buffer = await start();
              buffer.getChannelData(0).copyWithin(RENDER_QUANTUM_FRAMES, 0);
              return buffer;
            };
          }
          return context;
        },
      },
      async ({ stem }) => void handed.push(label(stem)),
    );
    await expect(run).rejects.toThrow(/did not line up/);
    expect(handed).toEqual(['master', 'part 0', 'part 1']);
  });

  it('leaves a "Sidechain only" part out, or renders it as if routed to the master', async () => {
    const muted: ArrangementDocument = {
      ...SONG,
      parts: SONG.parts.map((part) =>
        part.slot === FULL_SLOT.arp
          ? { ...part, strip: { ...part.strip, output: 'sidechain' } }
          : part,
      ),
    };
    const skipped = await collect(muted);
    expect(skipped.stems.map((s) => label(s.stem))).not.toContain('part 2');
    const included = await collect(muted, { includeMuted: true });
    const arp = included.stems.find((s) => label(s.stem) === 'part 2')!;
    const audible = (await collect(SONG)).stems.find((s) => label(s.stem) === 'part 2')!;
    // The same signal the part makes when routed to the master.
    expect(arp.channels).toEqual(audible.channels);
    // The master never hears it: without the muted stem, the rest still sum to it.
    expect(included.stems[0]!.channels).toEqual(skipped.stems[0]!.channels);
  });

  it('refuses a song too long to render before building anything', async () => {
    const longest = {
      ...SONG,
      transport: { ...SONG.transport, bpm: BPM_MIN, bars: BARS_MAX },
    };
    const contexts: FakeOfflineContext[] = [];
    await expect(
      renderStems(
        longest,
        {
          sampleRate: 48000,
          createContext: (init) => {
            const context = new FakeOfflineContext(init);
            contexts.push(context);
            return context;
          },
        },
        async () => {},
      ),
    ).rejects.toThrow(RangeError);
    expect(contexts).toHaveLength(0);
  });

  it('cancels: an abort mid-render rejects with AbortError and hands on nothing more', async () => {
    const controller = new AbortController();
    const handed: string[] = [];
    const run = renderStems(
      SONG,
      {
        sampleRate: RATE,
        tailSeconds: 0,
        signal: controller.signal,
        passLimits: { maxChannels: 6, maxSamples: 1e12 },
        createContext: (init) => new FakeOfflineContext(init),
        onProgress: (fraction) => {
          if (fraction > 0.5) controller.abort();
        },
      },
      async ({ stem }) => void handed.push(label(stem)),
    );
    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
    expect(handed).toEqual(['master', 'part 0', 'part 1']);
  });

  it('reports progress across the passes, rising to 1', async () => {
    const seen: number[] = [];
    await collect(SONG, {
      passLimits: { maxChannels: 6, maxSamples: 1e12 },
      onProgress: (f) => seen.push(f),
    });
    expect(seen.at(-1)).toBe(1);
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]!);
    expect(seen.some((f) => f > 0.3 && f < 0.4)).toBe(true);
  });
});
