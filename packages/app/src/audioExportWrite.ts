/**
 * Writing an encoded WAV to a picked file so that Cancel still counts
 * (windsor#40). The bytes go in chunks, with the signal checked before each
 * chunk and before the close, and the close itself raced against it. A
 * writable stream replaces the file's contents only on `close()`, so aborting
 * it on a cancel or a failure leaves the file as it was.
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
    await closeUnlessAborted(writable, signal);
  } catch (error) {
    await writable.abort().catch(() => undefined);
    throw error;
  }
}

/**
 * `close()` raced against `signal` (windsor#51 decision 2): a large file's
 * close can take a while, and a Cancel while it is pending rejects at once so
 * the caller aborts the stream. The close left behind still settles; its
 * rejection is swallowed.
 */
function closeUnlessAborted(writable: ChunkWritable, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const onAbort = (): void => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    writable.close().then(
      () => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}
