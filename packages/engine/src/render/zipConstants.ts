/**
 * The ZIP format's fields for a stored (uncompressed) archive (windsor#41),
 * from PKWARE's APPNOTE.TXT, sections 4.3.7 (local file header), 4.3.12
 * (central directory header) and 4.3.16 (end of central directory record).
 */

export const ZIP_LOCAL_SIGNATURE = 0x04_03_4b_50;
export const ZIP_CENTRAL_SIGNATURE = 0x02_01_4b_50;
export const ZIP_END_SIGNATURE = 0x06_05_4b_50;

/** The fixed part of each record, in bytes, before its name. */
export const ZIP_LOCAL_HEADER_BYTES = 30;
export const ZIP_CENTRAL_HEADER_BYTES = 46;
export const ZIP_END_BYTES = 22;

/** 2.0: the version a reader needs for a stored entry with a UTF-8 name. */
export const ZIP_VERSION = 20;
/** General-purpose flag bit 11: the name is UTF-8. */
export const ZIP_FLAG_UTF8 = 0x08_00;
/** Compression method 0: stored. */
export const ZIP_METHOD_STORED = 0;

/** A 32-bit field's largest value; a bigger size or offset needs ZIP64, which this writer refuses. */
export const ZIP_MAX_32 = 0xff_ff_ff_ff;
/** A 16-bit field's largest value: the most entries, and the longest name. */
export const ZIP_MAX_16 = 0xff_ff;

/** MS-DOS dates count years from 1980; seconds are stored halved. */
export const DOS_EPOCH_YEAR = 1980;
export const DOS_YEAR_SHIFT = 9;
export const DOS_MONTH_SHIFT = 5;
export const DOS_HOUR_SHIFT = 11;
export const DOS_MINUTE_SHIFT = 5;
export const DOS_SECONDS_PER_UNIT = 2;

/** CRC-32 (IEEE 802.3), reflected: the polynomial and the register's all-ones start and end. */
export const CRC32_POLYNOMIAL = 0xed_b8_83_20;
export const CRC32_MASK = 0xff_ff_ff_ff;
export const CRC32_TABLE_SIZE = 256;
export const CRC32_BITS_PER_BYTE = 8;
export const CRC32_BYTE_MASK = 0xff;

/** Bytes the async CRC reads between yields to the event loop: 4 MiB. */
export const CRC32_CHUNK_BYTES = 1 << 22;
