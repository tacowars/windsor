/**
 * The WAV writer (windsor#40 decision 6): byte-exact headers for every rate
 * and depth the console offers, samples that round-trip, clip counting, and
 * a 16-bit dither that is TPDF (±1 LSB) and reproducible; and the chunked
 * async encoder, byte-identical and cancellable between chunks (windsor#51).
 */
import { describe, expect, it } from 'vitest';

import { encodeWav, encodeWavAsync, wavHeader } from './wavEncoder';

/** Little-endian bytes of `value` in `width` bytes. */
const le = (value: number, width: number): number[] =>
  Array.from({ length: width }, (_, i) => (value >>> (8 * i)) & 0xff);
const ascii = (text: string): number[] => [...text].map((c) => c.charCodeAt(0));

/** Decode interleaved PCM back to planar floats at the writer's full scale. */
function decode(bytes: Uint8Array, channels: number, bits: 16 | 24): Float32Array[] {
  const width = bits / 8;
  const frames = (bytes.length - 44) / (channels * width);
  const out = Array.from({ length: channels }, () => new Float32Array(frames));
  const full = 2 ** (bits - 1) - 1;
  let at = 44;
  for (let f = 0; f < frames; f++) {
    for (let c = 0; c < channels; c++) {
      let word = 0;
      for (let i = 0; i < width; i++) word |= bytes[at + i]! << (8 * i);
      if (word & (1 << (bits - 1))) word -= 2 ** bits;
      out[c]![f] = word / full;
      at += width;
    }
  }
  return out;
}

describe('wavHeader', () => {
  it('writes the canonical 44-byte PCM header for 44.1 kHz 16-bit stereo', () => {
    const frames = 1000;
    // prettier-ignore
    expect([...wavHeader(2, 44100, 16, frames)]).toEqual([
      ...ascii('RIFF'),
      ...le(36 + frames * 4, 4),
      ...ascii('WAVE'),
      ...ascii('fmt '),
      16, 0, 0, 0,
      1, 0,
      2, 0,
      0x44, 0xac, 0x00, 0x00, // 44100
      0x10, 0xb1, 0x02, 0x00, // 176400 bytes per second
      4, 0,
      16, 0,
      ...ascii('data'),
      ...le(frames * 4, 4),
    ]);
  });

  it('writes the header for 48 kHz 24-bit stereo', () => {
    const frames = 48000;
    // prettier-ignore
    expect([...wavHeader(2, 48000, 24, frames)]).toEqual([
      ...ascii('RIFF'),
      ...le(36 + frames * 6, 4),
      ...ascii('WAVE'),
      ...ascii('fmt '),
      16, 0, 0, 0,
      1, 0,
      2, 0,
      0x80, 0xbb, 0x00, 0x00, // 48000
      0x00, 0x65, 0x04, 0x00, // 288000 bytes per second
      6, 0,
      24, 0,
      ...ascii('data'),
      0x00, 0x65, 0x04, 0x00, // 288000 data bytes
    ]);
  });

  it('covers the other two combinations by their rate and block fields', () => {
    const view = (h: Uint8Array): DataView => new DataView(h.buffer);
    const a = view(wavHeader(2, 44100, 24, 10));
    expect([a.getUint32(24, true), a.getUint32(28, true), a.getUint16(32, true)]).toEqual([
      44100, 264600, 6,
    ]);
    const b = view(wavHeader(2, 48000, 16, 10));
    expect([b.getUint32(24, true), b.getUint32(28, true), b.getUint16(32, true)]).toEqual([
      48000, 192000, 4,
    ]);
  });
});

