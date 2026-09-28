/**
 * The Save as write (windsor#40): chunks, then close, and on a cancel or a
 * failure an abort instead of a close, so the picked file keeps its old
 * contents. The writable stream is a fake that records what it was told.
 */
import { describe, expect, it } from 'vitest';

import type { ChunkWritable } from './audioExportWrite';
import { writeInChunks } from './audioExportWrite';

/** A file of `n` zero bytes. */
const bytes = (n: number): Blob => new Blob([new Uint8Array(n)]);

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
      log.push(`write ${chunk.size}`);
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
    await writeInChunks(writable, bytes(10), new AbortController().signal, 4);
    expect(writable.log).toEqual(['write 4', 'write 4', 'write 2', 'close']);
  });

  it('a cancel during a pending chunk aborts instead of closing', async () => {
    const controller = new AbortController();
    let release!: () => void;
    const writable = fakeWritable((index) =>
      index === 1 ? new Promise<void>((resolve) => (release = resolve)) : Promise.resolve(),
    );
    const done = writeInChunks(writable, bytes(12), controller.signal, 4);
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
    await expect(writeInChunks(writable, bytes(3), controller.signal, 4)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(writable.log).toEqual(['write 3', 'abort']);
  });

  /** A writable whose close waits for the test to settle it, and a promise that the close began. */
  function pendingClose(): {
    writable: FakeWritable;
    closeStarted: Promise<void>;
    settle: (error?: Error) => void;
  } {
    const writable = fakeWritable();
    let started!: () => void;
    const closeStarted = new Promise<void>((resolve) => (started = resolve));
    let settle!: (error?: Error) => void;
    writable.close = () => {
      writable.log.push('close');
      started();
      return new Promise<void>((resolve, reject) => {
        settle = (error) => (error ? reject(error) : resolve());
      });
    };
    return { writable, closeStarted, settle: (error) => settle(error) };
  }

  it('a cancel once the close is called changes nothing: the close commits', async () => {
    const controller = new AbortController();
    const { writable, closeStarted, settle } = pendingClose();
    const done = writeInChunks(writable, bytes(3), controller.signal, 4);
    await closeStarted;
    controller.abort();
    settle();
    await expect(done).resolves.toBeUndefined();
    expect(writable.log).toEqual(['write 3', 'close']);
  });

  it("a cancel once the close is called reports the close's own error", async () => {
    const controller = new AbortController();
    const { writable, closeStarted, settle } = pendingClose();
    const done = writeInChunks(writable, bytes(3), controller.signal, 4);
    await closeStarted;
    controller.abort();
    settle(new Error('quota exceeded'));
    await expect(done).rejects.toThrow('quota exceeded');
  });

  it('writes nothing when already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const writable = fakeWritable();
    await expect(writeInChunks(writable, bytes(3), controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(writable.log).toEqual(['abort']);
  });

  it('a failed write aborts and rethrows', async () => {
    const writable = fakeWritable(() => Promise.reject(new Error('disk full')));
    await expect(writeInChunks(writable, bytes(3), new AbortController().signal)).rejects.toThrow(
      'disk full',
    );
    expect(writable.log).toEqual(['write 3', 'abort']);
  });
});
