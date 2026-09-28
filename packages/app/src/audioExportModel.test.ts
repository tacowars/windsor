/**
 * Export Audio's rules (windsor#40): the file name, the destinations, the one
 * run — render, encode, write — and its cancel, which writes nothing. The
 * render and the sink are fakes; the real render is `renderSong.test.ts`'s.
 */
import { describe, expect, it } from 'vitest';

import type { RenderSongOptions, RenderedSong } from '@windsor/engine';
import { RENDER_SAMPLE_RATE_DEFAULT, RENDER_TAIL_SECONDS, encodeWav } from '@windsor/engine';
import { FULL_DOCUMENT } from '@windsor/engine/__fixtures__/fullArrangement';

import type { AudioExportRun, WavSink } from './audioExportModel';
import {
  defaultExportSettings,
  exportDestinations,
  exportNotice,
  runAudioExport,
  wavFileName,
} from './audioExportModel';

interface FakeSink extends WavSink {
  written: Uint8Array[];
  discarded: number;
}

function fakeSink(): FakeSink {
  const sink: FakeSink = {
    where: 'your downloads',
    written: [],
    discarded: 0,
    write: (bytes) => {
      sink.written.push(bytes);
      return Promise.resolve();
    },
    discard: () => {
      sink.discarded++;
      return Promise.resolve();
    },
  };
  return sink;
}

/** A render of `frames` frames at `value`, stepping progress and honouring the signal like the engine's. */
function fakeRender(frames: number, value = 0.25) {
  const calls: RenderSongOptions[] = [];
  const render = async (_: unknown, options: RenderSongOptions): Promise<RenderedSong> => {
    calls.push(options);
    for (const fraction of [0.25, 0.5, 0.75]) {
      await Promise.resolve();
      if (options.signal?.aborted) throw new DOMException('cancelled', 'AbortError');
      options.onProgress?.(fraction);
    }
    const channel = new Float32Array(frames).fill(value);
    return {
      channels: [channel, channel],
      sampleRate: options.sampleRate ?? 48000,
      songSeconds: 1,
    };
  };
  return { render, calls };
}

function run(overrides: Partial<AudioExportRun> = {}): AudioExportRun {
  return {
    document: FULL_DOCUMENT,
    settings: { sampleRate: 44100, bitDepth: 16, tailSeconds: 0 },
    fileName: 'song.wav',
    sink: fakeSink(),
    signal: new AbortController().signal,
    onProgress: () => {},
    render: fakeRender(100).render,
    encode: encodeWav,
    ...overrides,
  };
}

describe('wavFileName', () => {
  it('is the song name from the Export field, less .json, with .wav', () => {
    expect(wavFileName('dub techno.json')).toBe('dub techno.wav');
    expect(wavFileName('  Night Bus.JSON ')).toBe('Night Bus.wav');
    expect(wavFileName('take')).toBe('take.wav');
  });

  it('replaces characters a file system refuses and falls back to "song"', () => {
    expect(wavFileName('a/b:c?.json')).toBe('a-b-c-.wav');
    expect(wavFileName('')).toBe('song.wav');
    expect(wavFileName('.json')).toBe('song.wav');
  });
});

describe('exportDestinations', () => {
  it('offers Save as… only where the save picker exists', () => {
    expect(exportDestinations(true)).toEqual(['download', 'saveAs']);
    expect(exportDestinations(false)).toEqual(['download']);
  });
});

describe('defaultExportSettings', () => {
  it("starts from the engine's defaults", () => {
    const settings = defaultExportSettings();
    expect(settings.sampleRate).toBe(RENDER_SAMPLE_RATE_DEFAULT);
    expect(settings.tailSeconds).toBe(RENDER_TAIL_SECONDS.default);
    expect(RENDER_TAIL_SECONDS).toMatchObject({ min: 0, max: 10, default: 2 });
  });
});

describe('runAudioExport', () => {
  it('renders with the settings, encodes the chosen depth and writes once', async () => {
    const sink = fakeSink();
    const { render, calls } = fakeRender(100);
    const progress: number[] = [];
    const outcome = await runAudioExport(
      run({
        sink,
        render,
        settings: { sampleRate: 44100, bitDepth: 24, tailSeconds: 3 },
        onProgress: (f) => progress.push(f),
      }),
    );
    expect(calls[0]).toMatchObject({ sampleRate: 44100, tailSeconds: 3 });
    expect(progress).toEqual([0.25, 0.5, 0.75]);
    expect(sink.written).toHaveLength(1);
    const channel = new Float32Array(100).fill(0.25);
    expect(sink.written[0]).toEqual(encodeWav([channel, channel], 44100, 24).bytes);
    expect(sink.discarded).toBe(0);
    expect(outcome).toEqual({
      kind: 'saved',
      fileName: 'song.wav',
      where: 'your downloads',
      clipped: 0,
    });
  });

  it('cancel stops the render and writes nothing', async () => {
    const sink = fakeSink();
    const controller = new AbortController();
    const outcome = await runAudioExport(
      run({ sink, signal: controller.signal, onProgress: () => controller.abort() }),
    );
    expect(outcome).toEqual({ kind: 'cancelled' });
    expect(sink.written).toHaveLength(0);
    expect(sink.discarded).toBe(1);
  });

  it('a cancel that lands after the render still writes nothing', async () => {
    const sink = fakeSink();
    const controller = new AbortController();
    const render = async (): Promise<RenderedSong> => {
      controller.abort();
      return { channels: [new Float32Array(4)], sampleRate: 48000, songSeconds: 0 };
    };
    const outcome = await runAudioExport(run({ sink, signal: controller.signal, render }));
    expect(outcome.kind).toBe('cancelled');
    expect(sink.written).toHaveLength(0);
  });

  it('a failed render writes nothing and says why', async () => {
    const sink = fakeSink();
    const render = (): Promise<RenderedSong> => Promise.reject(new Error('worklet failed'));
    const outcome = await runAudioExport(run({ sink, render }));
    expect(outcome).toEqual({ kind: 'failed', error: 'worklet failed' });
    expect(sink.written).toHaveLength(0);
    expect(sink.discarded).toBe(1);
  });

  it('reports the clipped samples', async () => {
    const outcome = await runAudioExport(run({ render: fakeRender(10, 1.5).render }));
    expect(outcome).toMatchObject({ kind: 'saved', clipped: 20 });
  });
});

describe('exportNotice', () => {
  it('names where the file went', () => {
    expect(
      exportNotice({ kind: 'saved', fileName: 'a.wav', where: 'your downloads', clipped: 0 }),
    ).toEqual({ message: 'saved a.wav to your downloads', tone: 'success' });
  });

  it('warns when the render clipped, errors on a failure, informs on a cancel', () => {
    expect(exportNotice({ kind: 'saved', fileName: 'a.wav', where: 'x', clipped: 3 }).tone).toBe(
      'warning',
    );
    expect(exportNotice({ kind: 'failed', error: 'boom' })).toEqual({
      message: 'audio export failed: boom',
      tone: 'error',
    });
    expect(exportNotice({ kind: 'cancelled' }).tone).toBe('info');
  });
});
