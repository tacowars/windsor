/**
 * The song render's and the WAV writer's tunables (windsor#40). The console's
 * Export Audio controls read their choices and defaults from here, so the
 * engine decides what a render can be.
 */

/** The sample rates a song renders at (issue decision 1). */
export const RENDER_SAMPLE_RATES = [44100, 48000] as const;
export type RenderSampleRate = (typeof RENDER_SAMPLE_RATES)[number];
export const RENDER_SAMPLE_RATE_DEFAULT: RenderSampleRate = 48000;

/**
 * The word lengths the writer produces (issue decision 1): 16- and 24-bit
 * PCM, and 32-bit IEEE float (windsor#822 decision 4).
 */
export const WAV_BIT_DEPTHS = [16, 24, 32] as const;
export type WavBitDepth = (typeof WAV_BIT_DEPTHS)[number];
export const WAV_BIT_DEPTH_DEFAULT: WavBitDepth = 24;
/** The one depth written as IEEE float: samples as they are, no dither and no clip. */
export const WAV_FLOAT_BIT_DEPTH: WavBitDepth = 32;

/** Seconds rendered after the song's last bar so releases and returns ring out (decision 3). */
export const RENDER_TAIL_SECONDS = { min: 0, max: 10, default: 2 } as const;

/**
 * The longest render an in-memory export takes, in frames: 15 minutes at
 * 48 kHz. Download and stems hold the whole song as 32-bit float stereo in
 * the offline context (about 346 MB at this limit) and then the encoded file
 * (about 259 MB at 24-bit, 346 MB at 32-bit float), so a longer one risks
 * the tab. 256 bars at 20 BPM (51 minutes) is refused.
 */
export const RENDER_MAX_FRAMES = 48000 * 60 * 15;

/**
 * The longest render the streamed Save as export takes, in frames: 77
 * minutes at 48 kHz (windsor#822 decision 3). It holds only the float render
 * (about 1.77 GB at this limit) and writes the WAV to the file as it encodes.
 * The longest song the format holds, 256 bars (`BARS_MAX`) of 12/8 at 20 BPM
 * (`BPM_MIN`), runs 76.8 minutes by `songSeconds`; with the 10 s tail, the
 * lead-in and the output stage's latency it fits, which `renderSong.test.ts`
 * pins. The 32-bit float file at this length is about 1.77 GB, under a WAV's
 * 4 GiB.
 */
export const RENDER_STREAM_MAX_FRAMES = 48000 * 60 * 77;

/** A render is stereo, like the live master. */
export const RENDER_CHANNELS = 2;

/**
 * The widest stem pass (windsor#41 decision 2): 32 channels, the most an
 * `OfflineAudioContext` is required to support. Channels 0–1 of every pass
 * are the master, so one pass carries up to 15 stereo stems.
 */
export const RENDER_STEM_CHANNELS_MAX = 32;

/**
 * The float samples (frames × channels) one stem pass may hold: twice what
 * the longest song render holds (about 691 MB). A long song with many stems
 * renders in narrower passes instead of one context too large for the tab.
 * A render of more than one pass also holds a copy of the first pass's
 * master for the lineup check: two channels of the song, at most what one
 * song render holds (about 346 MB).
 */
export const RENDER_STEM_PASS_MAX_SAMPLES = 2 * RENDER_MAX_FRAMES * RENDER_CHANNELS;

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
/**
 * The float header (windsor#822 decision 4): `WAVE_FORMAT_IEEE_FLOAT`, an
 * 18-byte `fmt ` chunk whose `cbSize` is 0, and a `fact` chunk holding the
 * frame count before `data`. 12 (RIFF, size, WAVE) + 8 + 18 (fmt) + 8 + 4
 * (fact) + 8 (data's tag and size) = 58 bytes.
 */
export const WAV_FLOAT_HEADER_BYTES = 58;
export const WAV_FLOAT_FMT_CHUNK_BYTES = 18;
export const WAV_FORMAT_IEEE_FLOAT = 3;
export const WAV_FMT_EXTENSION_BYTES = 0;
export const WAV_FACT_CHUNK_BYTES = 4;
/** The largest value RIFF's 32-bit size field holds: a WAV past 4 GiB cannot be described. */
export const WAV_RIFF_SIZE_MAX = 0xff_ff_ff_ff;
/** RIFF's size field counts everything after itself: the header less "RIFF" and the size. */
export const WAV_RIFF_SIZE_OFFSET = 8;
export const BITS_PER_BYTE = 8;
export const BYTE_MASK = 0xff;
/** The one word length that is dithered (decision 6). */
export const WAV_DITHERED_BIT_DEPTH: WavBitDepth = 16;

/** The PRNG seed for the 16-bit TPDF dither, so an encode is reproducible. */
export const WAV_DITHER_SEED = 0x0d_17_4e_12;

/**
 * Frames the async WAV encoder writes between yields to the event loop
 * (windsor#51), and the streamed encoder per write (windsor#822): 65 536
 * frames, about 1.49 s of song at 44.1 kHz and 1.37 s at 48 kHz, a 512 KiB
 * chunk at 32-bit float stereo. The signal is checked once per chunk, so a
 * smaller chunk hears a Cancel after less encoding, at the cost of more
 * yields or writes.
 */
export const WAV_ENCODE_CHUNK_FRAMES = 1 << 16;

/**
 * How far a later stem pass's master may stray from the first's at any one
 * frame before the passes count as not lined up (`stemLineup.ts`): 1e-5,
 * about −100 dBFS. That is ten times the largest difference measured between
 * two renders of one song in headless Chrome 153 on an Apple M1 (1.0e-6,
 * float rounding in the master's sum; docs/research/2026-09-29-stem-render-accuracy),
 * so run-to-run rounding passes with margin.
 */
export const RENDER_STEM_LINEUP_TOLERANCE = 1e-5;

/**
 * Frames the stem lineup check compares between yields to the event loop
 * (`stemLineup.ts`): 65 536 frames, about 1.49 s of song at 44.1 kHz and
 * 1.37 s at 48 kHz, both channels. The signal is checked once per chunk, as
 * the WAV encoder's `WAV_ENCODE_CHUNK_FRAMES`.
 */
export const RENDER_STEM_LINEUP_CHUNK_FRAMES = 1 << 16;
