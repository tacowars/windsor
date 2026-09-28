/**
 * A ZIP writer for the stems' download (windsor#41 decision 3): stored
 * entries, no compression, no dependency. Written from PKWARE's APPNOTE.TXT
 * (the fields are `zipConstants.ts`).
 *
 * It never holds the files. Each `entry` returns the local header that goes
 * before that file's bytes, given the file's size and CRC (`crc32.ts`), and
 * `finish` returns the central directory that ends the archive. The caller
 * lays them out — header, file, header, file, …, directory — as the parts of
 * one `Blob`, so a stem's bytes can be let go as soon as they are in it.
 *
 * Names are UTF-8 (flag bit 11). Every entry carries the one modification
 * time the writer was made with. Sizes and offsets are 32-bit: an archive
 * past 4 GiB would need ZIP64, and is refused with a `RangeError`.
 */
import {
  DOS_EPOCH_YEAR,
  DOS_HOUR_SHIFT,
  DOS_MINUTE_SHIFT,
  DOS_MONTH_SHIFT,
  DOS_SECONDS_PER_UNIT,
  DOS_YEAR_SHIFT,
  ZIP_CENTRAL_HEADER_BYTES,
  ZIP_CENTRAL_SIGNATURE,
  ZIP_END_BYTES,
  ZIP_END_SIGNATURE,
  ZIP_FLAG_UTF8,
  ZIP_LOCAL_HEADER_BYTES,
  ZIP_LOCAL_SIGNATURE,
  ZIP_MAX_16,
  ZIP_MAX_32,
  ZIP_METHOD_STORED,
  ZIP_VERSION,
} from './zipConstants';

interface Written {
  name: Uint8Array;
  crc: number;
  size: number;
  offset: number;
}

export class StoredZipWriter {
  private readonly entries: Written[] = [];
  private readonly time: number;
  private readonly date: number;
  private offset = 0;

  /** `modified` is every entry's time, read in local time as ZIP stores it. */
  constructor(modified: Date) {
    this.time =
      (modified.getHours() << DOS_HOUR_SHIFT) |
      (modified.getMinutes() << DOS_MINUTE_SHIFT) |
      Math.floor(modified.getSeconds() / DOS_SECONDS_PER_UNIT);
    this.date =
      (Math.max(0, modified.getFullYear() - DOS_EPOCH_YEAR) << DOS_YEAR_SHIFT) |
      ((modified.getMonth() + 1) << DOS_MONTH_SHIFT) |
      modified.getDate();
  }

  /** Bytes laid out so far: every header and file, not yet the directory. */
  get size(): number {
    return this.offset;
  }

  /** The local header to place just before a file of `size` bytes whose CRC-32 is `crc`. */
  entry(fileName: string, size: number, crc: number): Uint8Array {
    const name = new TextEncoder().encode(fileName);
    if (name.length > ZIP_MAX_16) throw new RangeError(`zip: the name ${fileName} is too long`);
    if (this.entries.length >= ZIP_MAX_16) throw new RangeError('zip: too many entries');
    const header = new FieldWriter(ZIP_LOCAL_HEADER_BYTES + name.length);
    header.u32(ZIP_LOCAL_SIGNATURE);
    header.u16(ZIP_VERSION);
    this.common(header, size, crc);
    header.u16(name.length);
    header.u16(0); // extra field length
    header.bytes(name);
    const after = this.offset + header.length + size;
    if (after > ZIP_MAX_32) throw new RangeError('zip: the archive would pass 4 GiB');
    this.entries.push({ name, crc, size, offset: this.offset });
    this.offset = after;
    return header.done();
  }

  /** The central directory and its end record: the archive's last bytes. */
  finish(): Uint8Array {
    const names = this.entries.reduce((sum, e) => sum + e.name.length, 0);
    const directorySize = this.entries.length * ZIP_CENTRAL_HEADER_BYTES + names;
    if (this.offset + directorySize + ZIP_END_BYTES > ZIP_MAX_32) {
      throw new RangeError('zip: the archive would pass 4 GiB');
    }
    const out = new FieldWriter(directorySize + ZIP_END_BYTES);
    for (const entry of this.entries) {
      out.u32(ZIP_CENTRAL_SIGNATURE);
      out.u16(ZIP_VERSION); // made by
      out.u16(ZIP_VERSION); // needed to extract
      this.common(out, entry.size, entry.crc);
      out.u16(entry.name.length);
      out.u16(0); // extra field length
      out.u16(0); // comment length
      out.u16(0); // disk number start
      out.u16(0); // internal attributes
      out.u32(0); // external attributes
      out.u32(entry.offset);
      out.bytes(entry.name);
    }
    out.u32(ZIP_END_SIGNATURE);
    out.u16(0); // this disk
    out.u16(0); // the directory's disk
    out.u16(this.entries.length);
    out.u16(this.entries.length);
    out.u32(directorySize);
    out.u32(this.offset);
    out.u16(0); // comment length
    return out.done();
  }

  /** Flags through the uncompressed size: the run both headers share. */
  private common(out: FieldWriter, size: number, crc: number): void {
    out.u16(ZIP_FLAG_UTF8);
    out.u16(ZIP_METHOD_STORED);
    out.u16(this.time);
    out.u16(this.date);
    out.u32(crc);
    out.u32(size); // compressed: stored, so the same
    out.u32(size);
  }
}

/** Little-endian fields written in order into a buffer of known length. */
class FieldWriter {
  private readonly buffer: Uint8Array;
  private readonly view: DataView;
  private at = 0;

  constructor(readonly length: number) {
    this.buffer = new Uint8Array(length);
    this.view = new DataView(this.buffer.buffer);
  }

  u16(value: number): void {
    this.view.setUint16(this.at, value, true);
    this.at += Uint16Array.BYTES_PER_ELEMENT;
  }

  u32(value: number): void {
    this.view.setUint32(this.at, value, true);
    this.at += Uint32Array.BYTES_PER_ELEMENT;
  }

  bytes(value: Uint8Array): void {
    this.buffer.set(value, this.at);
    this.at += value.length;
  }

  done(): Uint8Array {
    if (this.at !== this.length) throw new Error('zip: a record was not filled');
    return this.buffer;
  }
}
