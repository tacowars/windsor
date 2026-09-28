/**
 * The Save as write (windsor#40): chunks, then close, and on a cancel or a
 * failure an abort instead of a close, so the picked file keeps its old
 * contents. The writable stream is a fake that records what it was told.
 */
import { describe, expect, it } from 'vitest';

import type { ChunkWritable } from './audioExportWrite';
import { writeInChunks } from './audioExportWrite';

interface FakeWritable extends ChunkWritable {
  log: string[];
}

function fakeWritable(
  onWrite: (index: number) => Promise<void> = () => Promise.resolve(),
): FakeWritable {
  const log: string[] = [];
  let index = 0;
  return {
    log,
    write: (chunk) => {
      log.push(`write ${chunk.length}`);
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
}

describe('writeInChunks', () => {
  it('writes every byte in chunks, then closes', async () => {
    const writable = fakeWritable();
    await writeInChunks(writable, new Uint8Array(10), new AbortController().signal, 4);
    expect(writable.log).toEqual(['write 4', 'write 4', 'write 2', 'close']);
  });

  it('a cancel during a pending chunk aborts instead of closing', async () => {
    const controller = new AbortController();
    let release!: () => void;
    const writable = fakeWritable((index) =>
      index === 1 ? new Promise<void>((resolve) => (release = resolve)) : Promise.resolve(),
    );
    const done = writeInChunks(writable, new Uint8Array(12), controller.signal, 4);
    await Promise.resolve();
    await Promise.resolve();
    controller.abort();
    release();
    await expect(done).rejects.toMatchObject({ name: 'AbortError' });
    expect(writable.log).toEqual(['write 4', 'write 4', 'abort']);
  });

  it('a cancel before the close aborts', async () => {
    const controller = new AbortController();
    const writable = fakeWritable(() => {
      controller.abort();
      return Promise.resolve();
    });
    await expect(
      writeInChunks(writable, new Uint8Array(3), controller.signal, 4),
    ).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(writable.log).toEqual(['write 3', 'abort']);
  });

  it('a cancel while the close is pending aborts the stream at once', async () => {
    const controller = new AbortController();
    const writable = fakeWritable();
    let closing!: () => void;
    const closeStarted = new Promise<void>((resolve) => (closing = resolve));
    writable.close = () => {
      writable.log.push('close');
      closing();
      // A close that never finishes on its own: only the abort ends the wait.
      return new Promise<void>(() => {});
    };
    const done = writeInChunks(writable, new Uint8Array(3), controller.signal, 4);
    await closeStarted;
    controller.abort();
    await expect(done).rejects.toMatchObject({ name: 'AbortError' });
    expect(writable.log).toEqual(['write 3', 'close', 'abort']);
  });

  it('writes nothing when already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const writable = fakeWritable();
    await expect(
      writeInChunks(writable, new Uint8Array(3), controller.signal),
    ).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(writable.log).toEqual(['abort']);
  });

  it('a failed write aborts and rethrows', async () => {
    const writable = fakeWritable(() => Promise.reject(new Error('disk full')));
    await expect(
      writeInChunks(writable, new Uint8Array(3), new AbortController().signal),
    ).rejects.toThrow('disk full');
    expect(writable.log).toEqual(['write 3', 'abort']);
  });
});
