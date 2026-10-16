/**
 * The streamed WAV encoder (windsor#822 decision 1): the header, then one
 * chunk at a time to the writer, each awaited, from one reused buffer, and
 * the pieces together are `encodeWav`'s file byte for byte at every depth.
 */
import { describe, expect, it } from 'vitest';

import type { WavBitDepth } from './renderConstants';
import { encodeWav, encodeWavStream } from './wavEncoder';

describe('encodeWavStream', () => {
  const noisy = (frames: number): Float32Array[] =>
    [0.3, 0.7].map((phase) =>
      Float32Array.from({ length: frames }, (_, i) => 1.2 * Math.sin(i * phase)),
    );

  /** A writer that copies every piece it is handed, as a file on disk would keep it. */
  function collector() {
    const pieces: Uint8Array[] = [];
    const write = (bytes: Uint8Array<ArrayBuffer>): Promise<void> => {
      pieces.push(bytes.slice());
      return Promise.resolve();
    };
    const joined = (): Uint8Array => {
      const out = new Uint8Array(pieces.reduce((n, p) => n + p.length, 0));
      let at = 0;
      for (const piece of pieces) {
        out.set(piece, at);
        at += piece.length;
      }
      return out;
    };
    return { pieces, write, joined };
  }

  it("concatenates to encodeWav's bytes at every depth: a ragged length, one frame and none", async () => {
    for (const bits of [16, 24, 32] as WavBitDepth[]) {
      for (const frames of [1001, 1, 0]) {
        const channels = noisy(frames);
        const whole = encodeWav(channels, 44100, bits);
        const { write, joined, pieces } = collector();
        const streamed = await encodeWavStream(channels, 44100, bits, { write, chunkFrames: 100 });
        expect(joined()).toEqual(whole.bytes);
        expect(streamed).toEqual({ clipped: whole.clipped });
        // The header, then ceil(frames / 100) chunks: nothing more.
        expect(pieces).toHaveLength(1 + Math.ceil(frames / 100));
      }
    }
  });

  it('hands over the header, then chunks of chunkFrames frames from one reused buffer', async () => {
    const buffers = new Set<ArrayBufferLike>();
    const sizes: number[] = [];
    await encodeWavStream(noisy(250), 48000, 24, {
      chunkFrames: 100,
      write: (bytes) => {
        sizes.push(bytes.length);
        buffers.add(bytes.buffer);
        return Promise.resolve();
      },
    });
    expect(sizes).toEqual([44, 600, 600, 300]);
    // One buffer for the header and one for every chunk.
    expect(buffers.size).toBe(2);
  });

  it('awaits each write before encoding the next chunk', async () => {
    const log: string[] = [];
    let release!: () => void;
    const done = encodeWavStream(noisy(30), 48000, 16, {
      chunkFrames: 10,
      write: (bytes) => {
        log.push(`write ${bytes.length}`);
        return log.length === 2 ? new Promise((resolve) => (release = resolve)) : Promise.resolve();
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(log).toEqual(['write 44', 'write 40']);
    release();
    await done;
    expect(log).toEqual(['write 44', 'write 40', 'write 40', 'write 40']);
  });

  it('rejects with an AbortError between chunks and writes no further', async () => {
    const controller = new AbortController();
    const sizes: number[] = [];
    const encode = encodeWavStream(noisy(100), 48000, 32, {
      chunkFrames: 10,
      signal: controller.signal,
      write: (bytes) => {
        sizes.push(bytes.length);
        if (sizes.length === 3) controller.abort();
        return Promise.resolve();
      },
    });
    await expect(encode).rejects.toMatchObject({ name: 'AbortError' });
    expect(sizes).toEqual([58, 80, 80]);
  });

  it('writes nothing when already aborted, and passes a failed write on', async () => {
    const controller = new AbortController();
    controller.abort();
    const { write, pieces } = collector();
    await expect(
      encodeWavStream(noisy(10), 48000, 24, { signal: controller.signal, write }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(pieces).toHaveLength(0);
    await expect(
      encodeWavStream(noisy(10), 48000, 24, {
        write: () => Promise.reject(new Error('disk full')),
      }),
    ).rejects.toThrow('disk full');
  });

  it('refuses a chunk size that is not a positive integer', async () => {
    const { write } = collector();
    await expect(encodeWavStream(noisy(10), 48000, 24, { write, chunkFrames: 0 })).rejects.toThrow(
      RangeError,
    );
  });
});
