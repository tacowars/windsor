/**
 * CRC-32 (IEEE 802.3, the ZIP checksum) for the stems' archive (windsor#41).
 * Table-driven, one byte at a time. `crc32Async` reads a long file in
 * chunks, yielding and checking its signal between them, as the chunked WAV
 * encoder does, so a Cancel lands while a stem is being checksummed.
 */
import {
  CRC32_BITS_PER_BYTE,
  CRC32_BYTE_MASK,
  CRC32_CHUNK_BYTES,
  CRC32_MASK,
  CRC32_POLYNOMIAL,
  CRC32_TABLE_SIZE,
} from './zipConstants';

const TABLE = buildTable();

function buildTable(): Uint32Array {
  const table = new Uint32Array(CRC32_TABLE_SIZE);
  for (let n = 0; n < CRC32_TABLE_SIZE; n++) {
    let c = n;
    for (let k = 0; k < CRC32_BITS_PER_BYTE; k++) {
      c = c & 1 ? CRC32_POLYNOMIAL ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
}

/** The CRC of `bytes`, continuing from `crc` (the CRC of whatever came before; 0 to start). */
export function crc32(bytes: Uint8Array, crc = 0): number {
  let c = (crc ^ CRC32_MASK) >>> 0;
  for (let i = 0; i < bytes.length; i++) {
    c = TABLE[(c ^ bytes[i]!) & CRC32_BYTE_MASK]! ^ (c >>> CRC32_BITS_PER_BYTE);
  }
  return (c ^ CRC32_MASK) >>> 0;
}

export interface Crc32AsyncOptions {
  /** Aborting rejects with an `AbortError` between chunks. */
  signal?: AbortSignal;
  /** Bytes read between yields, a positive integer; the shipped `CRC32_CHUNK_BYTES` when absent. */
  chunkBytes?: number;
  yieldToLoop?: () => Promise<void>;
}

/** `crc32` in chunks, handing the event loop back between them. */
export async function crc32Async(
  bytes: Uint8Array,
  options: Crc32AsyncOptions = {},
): Promise<number> {
  const { signal, chunkBytes = CRC32_CHUNK_BYTES, yieldToLoop = nextTask } = options;
  if (!Number.isInteger(chunkBytes) || chunkBytes <= 0) {
    throw new RangeError(`chunkBytes must be a positive integer, got ${chunkBytes}`);
  }
  let crc = 0;
  for (let at = 0; ; at += chunkBytes) {
    if (signal?.aborted) throw new DOMException('the checksum was cancelled', 'AbortError');
    if (at >= bytes.length) return crc;
    crc = crc32(bytes.subarray(at, at + chunkBytes), crc);
    await yieldToLoop();
  }
}

function nextTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
