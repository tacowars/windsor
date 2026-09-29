/**
 * Writing a finished file — a WAV, or the stems' zip (windsor#41) — to a
 * picked file so that Cancel still counts (windsor#40). The file goes in
 * chunks, with the signal checked before each chunk and before the close. A
 * writable stream replaces the file's contents only on `close()`, so aborting it on a cancel or a failure before then
 * leaves the file as it was. The close is the commit point (windsor#51
 * decision 2): once it is called, a Cancel no longer changes the outcome,
 * which is the close's own — saved, or its error.
 */
import { WAV_WRITE_CHUNK_BYTES } from './audioExportConstants';

/** What the writer needs of a `FileSystemWritableFileStream`; a test fakes it. */
export interface ChunkWritable {
  write(chunk: Blob): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
}

export function abortError(): DOMException {
  return new DOMException('the export was cancelled', 'AbortError');
}

/** Write `file` and close, or abort the stream and throw when `signal` fires or a write fails. */
export async function writeInChunks(
  writable: ChunkWritable,
  file: Blob,
  signal: AbortSignal,
  chunkBytes: number = WAV_WRITE_CHUNK_BYTES,
): Promise<void> {
  try {
    for (let at = 0; at < file.size; at += chunkBytes) {
      if (signal.aborted) throw abortError();
      await writable.write(file.slice(at, at + chunkBytes));
    }
    // `close()` is the commit point (windsor#51 decision 2): the last look at
    // the signal is here, and a Cancel once the close is called changes
    // nothing, since an abort cannot undo a close in flight.
    if (signal.aborted) throw abortError();
    await writable.close();
  } catch (error) {
    await writable.abort().catch(() => undefined);
    throw error;
  }
}
