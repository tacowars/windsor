/**
 * A minimal ZIP reader for the stems' archive tests (windsor#41): it walks a
 * stored archive the way an unzipper does — the end record, the central
 * directory, each local header and the bytes after it — and throws on any
 * signature or cross-check that does not hold. Stored entries only.
 * Node-only, like the rest of this directory.
 */

export interface ReadZipEntry {
  name: string;
  data: Uint8Array;
  crc: number;
  flags: number;
  method: number;
  time: number;
  date: number;
}

const END_BYTES = 22;
const CENTRAL_BYTES = 46;
const LOCAL_BYTES = 30;

function expectField(actual: number, expected: number, what: string): void {
  if (actual !== expected) throw new Error(`zip: ${what} is ${actual}, expected ${expected}`);
}

export function readZip(zip: Uint8Array): ReadZipEntry[] {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const end = zip.length - END_BYTES;
  expectField(view.getUint32(end, true), 0x06054b50, 'the end signature');
  const count = view.getUint16(end + 10, true);
  const directorySize = view.getUint32(end + 12, true);
  let at = view.getUint32(end + 16, true);
  expectField(at + directorySize, end, 'the directory end');
  const entries: ReadZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    expectField(view.getUint32(at, true), 0x02014b50, 'a directory signature');
    const nameLength = view.getUint16(at + 28, true);
    const size = view.getUint32(at + 24, true);
    const local = view.getUint32(at + 42, true);
    expectField(view.getUint32(local, true), 0x04034b50, 'a local signature');
    expectField(view.getUint32(local + 14, true), view.getUint32(at + 16, true), 'the local CRC');
    expectField(view.getUint32(local + 22, true), size, 'the local size');
    const dataAt =
      local + LOCAL_BYTES + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    entries.push({
      name: new TextDecoder().decode(
        zip.subarray(at + CENTRAL_BYTES, at + CENTRAL_BYTES + nameLength),
      ),
      data: zip.subarray(dataAt, dataAt + size),
      crc: view.getUint32(at + 16, true),
      flags: view.getUint16(at + 8, true),
      method: view.getUint16(at + 10, true),
      time: view.getUint16(at + 12, true),
      date: view.getUint16(at + 14, true),
    });
    at += CENTRAL_BYTES + nameLength;
  }
  return entries;
}
