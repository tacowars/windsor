/**
 * Export Audio's stems (windsor#41): the file names, and the run — every
 * stem encoded into one stored zip, written once, and nothing written on a
 * cancel or a failure. The render is a fake that hands on stems the way the
 * engine's does; the real one is `renderStems.test.ts`'s.
 */
import { describe, expect, it } from 'vitest';

import type { RenderStemsOptions, RenderedStem, RenderedStems, Stem } from '@windsor/engine';
import { encodeWav, encodeWavAsync } from '@windsor/engine';
import { FULL_DOCUMENT } from '@windsor/engine/__fixtures__/fullArrangement';
import { readZip } from '@windsor/engine/__fixtures__/zipReader';

import type { WavSink } from './audioExportModel';
import type { StemExportRun } from './audioExportStems';
import { runStemExport, stemFileName, stemsZipName } from './audioExportStems';

const MASTER: Stem = { kind: 'master' };
const KICK: Stem = { kind: 'part', slot: 0, name: 'kick', muted: false };
const SEND_A: Stem = { kind: 'return', name: 'a' };
const SEND_B: Stem = { kind: 'return', name: 'b' };

describe('stem file names', () => {
  it('names the master, each part by number and label, and each send bus', () => {
    expect(stemFileName('night bus.json', MASTER)).toBe('night bus.wav');
    expect(stemFileName('night bus.json', KICK)).toBe('night bus-01-kick.wav');
    expect(stemFileName('night bus.json', { ...KICK, slot: 7, name: 'Pad' })).toBe(
      'night bus-08-Pad.wav',
    );
    expect(stemFileName('night bus.json', SEND_A)).toBe('night bus-send-a.wav');
    expect(stemFileName('night bus.json', SEND_B)).toBe('night bus-send-b.wav');
    expect(stemsZipName('night bus.json')).toBe('night bus-stems.zip');
  });

  it("makes a part's label safe, and numbers a part with none", () => {
    expect(stemFileName('song', { ...KICK, name: 'a/b: c?' })).toBe('song-01-a-b- c-.wav');
    expect(stemFileName('song', { ...KICK, slot: 2, name: '  ' })).toBe('song-03.wav');
    expect(stemFileName('', SEND_A)).toBe('song-send-a.wav');
  });
});

interface FakeSink extends WavSink {
  written: Blob[];
  discarded: number;
}

function fakeSink(): FakeSink {
  const sink: FakeSink = {
    where: 'your downloads',
    written: [],
    discarded: 0,
    write: (file) => {
      sink.written.push(file);
      return Promise.resolve();
    },
    discard: () => {
      sink.discarded++;
      return Promise.resolve();
    },
  };
  return sink;
}

/** Hands on each stem as `frames` frames at its own level, checking the signal like the engine. */
function fakeStems(stems: { stem: Stem; value: number }[], frames = 64) {
  const calls: RenderStemsOptions[] = [];
  const render = async (
    _: unknown,
    options: RenderStemsOptions,
    onStem: (rendered: RenderedStem) => Promise<void>,
  ): Promise<RenderedStems> => {
    calls.push(options);
    for (const [i, { stem, value }] of stems.entries()) {
      if (options.signal?.aborted) throw new DOMException('cancelled', 'AbortError');
      options.onProgress?.(i / stems.length);
      const channel = new Float32Array(frames).fill(value);
      await onStem({ stem, channels: [channel, channel], sampleRate: options.sampleRate ?? 48000 });
    }
    return { stems: stems.map((s) => s.stem), passes: 1, sampleRate: 48000, songSeconds: 1 };
  };
  return { render, calls };
}

const THREE = [
  { stem: MASTER, value: 0.5 },
  { stem: KICK, value: 0.25 },
  { stem: SEND_A, value: 1.5 },
];

function run(overrides: Partial<StemExportRun> = {}): StemExportRun {
  return {
    document: FULL_DOCUMENT,
    settings: {
      sampleRate: 44100,
      bitDepth: 16,
      tailSeconds: 1,
      stems: true,
      includeMuted: true,
    },
    exportName: 'night bus.json',
    fileName: 'night bus-stems.zip',
    modified: new Date(2026, 8, 29, 12, 0, 0),
    sink: fakeSink(),
    signal: new AbortController().signal,
    onProgress: () => {},
    render: fakeStems(THREE).render,
    encode: encodeWavAsync,
    ...overrides,
  };
}

describe('runStemExport', () => {
  it('renders with the settings and writes one zip of every stem, encoded', async () => {
    const sink = fakeSink();
    const { render, calls } = fakeStems(THREE);
    const outcome = await runStemExport(run({ sink, render }));
    expect(calls[0]).toMatchObject({ sampleRate: 44100, tailSeconds: 1, includeMuted: true });
    expect(sink.written).toHaveLength(1);
    const zip = sink.written[0]!;
    expect(zip.type).toBe('application/zip');
    const entries = readZip(new Uint8Array(await zip.arrayBuffer()));
    expect(entries.map((e) => e.name)).toEqual([
      'night bus.wav',
      'night bus-01-kick.wav',
      'night bus-send-a.wav',
    ]);
    entries.forEach((entry, i) => {
      const channel = new Float32Array(64).fill(THREE[i]!.value);
      expect(entry.data).toEqual(encodeWav([channel, channel], 44100, 16).bytes);
    });
    // The Send A stem is over full scale: 64 frames × 2 channels clipped.
    expect(outcome).toEqual({
      kind: 'saved',
      fileName: 'night bus-stems.zip',
      where: 'your downloads',
      clipped: 128,
    });
  });

  it('a cancel mid-render writes nothing and discards', async () => {
    const sink = fakeSink();
    const controller = new AbortController();
    const outcome = await runStemExport(
      run({
        sink,
        signal: controller.signal,
        onProgress: (fraction) => {
          if (fraction > 0) controller.abort();
        },
      }),
    );
    expect(outcome).toEqual({ kind: 'cancelled' });
    expect(sink.written).toHaveLength(0);
    expect(sink.discarded).toBe(1);
  });

  it("a cancel during a stem's encode writes nothing", async () => {
    const sink = fakeSink();
    const controller = new AbortController();
    let encodes = 0;
    const encode: StemExportRun['encode'] = (channels, rate, depth, { signal }) => {
      if (++encodes === 2) controller.abort();
      return encodeWavAsync(channels, rate, depth, { signal });
    };
    const outcome = await runStemExport(run({ sink, signal: controller.signal, encode }));
    expect(outcome).toEqual({ kind: 'cancelled' });
    expect(encodes).toBe(2);
    expect(sink.written).toHaveLength(0);
  });

  it('a failed render writes nothing and says why', async () => {
    const sink = fakeSink();
    const render: StemExportRun['render'] = () =>
      Promise.reject(new Error('stem pass 2 did not line up with the first'));
    const outcome = await runStemExport(run({ sink, render }));
    expect(outcome).toEqual({
      kind: 'failed',
      error: 'stem pass 2 did not line up with the first',
    });
    expect(sink.written).toHaveLength(0);
    expect(sink.discarded).toBe(1);
  });
});
