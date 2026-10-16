/**
 * The streamed Save as export (windsor#822): which export streams and the
 * cap each takes, and the run — render, open the writable, stream the
 * encode into it, close; or abort it on a cancel or a failure. The render,
 * the sink and the writable are fakes that record what they were told.
 */
import { describe, expect, it } from 'vitest';

import type { ArrangementDocument, RenderSongOptions, RenderedSong } from '@windsor/engine';
import {
  RENDER_MAX_FRAMES,
  RENDER_STREAM_MAX_FRAMES,
  encodeWav,
  encodeWavStream,
  renderRefusal,
} from '@windsor/engine';
import { FULL_DOCUMENT } from '@windsor/engine/__fixtures__/fullArrangement';

import type { AudioExportSettings, StreamWritable } from './audioExportModel';
import type { StreamSink, StreamedExportRun } from './audioExportStream';
import {
  exportFrameCap,
  exportRefusal,
  exportStreams,
  runStreamedExport,
} from './audioExportStream';

const SETTINGS: AudioExportSettings = {
  sampleRate: 48000,
  bitDepth: 24,
  tailSeconds: 2,
  stems: false,
  includeMuted: false,
};

/** A writable that records each call, the bytes of each write, and may fail or stall a write. */
function fakeWritable(onWrite: (index: number) => Promise<void> = () => Promise.resolve()) {
  const log: string[] = [];
  const chunks: Uint8Array[] = [];
  let index = 0;
  const writable: StreamWritable = {
    write: (bytes) => {
      log.push(`write ${bytes.length}`);
      chunks.push(bytes.slice());
      return onWrite(index++);
    },
    close: () => {
      log.push('close');
      return Promise.resolve();
    },
    abort: () => {
      log.push('abort');
      return Promise.resolve();
    },
  };
  return { writable, log, chunks };
}

function fakeSink(writable: StreamWritable) {
  const calls: string[] = [];
  const sink: StreamSink = {
    where: 'song.wav, where you chose',
    stream: () => {
      calls.push('stream');
      return Promise.resolve(writable);
    },
    discard: () => {
      calls.push('discard');
      return Promise.resolve();
    },
  };
  return { sink, calls };
}

const channels = (frames: number, value = 0.25): Float32Array[] => [
  new Float32Array(frames).fill(value),
  new Float32Array(frames).fill(-value),
];

function fakeRender(frames: number, value = 0.25) {
  const calls: { options: RenderSongOptions; maxFrames: number }[] = [];
  const render = async (
    _: unknown,
    options: RenderSongOptions,
    maxFrames: number,
  ): Promise<RenderedSong> => {
    calls.push({ options, maxFrames });
    await Promise.resolve();
    if (options.signal?.aborted) throw new DOMException('cancelled', 'AbortError');
    options.onProgress?.(1);
    return { channels: channels(frames, value), sampleRate: options.sampleRate!, songSeconds: 1 };
  };
  return { render, calls };
}

function run(overrides: Partial<StreamedExportRun> = {}): StreamedExportRun {
  return {
    document: FULL_DOCUMENT,
    settings: SETTINGS,
    fileName: 'song.wav',
    sink: fakeSink(fakeWritable().writable).sink,
    signal: new AbortController().signal,
    onProgress: () => {},
    render: fakeRender(250).render,
    encodeStream: (c, rate, depth, options) =>
      encodeWavStream(c, rate, depth, { ...options, chunkFrames: 100 }),
    ...overrides,
  };
}

const joined = (chunks: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
};