describe('encodeWav', () => {
  const sine = (frames: number, hz: number, rate: number, amp = 0.8): Float32Array =>
    Float32Array.from({ length: frames }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / rate));

  it('round-trips a 24-bit sine to within half a step', () => {
    const left = sine(4800, 440, 48000);
    const right = sine(4800, 660, 48000);
    const { bytes, clipped } = encodeWav([left, right], 48000, 24);
    expect(bytes.length).toBe(44 + 4800 * 6);
    expect(clipped).toBe(0);
    const [l, r] = decode(bytes, 2, 24);
    const step = 1 / (2 ** 23 - 1);
    for (let i = 0; i < left.length; i++) {
      expect(Math.abs(l![i]! - left[i]!)).toBeLessThanOrEqual(step / 2 + 1e-9);
      expect(Math.abs(r![i]! - right[i]!)).toBeLessThanOrEqual(step / 2 + 1e-9);
    }
  });

  it('round-trips a 16-bit sine to within the TPDF dither, with no DC added', () => {
    const left = sine(44100, 1000, 44100);
    const { bytes } = encodeWav([left, left], 44100, 16);
    const [l] = decode(bytes, 2, 16);
    const step = 1 / 32767;
    let sum = 0;
    for (let i = 0; i < left.length; i++) {
      const error = l![i]! - left[i]!;
      expect(Math.abs(error)).toBeLessThanOrEqual(1.5 * step + 1e-9);
      sum += error;
    }
    expect(Math.abs(sum / left.length)).toBeLessThan(0.05 * step);
  });

  it('dithers 16-bit reproducibly, silence moving by at most one step', () => {
    const silence = new Float32Array(1000);
    const a = encodeWav([silence, silence], 48000, 16).bytes;
    expect(encodeWav([silence, silence], 48000, 16).bytes).toEqual(a);
    expect(encodeWav([silence, silence], 48000, 16, { ditherSeed: 7 }).bytes).not.toEqual(a);
    const [l] = decode(a, 2, 16);
    expect([...l!].every((s) => Math.abs(Math.round(s * 32767)) <= 1)).toBe(true);
  });

  it('writes 24-bit silence as zeros', () => {
    const silence = new Float32Array(100);
    const { bytes } = encodeWav([silence, silence], 48000, 24);
    expect(bytes.subarray(44).every((b) => b === 0)).toBe(true);
  });

  it('clips to [-1, 1] and counts every clipped sample', () => {
    const left = Float32Array.from([0, 1.5, -2, 1, -1, 0.5]);
    const right = Float32Array.from([1.0001, 0, 0, 0, 0, -1.25]);
    const { bytes, clipped } = encodeWav([left, right], 48000, 24);
    expect(clipped).toBe(4);
    const [l, r] = decode(bytes, 2, 24);
    const full = 2 ** 23 - 1;
    expect([...l!]).toEqual([0, 1, -1, 1, -1, Math.fround(Math.round(0.5 * full) / full)]);
    expect(r![0]).toBe(1);
    expect(r![5]).toBe(-1);
  });

  it('writes the two extremes as the symmetric full-scale words', () => {
    const { bytes } = encodeWav([Float32Array.from([1, -1])], 48000, 24);
    expect([...bytes.subarray(44)]).toEqual([0xff, 0xff, 0x7f, 0x01, 0x00, 0x80]);
  });
});

describe('encodeWavAsync', () => {
  /** A noisy stereo pair with some clipped samples, so dither and clipping both run. */
  const noisy = (frames: number): Float32Array[] =>
    [0.3, 0.7].map((phase) =>
      Float32Array.from({ length: frames }, (_, i) => 1.2 * Math.sin(i * phase)),
    );

  it("writes the synchronous encoder's bytes exactly, at both depths and any chunk size", async () => {
    const channels = noisy(1001);
    for (const bits of [16, 24] as const) {
      const sync = encodeWav(channels, 44100, bits);
      for (const chunkFrames of [1, 7, 1000, 1001, 1 << 16]) {
        const chunked = await encodeWavAsync(channels, 44100, bits, {
          chunkFrames,
          yieldToLoop: () => Promise.resolve(),
        });
        expect(chunked.clipped).toBe(sync.clipped);
        expect(chunked.bytes).toEqual(sync.bytes);
      }
    }
  });

  it('yields to the event loop between chunks by default', async () => {
    let ticked = false;
    setTimeout(() => {
      ticked = true;
    }, 0);
    await encodeWavAsync(noisy(100), 48000, 24, { chunkFrames: 30 });
    expect(ticked).toBe(true);
  });

  it('rejects with an AbortError when aborted between chunks, and encodes no further', async () => {
    const controller = new AbortController();
    let yields = 0;
    const encode = encodeWavAsync(noisy(100), 48000, 16, {
      chunkFrames: 10,
      signal: controller.signal,
      yieldToLoop: () => {
        if (++yields === 2) controller.abort();
        return Promise.resolve();
      },
    });
    await expect(encode).rejects.toMatchObject({ name: 'AbortError' });
    expect(yields).toBe(2);
  });

  it('refuses at once when already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      encodeWavAsync(noisy(10), 48000, 24, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
