/**
 * The WAV writer (windsor#40 decision 6): planar float channels to a
 * little-endian RIFF/WAVE file, 16- or 24-bit PCM or 32-bit IEEE float
 * (windsor#822 decision 4). Pure, with no dependency.
 *
 * PCM: a sample outside [-1, 1] is clipped and counted, so the console can
 * say the render clipped instead of writing it silently. 16-bit output
 * carries TPDF dither (the difference of two uniform draws, ±1 LSB,
 * triangular) from a seeded PRNG, so two encodes of the same render are
 * byte-identical; 24-bit output is rounded without dither, its LSB already
 * far below the synth's noise floor.
 *
 * Float: every sample is written as it is, with no dither and no clip, and
 * one outside [-1, 1] is counted as kept. A non-finite sample (NaN, ±∞) has
 * no place in a file a tool reads back, so it is written as 0 and counted
 * apart, as non-finite.
 *
 * `encodeWavAsync` writes the same bytes in chunks, yielding between them, so
 * a long song's encode can be cancelled (windsor#51). `encodeWavStream`
 * hands the same bytes to a writer chunk by chunk instead of holding the
 * file (windsor#822 decision 1).
 */
import { mulberry32 } from '../sequencing/mulberry32';
import type { WavBitDepth } from './renderConstants';
import {
  BITS_PER_BYTE,
  BYTE_MASK,
  WAV_DITHERED_BIT_DEPTH,
  WAV_DITHER_SEED,
  WAV_ENCODE_CHUNK_FRAMES,
  WAV_FACT_CHUNK_BYTES,
  WAV_FLOAT_BIT_DEPTH,
  WAV_FLOAT_FMT_CHUNK_BYTES,
  WAV_FLOAT_HEADER_BYTES,
  WAV_FMT_CHUNK_BYTES,
  WAV_FMT_EXTENSION_BYTES,
  WAV_FORMAT_IEEE_FLOAT,
  WAV_FORMAT_PCM,
  WAV_HEADER_BYTES,
  WAV_RIFF_SIZE_MAX,
  WAV_RIFF_SIZE_OFFSET,
} from './renderConstants';

/** What an encode counted, over every channel. */
export interface WavCounts {
  /** Finite samples outside [-1, 1]: clipped in a PCM file, kept in a float one. */
  clipped: number;
  /** Non-finite samples (NaN, ±∞) a float file wrote as 0; always 0 for a PCM file. */
  nonFinite: number;
}

export interface EncodedWav extends WavCounts {
  bytes: Uint8Array;
}

export interface WavOptions {
  /** The dither PRNG's seed; the shipped one when absent. */
  ditherSeed?: number;
}

/** The header's length at `bitDepth`: 44 bytes for PCM, 58 for float with its `fact` chunk. */
export const wavHeaderBytes = (bitDepth: WavBitDepth): number =>
  bitDepth === WAV_FLOAT_BIT_DEPTH ? WAV_FLOAT_HEADER_BYTES : WAV_HEADER_BYTES;

/**
 * The header for `frames` frames of `channels` channels (exported for its
 * test). A file whose size RIFF's 32-bit field cannot hold is refused.
 */
export function wavHeader(
  channels: number,
  sampleRate: number,
  bitDepth: WavBitDepth,
  frames: number,
): Uint8Array<ArrayBuffer> {
  const float = bitDepth === WAV_FLOAT_BIT_DEPTH;
  const blockAlign = channels * (bitDepth / BITS_PER_BYTE);
  const dataBytes = frames * blockAlign;
  const headerBytes = wavHeaderBytes(bitDepth);
  const riffBytes = headerBytes - WAV_RIFF_SIZE_OFFSET + dataBytes;
  if (riffBytes > WAV_RIFF_SIZE_MAX) {
    throw new RangeError(`a WAV holds at most 4 GiB; this one would need ${riffBytes} bytes`);
  }
  const header = new Uint8Array(headerBytes);
  const writer = new HeaderWriter(header);
  writer.tag('RIFF');
  writer.u32(riffBytes);
  writer.tag('WAVE');
  writer.tag('fmt ');
  writer.u32(float ? WAV_FLOAT_FMT_CHUNK_BYTES : WAV_FMT_CHUNK_BYTES);
  writer.u16(float ? WAV_FORMAT_IEEE_FLOAT : WAV_FORMAT_PCM);
  writer.u16(channels);
  writer.u32(sampleRate);
  writer.u32(sampleRate * blockAlign);
  writer.u16(blockAlign);
  writer.u16(bitDepth);
  if (float) {
    writer.u16(WAV_FMT_EXTENSION_BYTES);
    writer.tag('fact');
    writer.u32(WAV_FACT_CHUNK_BYTES);
    writer.u32(frames);
  }
  writer.tag('data');
  writer.u32(dataBytes);
  return header;
}