describe('which export streams, and its cap (decision 3)', () => {
  it('only Save as of the mix streams, and takes the stream cap', () => {
    expect(exportStreams('saveAs', false)).toBe(true);
    expect(exportStreams('saveAs', true)).toBe(false);
    expect(exportStreams('download', false)).toBe(false);
    expect(exportStreams('download', true)).toBe(false);
    expect(exportFrameCap('saveAs', false)).toBe(RENDER_STREAM_MAX_FRAMES);
    expect(exportFrameCap('saveAs', true)).toBe(RENDER_MAX_FRAMES);
    expect(exportFrameCap('download', false)).toBe(RENDER_MAX_FRAMES);
  });

  /** 225 bars of 4/4 at `bpm`: 15 minutes at 60 BPM, 30 at 30. */
  const song = (bpm: number, bars = 225): ArrangementDocument => ({
    ...FULL_DOCUMENT,
    transport: { ...FULL_DOCUMENT.transport, bpm, bars },
  });

  it('refuses a 30-minute song on Download and with stems, never on Save as of the mix', () => {
    const thirty = song(30);
    expect(exportRefusal(thirty, SETTINGS, 'saveAs', true)).toBeNull();
    expect(exportRefusal(thirty, { ...SETTINGS, stems: true }, 'saveAs', true)).toBe(
      renderRefusal(thirty, SETTINGS),
    );
    expect(exportRefusal(thirty, { ...SETTINGS, stems: true }, 'download', true)).toBe(
      renderRefusal(thirty, SETTINGS),
    );
    expect(exportRefusal(song(60, 100), SETTINGS, 'download', true)).toBeNull();
  });

  it('a Download refused only by the smaller cap names Save as', () => {
    expect(exportRefusal(song(30), SETTINGS, 'download', true)).toBe(
      'the song and its tail run 30.0 minutes, longer than the 15.0 minutes this export can ' +
        'hold at this sample rate — a download holds the whole file in memory; Save as… ' +
        'writes the WAV to the file as it encodes and can export it',
    );
    // Without the save picker there is no Save as to name.
    expect(exportRefusal(song(30), SETTINGS, 'download', false)).toBe(
      renderRefusal(song(30), SETTINGS),
    );
  });

  it('Save as takes the longest song the format holds; stems refuse it with the usual remedy', () => {
    const longest: ArrangementDocument = {
      ...FULL_DOCUMENT,
      transport: { ...FULL_DOCUMENT.transport, bpm: 20, bars: 256, meter: '12/8' },
    };
    const longestTail = { ...SETTINGS, tailSeconds: 10 };
    expect(exportRefusal(longest, longestTail, 'saveAs', true)).toBeNull();
    expect(exportRefusal(longest, { ...longestTail, stems: true }, 'saveAs', true)).toMatch(
      /^the song and its tail run 77\.0 minutes, .* or a faster tempo$/,
    );
    expect(exportRefusal(longest, longestTail, 'download', true)).toMatch(/Save as…/);
  });
});

