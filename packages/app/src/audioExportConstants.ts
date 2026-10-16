/**
 * Export Audio's tunables (windsor#40). The formats and the tail's range are
 * the engine's (`RENDER_SAMPLE_RATES`, `WAV_BIT_DEPTHS`, `RENDER_TAIL_SECONDS`);
 * what is here is the console's own.
 */
import type { WavBitDepth } from '@windsor/engine';

/** The bit-depth control's labels (windsor#822 decision 5): 32 is IEEE float. */
export const BIT_DEPTH_LABELS: Readonly<Record<WavBitDepth, string>> = {
  16: '16-bit',
  24: '24-bit',
  32: '32-bit float',
};

/**
 * How a Download refused only by the in-memory cap ends (windsor#822
 * decision 3): it names Save as…, which streams the WAV and takes the song.
 */
export const DOWNLOAD_LENGTH_REMEDY =
  'a download holds the whole file in memory; Save as… writes the WAV to the file as it ' +
  'encodes and can export it';

/**
 * The save picker's `id`: the browser remembers the last directory per id,
 * so renders reopen where the last one went, apart from any other picker.
 */
export const WAV_SAVE_PICKER_ID = 'windsor-audio-export';

/** A song has no name field of its own; this stands in when the export name is empty. */
export const WAV_FALLBACK_NAME = 'song';
export const WAV_EXTENSION = '.wav';
export const WAV_MIME = 'audio/wav';

/** The stems' archive (windsor#41): `<song>-stems.zip`, stored, not compressed. */
export const ZIP_EXTENSION = '.zip';
export const ZIP_MIME = 'application/zip';
export const STEMS_ZIP_SUFFIX = '-stems';
/** A part's stem is numbered by its slot + 1, to two digits: `<song>-01-<part>.wav`. */
export const STEM_NUMBER_DIGITS = 2;
/** A send bus's stem: `<song>-send-<name>.wav` (windsor#172: `-send-a`, `-send-b`). */
export const STEM_RETURN_WORD = 'send';
/** A group bus's stem: `<song>-group-<position>-<name>.wav`, position from 1 (windsor#286). */
export const STEM_GROUP_WORD = 'group';

/** Characters no file system on the three desktop platforms accepts in a name. */
export const FILE_NAME_FORBIDDEN = /[\\/:*?"<>|]+/g;

/** The Tail knob's step, seconds. */
export const TAIL_KNOB_STEP = 0.5;

/** How long a download's object URL outlives the click, ms. */
export const WAV_URL_TTL_MS = 60_000;

/** A Save as write goes in chunks of this many bytes, so a Cancel lands between them. */
export const WAV_WRITE_CHUNK_BYTES = 1 << 20;

/** The sample-rate choices read in kHz. */
export const HZ_PER_KHZ = 1000;

/** Progress shown as a whole percentage. */
export const PERCENT = 100;