/**
 * Interleave and quantise `channels` (equal lengths) into a WAV file. The
 * PCM full-scale value is `2^(bits-1) - 1`, so +1.0 and -1.0 land
 * symmetrically.
 */
export function encodeWav(
  channels: readonly Float32Array[],
  sampleRate: number,
  bitDepth: WavBitDepth,
  options: WavOptions = {},
): EncodedWav {
  const file = new WholeFile(channels, sampleRate, bitDepth, options);
  file.advance(file.encoder.frames);
  return file.result();
}

export interface AsyncWavOptions extends WavOptions {
  /** Aborting rejects the encode with an `AbortError` between chunks (windsor#51). */
  signal?: AbortSignal;
  /** Frames encoded between yields; the shipped `WAV_ENCODE_CHUNK_FRAMES` when absent. */
  chunkFrames?: number;
  /** How the encoder hands the event loop back between chunks; a macrotask when absent. */
  yieldToLoop?: () => Promise<void>;
}

/**
 * `encodeWav` in chunks, yielding to the event loop between them and
 * checking `signal` after each yield (windsor#51 decision 1), so a Cancel
 * click during a long song's encode lands before the file is handed on. The
 * bytes are the synchronous encoder's exactly: one writer, one dither PRNG,
 * advanced chunk by chunk.
 */
export async function encodeWavAsync(
  channels: readonly Float32Array[],
  sampleRate: number,
  bitDepth: WavBitDepth,
  options: AsyncWavOptions = {},
): Promise<EncodedWav> {
  const { signal, chunkFrames = WAV_ENCODE_CHUNK_FRAMES, yieldToLoop = nextTask } = options;
  checkChunkFrames(chunkFrames);
  const file = new WholeFile(channels, sampleRate, bitDepth, options);
  for (;;) {
    throwIfAborted(signal);
    if (file.encoder.done) return file.result();
    file.advance(chunkFrames);
    await yieldToLoop();
  }
}

export interface WavStreamOptions extends WavOptions {
  /** Aborting rejects the encode with an `AbortError` before the next chunk is encoded. */
  signal?: AbortSignal;
  /**
   * Takes the file's next bytes: the header, then one chunk at a time. The
   * encoder awaits each write before it encodes the next chunk, so the
   * destination sets the pace, and it reuses one chunk buffer, so a write
   * must be done with the bytes when its promise settles.
   */
  write: (bytes: Uint8Array<ArrayBuffer>) => Promise<void>;
  /** Frames per chunk; the shipped `WAV_ENCODE_CHUNK_FRAMES` when absent. */
  chunkFrames?: number;
}

/**
 * The same file as `encodeWav`, handed to `write` piece by piece instead of
 * held whole (windsor#822 decision 1): the header, then one chunk of
 * `chunkFrames` frames at a time, from one encoder and one dither PRNG, so
 * the concatenated pieces are `encodeWav`'s bytes exactly. It holds one chunk
 * of the file at a time, and checks `signal` before the header and between
 * chunks.
 */
export async function encodeWavStream(
  channels: readonly Float32Array[],
  sampleRate: number,
  bitDepth: WavBitDepth,
  options: WavStreamOptions,
): Promise<WavCounts> {
  const { signal, write, chunkFrames = WAV_ENCODE_CHUNK_FRAMES } = options;
  checkChunkFrames(chunkFrames);
  const encoder = new SampleEncoder(channels, bitDepth, options);
  const header = wavHeader(channels.length, sampleRate, bitDepth, encoder.frames);
  throwIfAborted(signal);
  await write(header);
  const chunk = new Uint8Array(Math.min(chunkFrames, encoder.frames) * encoder.blockAlign);
  const view = new DataView(chunk.buffer);
  for (;;) {
    throwIfAborted(signal);
    if (encoder.done) return encoder.counts();
    const length = encoder.encode(chunk, view, 0, chunkFrames);
    await write(length === chunk.length ? chunk : chunk.subarray(0, length));
  }
}