describe('runStreamedExport', () => {
  it('renders at the stream cap, streams the encode into the writable and closes once', async () => {
    const { writable, log, chunks } = fakeWritable();
    const { sink, calls } = fakeSink(writable);
    const { render, calls: renders } = fakeRender(250);
    const progress: number[] = [];
    const outcome = await runStreamedExport(
      run({ sink, render, onProgress: (f) => progress.push(f) }),
    );
    expect(renders[0]).toMatchObject({
      options: { sampleRate: 48000, tailSeconds: 2 },
      maxFrames: RENDER_STREAM_MAX_FRAMES,
    });
    expect(progress).toEqual([1]);
    expect(calls).toEqual(['stream']);
    expect(log).toEqual(['write 44', 'write 600', 'write 600', 'write 300', 'close']);
    expect(joined(chunks)).toEqual(encodeWav(channels(250), 48000, 24).bytes);
    expect(outcome).toEqual({
      kind: 'saved',
      fileName: 'song.wav',
      where: 'song.wav, where you chose',
      clipped: 0,
    });
  });

  it('streams a 32-bit float file and counts what passes full scale', async () => {
    const { writable, chunks } = fakeWritable();
    const outcome = await runStreamedExport(
      run({
        sink: fakeSink(writable).sink,
        render: fakeRender(10, 1.5).render,
        settings: { ...SETTINGS, bitDepth: 32 },
      }),
    );
    expect(joined(chunks)).toEqual(encodeWav(channels(10, 1.5), 48000, 32).bytes);
    expect(outcome).toMatchObject({ kind: 'saved', clipped: 20 });
  });

  it('makes no whole file: only the header and chunks reach the writable', async () => {
    const { writable, log } = fakeWritable();
    const { sink } = fakeSink(writable);
    const sizes: number[] = [];
    const outcome = await runStreamedExport(
      run({
        sink,
        // A fake encoder that hands over three small pieces of a file it never holds.
        encodeStream: async (_channels, _rate, _depth, { write }) => {
          for (const size of [44, 8, 8]) {
            sizes.push(size);
            await write(new Uint8Array(size));
          }
          return { clipped: 0 };
        },
      }),
    );
    expect(outcome.kind).toBe('saved');
    expect(log).toEqual(['write 44', 'write 8', 'write 8', 'close']);
    // The run hands the sink no Blob: a streamed sink has no whole-file write at all.
    expect(Object.keys(sink)).not.toContain('write');
  });

  it('a cancel mid-encode aborts the writable, never closes it, and reports cancelled', async () => {
    const controller = new AbortController();
    const { writable, log } = fakeWritable((index) => {
      if (index === 2) controller.abort();
      return Promise.resolve();
    });
    const { sink, calls } = fakeSink(writable);
    const outcome = await runStreamedExport(run({ sink, signal: controller.signal }));
    expect(outcome).toEqual({ kind: 'cancelled' });
    expect(log).toEqual(['write 44', 'write 600', 'write 600', 'abort']);
    expect(calls).toEqual(['stream', 'discard']);
  });

  it('a failed write aborts the writable, never closes it, and reports failed', async () => {
    const { writable, log } = fakeWritable((index) =>
      index === 1 ? Promise.reject(new Error('disk full')) : Promise.resolve(),
    );
    const outcome = await runStreamedExport(run({ sink: fakeSink(writable).sink }));
    expect(outcome).toEqual({ kind: 'failed', error: 'disk full' });
    expect(log).toEqual(['write 44', 'write 600', 'abort']);
  });

  it('a cancel during the render never opens the file', async () => {
    const controller = new AbortController();
    const { writable, log } = fakeWritable();
    const { sink, calls } = fakeSink(writable);
    const outcome = await runStreamedExport(
      run({ sink, signal: controller.signal, onProgress: () => controller.abort() }),
    );
    expect(outcome).toEqual({ kind: 'cancelled' });
    expect(log).toEqual([]);
    expect(calls).toEqual(['discard']);
  });

  it('a failed render never opens the file and says why', async () => {
    const { writable, log } = fakeWritable();
    const { sink, calls } = fakeSink(writable);
    const render = (): Promise<RenderedSong> => Promise.reject(new Error('worklet failed'));
    const outcome = await runStreamedExport(run({ sink, render }));
    expect(outcome).toEqual({ kind: 'failed', error: 'worklet failed' });
    expect(log).toEqual([]);
    expect(calls).toEqual(['discard']);
  });

  it('a cancel after the last chunk, before the close, still aborts', async () => {
    const controller = new AbortController();
    const { writable, log } = fakeWritable((index) => {
      if (index === 3) controller.abort();
      return Promise.resolve();
    });
    const outcome = await runStreamedExport(
      run({ sink: fakeSink(writable).sink, signal: controller.signal }),
    );
    expect(outcome).toEqual({ kind: 'cancelled' });
    expect(log.at(-1)).toBe('abort');
    expect(log).not.toContain('close');
  });

  it('a cancel once the close is called changes nothing: the close commits or fails', async () => {
    for (const failure of [undefined, new Error('quota exceeded')]) {
      const controller = new AbortController();
      const { writable, log } = fakeWritable();
      writable.close = () => {
        log.push('close');
        controller.abort();
        return failure ? Promise.reject(failure) : Promise.resolve();
      };
      const outcome = await runStreamedExport(
        run({ sink: fakeSink(writable).sink, signal: controller.signal }),
      );
      expect(outcome).toEqual(
        failure
          ? { kind: 'failed', error: 'quota exceeded' }
          : { kind: 'saved', fileName: 'song.wav', where: 'song.wav, where you chose', clipped: 0 },
      );
      expect(log.filter((entry) => entry === 'close')).toHaveLength(1);
    }
  });
});
