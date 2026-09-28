/**
 * The stems' zip (windsor#41): CRC-32 against its check value, and a stored
 * archive read back the way a reader walks one (`zipReader.ts`). An archive
 * from this writer also passed `unzip -t` (Info-ZIP 6.00) and Python's
 * `zipfile.testzip()`, UTF-8 name included, when the writer was written.
 */
import { describe, expect, it } from 'vitest';

import { readZip } from '../__fixtures__/zipReader';
import { crc32, crc32Async } from './crc32';
import { StoredZipWriter } from './storedZip';

const text = (s: string): Uint8Array => new TextEncoder().encode(s);

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function zipOf(files: Record<string, Uint8Array>, modified = new Date(2026, 8, 29, 14, 7, 31)) {
  const writer = new StoredZipWriter(modified);
  const parts: Uint8Array[] = [];
  for (const [name, data] of Object.entries(files)) {
    parts.push(writer.entry(name, data.length, crc32(data)), data);
  }
  parts.push(writer.finish());
  return concat(parts);
}

describe('crc32', () => {
  it('matches the CRC-32 check value, and continues across chunks', () => {
    expect(crc32(text('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
    const whole = text('the quick brown fox');
    expect(crc32(whole.subarray(7), crc32(whole.subarray(0, 7)))).toBe(crc32(whole));
  });

  it('checksums in chunks, and a cancel lands between them', async () => {
    const bytes = text('123456789');
    expect(await crc32Async(bytes, { chunkBytes: 2, yieldToLoop: async () => {} })).toBe(
      0xcbf43926,
    );
    const controller = new AbortController();
    let chunks = 0;
    const run = crc32Async(bytes, {
      chunkBytes: 2,
      signal: controller.signal,
      yieldToLoop: async () => {
        if (++chunks === 2) controller.abort();
      },
    });
    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
    expect(chunks).toBe(2);
  });

  it('refuses a chunk that is not a positive integer', async () => {
    for (const chunkBytes of [0, -1, NaN, 2.5]) {
      await expect(crc32Async(text('123456789'), { chunkBytes })).rejects.toThrow(
        new RangeError(`chunkBytes must be a positive integer, got ${chunkBytes}`),
      );
    }
  });
});

describe('StoredZipWriter', () => {
  it('writes stored entries a reader walks back to the same bytes', () => {
    const files = {
      'song.wav': text('RIFF master'),
      'song-01-kick.wav': text('RIFF kick'),
      'song-return-room.wav': new Uint8Array(0),
    };
    const entries = readZip(zipOf(files));
    expect(entries.map((e) => e.name)).toEqual(Object.keys(files));
    for (const entry of entries) {
      expect(entry.data).toEqual(files[entry.name as keyof typeof files]);
      expect(entry.crc).toBe(crc32(entry.data));
      expect(entry.method).toBe(0);
      expect(entry.flags).toBe(0x0800);
    }
  });

  it('stores a UTF-8 name and the local time, to two seconds', () => {
    const [entry] = readZip(zipOf({ 'Nachtbus – Bässe.wav': text('x') }));
    expect(entry!.name).toBe('Nachtbus – Bässe.wav');
    expect(entry!.date).toBe(((2026 - 1980) << 9) | (9 << 5) | 29);
    expect(entry!.time).toBe((14 << 11) | (7 << 5) | 15);
  });

  it('lays out headers the size it counts, and an empty archive is its end record', () => {
    const writer = new StoredZipWriter(new Date(2026, 0, 1));
    const header = writer.entry('a.wav', 100, 0);
    expect(writer.size).toBe(header.length + 100);
    expect(readZip(zipOf({}))).toEqual([]);
    expect(zipOf({})).toHaveLength(22);
  });

  it('refuses an archive past 4 GiB rather than write a broken one', () => {
    const writer = new StoredZipWriter(new Date(2026, 0, 1));
    writer.entry('a.wav', 2 ** 31, 0);
    expect(() => writer.entry('b.wav', 2 ** 31, 0)).toThrow(RangeError);
  });
});