function checkChunkFrames(chunkFrames: number): void {
  if (!Number.isInteger(chunkFrames) || chunkFrames <= 0) {
    throw new RangeError(`chunkFrames must be a positive integer, got ${chunkFrames}`);
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new DOMException('the encode was canceled', 'AbortError');
}

function nextTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** The whole file in one buffer, filled by one encoder: `encodeWav`'s and `encodeWavAsync`'s. */
class WholeFile {
  readonly encoder: SampleEncoder;
  private readonly bytes: Uint8Array;
  private readonly view: DataView;
  private at: number;

  constructor(
    channels: readonly Float32Array[],
    sampleRate: number,
    bitDepth: WavBitDepth,
    options: WavOptions,
  ) {
    this.encoder = new SampleEncoder(channels, bitDepth, options);
    const header = wavHeader(channels.length, sampleRate, bitDepth, this.encoder.frames);
    this.bytes = new Uint8Array(header.length + this.encoder.frames * this.encoder.blockAlign);
    this.bytes.set(header);
    this.view = new DataView(this.bytes.buffer);
    this.at = header.length;
  }

  advance(count: number): void {
    this.at += this.encoder.encode(this.bytes, this.view, this.at, count);
  }

  result(): EncodedWav {
    return { bytes: this.bytes, ...this.encoder.counts() };
  }
}

/** One encode in progress: the dither PRNG, the counts of samples past full scale and non-finite, the next frame. */
class SampleEncoder {
  readonly frames: number;
  readonly blockAlign: number;
  private clipped = 0;
  private nonFinite = 0;
  private frame = 0;
  private readonly float: boolean;
  private readonly bytesPerSample: number;
  private readonly fullScale: number;
  private readonly random: (() => number) | null;

  constructor(
    private readonly channels: readonly Float32Array[],
    bitDepth: WavBitDepth,
    options: WavOptions,
  ) {
    this.frames = channels[0]?.length ?? 0;
    this.float = bitDepth === WAV_FLOAT_BIT_DEPTH;
    this.bytesPerSample = bitDepth / BITS_PER_BYTE;
    this.blockAlign = channels.length * this.bytesPerSample;
    this.fullScale = 2 ** (bitDepth - 1) - 1;
    this.random =
      bitDepth === WAV_DITHERED_BIT_DEPTH
        ? mulberry32(options.ditherSeed ?? WAV_DITHER_SEED)
        : null;
  }

  counts(): WavCounts {
    return { clipped: this.clipped, nonFinite: this.nonFinite };
  }

  get done(): boolean {
    return this.frame >= this.frames;
  }

  /** Encode up to `count` more frames, in order, into `target` from byte `at`; returns the bytes written. */
  encode(target: Uint8Array, view: DataView, at: number, count: number): number {
    const end = Math.min(this.frames, this.frame + count);
    if (this.float) this.floats(view, at, end);
    else this.words(target, at, end);
    const written = (end - this.frame) * this.blockAlign;
    this.frame = end;
    return written;
  }

  private words(target: Uint8Array, start: number, end: number): void {
    const { bytesPerSample, fullScale, random, channels } = this;
    let { clipped } = this;
    let at = start;
    for (let frame = this.frame; frame < end; frame++) {
      for (const channel of channels) {
        let sample = channel[frame] ?? 0;
        if (sample > 1 || sample < -1) {
          clipped++;
          sample = sample > 1 ? 1 : -1;
        }
        const dither = random ? random() - random() : 0;
        const word = Math.max(
          -fullScale - 1,
          Math.min(fullScale, Math.round(sample * fullScale + dither)),
        );
        writeWord(target, at, word, bytesPerSample);
        at += bytesPerSample;
      }
    }
    this.clipped = clipped;
  }

  private floats(view: DataView, start: number, end: number): void {
    const { bytesPerSample, channels } = this;
    let { clipped, nonFinite } = this;
    let at = start;
    for (let frame = this.frame; frame < end; frame++) {
      for (const channel of channels) {
        let sample = channel[frame] ?? 0;
        if (!Number.isFinite(sample)) {
          nonFinite++;
          sample = 0;
        } else if (sample > 1 || sample < -1) {
          clipped++;
        }
        view.setFloat32(at, sample, true);
        at += bytesPerSample;
      }
    }
    this.clipped = clipped;
    this.nonFinite = nonFinite;
  }
}

/** Little-endian fields written in order. */
class HeaderWriter {
  private at = 0;
  private readonly view: DataView;

  constructor(private readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  tag(text: string): void {
    for (const char of text) this.bytes[this.at++] = char.charCodeAt(0);
  }

  u16(value: number): void {
    this.view.setUint16(this.at, value, true);
    this.at += Uint16Array.BYTES_PER_ELEMENT;
  }

  u32(value: number): void {
    this.view.setUint32(this.at, value, true);
    this.at += Uint32Array.BYTES_PER_ELEMENT;
  }
}

/** One little-endian two's-complement word of `bytes` bytes (the arithmetic shift keeps the sign). */
function writeWord(target: Uint8Array, at: number, word: number, bytes: number): void {
  for (let i = 0; i < bytes; i++) target[at + i] = (word >> (i * BITS_PER_BYTE)) & BYTE_MASK;
}
