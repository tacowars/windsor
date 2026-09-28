/**
 * The WAV writer (windsor#40 decision 6): planar float channels to a
 * little-endian RIFF/WAVE PCM file, 16 or 24 bits. Pure, with no dependency.
 *
 * A sample outside [-1, 1] is clipped and counted, so the console can say the
 * render clipped instead of writing it silently. 16-bit output carries TPDF
 * dither (the difference of two uniform draws, ±1 LSB, triangular) from a
 * seeded PRNG, so two encodes of the same render are byte-identical; 24-bit
 * output is rounded without dither, its LSB already far below the synth's
 * noise floor.
 *
 * `encodeWavAsync` writes the same bytes in chunks, yielding between them, so
 * a long song's encode can be cancelled (windsor#51).
 */
import { mulberry32 } from '../sequencing/mulberry32';
import type { WavBitDepth } from './renderConstants';
import {
  BITS_PER_BYTE,
  BYTE_MASK,
  WAV_DITHERED_BIT_DEPTH,
  WAV_DITHER_SEED,
  WAV_ENCODE_CHUNK_FRAMES,
  WAV_FMT_CHUNK_BYTES,
  WAV_FORMAT_PCM,
  WAV_HEADER_BYTES,
  WAV_RIFF_SIZE_OFFSET,
} from './renderConstants';

export interface EncodedWav {
  bytes: Uint8Array;
  /** Samples, counted over every channel, that were outside [-1, 1] and clipped. */
  clipped: number;
}

export interface WavOptions {
  /** The dither PRNG's seed; the shipped one when absent. */
  ditherSeed?: number;
}

/** The 44-byte header for `frames` frames of `channels` channels (exported for its test). */
export function wavHeader(
  channels: number,
  sampleRate: number,
  bitDepth: WavBitDepth,
  frames: number,
): Uint8Array {
  const bytesPerSample = bitDepth / BITS_PER_BYTE;
  const blockAlign = channels * bytesPerSample;
  const dataBytes = frames * blockAlign;
  const header = new Uint8Array(WAV_HEADER_BYTES);
  const writer = new HeaderWriter(header);
  writer.tag('RIFF');
  writer.u32(WAV_HEADER_BYTES - WAV_RIFF_SIZE_OFFSET + dataBytes);
  writer.tag('WAVE');
  writer.tag('fmt ');
  writer.u32(WAV_FMT_CHUNK_BYTES);
  writer.u16(WAV_FORMAT_PCM);
  writer.u16(channels);
  writer.u32(sampleRate);
  writer.u32(sampleRate * blockAlign);
  writer.u16(blockAlign);
  writer.u16(bitDepth);
  writer.tag('data');
  writer.u32(dataBytes);
  return header;
}

/**
 * Interleave and quantise `channels` (equal lengths) into a WAV file. The
 * full-scale value is `2^(bits-1) - 1`, so +1.0 and -1.0 land symmetrically.
 */
export function encodeWav(
  channels: readonly Float32Array[],
  sampleRate: number,
  bitDepth: WavBitDepth,
  options: WavOptions = {},
): EncodedWav {
  const writer = new WavWriter(channels, sampleRate, bitDepth, options);
  writer.advance(writer.frames);
  return writer.result();
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
  const writer = new WavWriter(channels, sampleRate, bitDepth, options);
  for (;;) {
    if (signal?.aborted) throw new DOMException('the encode was cancelled', 'AbortError');
    if (writer.done) return writer.result();
    writer.advance(chunkFrames);
    await yieldToLoop();
  }
}

function nextTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** One encode in progress: the file being filled, the dither PRNG, and the next frame. */
class WavWriter {
  readonly frames: number;
  private readonly bytes: Uint8Array;
  private readonly bytesPerSample: number;
  private readonly fullScale: number;
  private readonly random: (() => number) | null;
  private clipped = 0;
  private frame = 0;
  private at = WAV_HEADER_BYTES;

  constructor(
    private readonly channels: readonly Float32Array[],
    sampleRate: number,
    bitDepth: WavBitDepth,
    options: WavOptions,
  ) {
    this.frames = channels[0]?.length ?? 0;
    this.bytesPerSample = bitDepth / BITS_PER_BYTE;
    this.bytes = new Uint8Array(
      WAV_HEADER_BYTES + this.frames * channels.length * this.bytesPerSample,
    );
    this.bytes.set(wavHeader(channels.length, sampleRate, bitDepth, this.frames));
    this.fullScale = 2 ** (bitDepth - 1) - 1;
    this.random =
      bitDepth === WAV_DITHERED_BIT_DEPTH
        ? mulberry32(options.ditherSeed ?? WAV_DITHER_SEED)
        : null;
  }

  get done(): boolean {
    return this.frame >= this.frames;
  }

  /** Encode up to `count` more frames, in order. */
  advance(count: number): void {
    const { bytes, bytesPerSample, fullScale, random, channels } = this;
    const end = Math.min(this.frames, this.frame + count);
    let { at, clipped } = this;
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
        writeWord(bytes, at, word, bytesPerSample);
        at += bytesPerSample;
      }
    }
    this.frame = end;
    this.at = at;
    this.clipped = clipped;
  }

  result(): EncodedWav {
    return { bytes: this.bytes, clipped: this.clipped };
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
