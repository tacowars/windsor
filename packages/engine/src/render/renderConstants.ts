/**
 * The song render's and the WAV writer's tunables (windsor#40). The console's
 * Export Audio controls read their choices and defaults from here, so the
 * engine decides what a render can be.
 */

/** The sample rates a song renders at (issue decision 1). */
export const RENDER_SAMPLE_RATES = [44100, 48000] as const;
export type RenderSampleRate = (typeof RENDER_SAMPLE_RATES)[number];
export const RENDER_SAMPLE_RATE_DEFAULT: RenderSampleRate = 48000;

/** The PCM word lengths the writer produces (issue decision 1). */
export const WAV_BIT_DEPTHS = [16, 24] as const;
export type WavBitDepth = (typeof WAV_BIT_DEPTHS)[number];
export const WAV_BIT_DEPTH_DEFAULT: WavBitDepth = 24;

/** Seconds rendered after the song's last bar so releases and returns ring out (decision 3). */
export const RENDER_TAIL_SECONDS = { min: 0, max: 10, default: 2 } as const;

/** A render is stereo, like the live master. */
export const RENDER_CHANNELS = 2;

/**
 * How far apart the render stops to feed the scheduler, in seconds of song.
 * Each stop issues the ticks up to `RENDER_LOOK_AHEAD_SECONDS` ahead, which
 * must reach past the next stop so no tick is ever issued late.
 */
export const RENDER_STEP_SECONDS = 0.25;
export const RENDER_LOOK_AHEAD_SECONDS = 0.5;

/**
 * The seed every render pins the FM processors to, hashed with each part's
 * slot (decision 7). A render is reproducible without the caller choosing one.
 */
export const RENDER_SEED_DEFAULT = 0x57_a1_d5_0e;

/** Web Audio's render quantum: the grid `OfflineAudioContext.suspend` times land on. */
export const RENDER_QUANTUM_FRAMES = 128;

/** The canonical 44-byte RIFF/WAVE PCM header's fields. */
export const WAV_HEADER_BYTES = 44;
export const WAV_FMT_CHUNK_BYTES = 16;
export const WAV_FORMAT_PCM = 1;
/** RIFF's size field counts everything after itself: the header less "RIFF" and the size. */
export const WAV_RIFF_SIZE_OFFSET = 8;
export const BITS_PER_BYTE = 8;
export const BYTE_MASK = 0xff;
/** The one word length that is dithered (decision 6). */
export const WAV_DITHERED_BIT_DEPTH: WavBitDepth = 16;

/** The PRNG seed for the 16-bit TPDF dither, so an encode is reproducible. */
export const WAV_DITHER_SEED = 0x0d_17_4e_12;
