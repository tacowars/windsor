/**
 * Writing an encoded WAV to a picked file so that Cancel still counts
 * (windsor#40). The bytes go in chunks, with the signal checked before each
 * chunk and before the close. A writable stream replaces the file's contents
 * only on `close()`, so aborting it on a cancel or a failure leaves the file
 * as it was.
 */
import { WAV_WRITE_CHUNK_BYTES } from './audioExportConstants';

/** What the writer needs of a `FileSystemWritableFileStream`; a test fakes it. */
export interface ChunkWritable {
  write(chunk: Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
}

export function abortError(): DOMException {
  return new DOMException('the export was cancelled', 'AbortError');
}

/** Write `bytes` and close, or abort the stream and throw when `signal` fires or a write fails. */
export async function writeInChunks(
  writable: ChunkWritable,
  bytes: Uint8Array,
  signal: AbortSignal,
  chunkBytes: number = WAV_WRITE_CHUNK_BYTES,
): Promise<void> {
  try {
    for (let at = 0; at < bytes.length; at += chunkBytes) {
      if (signal.aborted) throw abortError();
      await writable.write(bytes.subarray(at, at + chunkBytes));
    }
    if (signal.aborted) throw abortError();
    await writable.close();
  } catch (error) {
    await writable.abort().catch(() => undefined);
    throw error;
  }
}
