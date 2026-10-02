/**
 * The message contract between the main thread and `worklet/fm/` (the FM worklet).
 *
 * `frame` is an absolute frame index on the `AudioContext` timeline, which is
 * what makes scheduling sample-accurate: the worklet compares it against its own
 * `currentFrame` and splits the render block at the boundary. Convert a context
 * time to a frame with `frameForTime()`.
 */
import type { Patch } from '../patch/patch';

export interface NoteOnMessage {
  type: 'noteOn';
  /** Handle, unique per part; `noteOff` releases by the same value. */
  id: number;
  note: number;
  velocity: number;
  frame: number;
  /**
   * Per-note mod (#602): added to the `modWheel` param wherever a voice reads
   * it, so an accent reaches `lfo.modWheelDepth` and `filter.modWheelDepth`
   * without touching the part-wide wheel or the previous note's tail.
   */
  mod?: number;
  /**
   * A legato slide (#602): in mono mode with a voice sounding, that voice is
   * retargeted to `note` — envelopes untouched — and rebound to this `id`.
   * Otherwise an ordinary note-on.
   */
  slide?: boolean;
  /**
   * A sequencer step's parameter offsets (windsor#17): one lane value in
   * -1..1 per `VOICE_TARGET_TABLE` row, in code order, 0 for the patch's own
   * setting. The voice copies them into its preallocated slots at note-on
   * and holds them for the note's life; a slide takes them too, but for the
   * rows marked `slideKeeps`. Absent means every offset is 0.
   */
  stepMod?: readonly number[];
}

export interface NoteOffMessage {
  type: 'noteOff';
  id: number;
  frame: number;
}

/** A note event: what the processor's event queue holds, at its frame. */
export type NoteMessage = NoteOnMessage | NoteOffMessage;

/**
 * Which voice target each of the part's automation slots moves (windsor#346,
 * record `2026-10-01-song-automation-lanes` decision 16): one entry per slot
 * parameter (`voiceSlot0` …), a patch path (`ops.2.width`) or null for a free
 * slot. The processor reads it on arrival and offsets each mapped target by
 * its slot's value from then on.
 *
 * It travels with the notes (`ScheduledMessage`), because an offline render
 * must hand it to the processor at construction as it does the opening's
 * notes (`AudioPart.holdNotes`): `FmEngine.createPart` lifts it out of the
 * events into `ProcessorOptions.voiceSlots`.
 */
export interface VoiceSlotsMessage {
  type: 'voiceSlots';
  slots: (string | null)[];
}

/**
 * What a part posts in order, or holds back while it holds its notes: the
 * notes, and its slot map.
 */
export type ScheduledMessage = NoteMessage | VoiceSlotsMessage;

export interface PatchMessage {
  type: 'patch';
  patch: Patch;
}

export interface ControlMessage {
  type: 'allNotesOff' | 'panic' | 'stop';
}

/**
 * Whether a `patch` message also re-points the voices already sounding. Off by
 * default: a song swaps presets rarely, and a ringing voice keeping its old
 * patch is what stops the swap clicking. The arrangement console turns it on
 * so a knob is heard while it is being turned, not on the next note.
 */
export interface LiveRetuneMessage {
  type: 'liveRetune';
  enabled: boolean;
}

/**
 * Turn the audio-load sampler on in a processor (#445). Sent once, after the
 * node is built; a processor that never receives it never times anything and
 * never posts, which is how offline renders (`offlineRender.ts`) and the Node
 * harness stay silent instruments.
 *
 * `quanta` is how many render quanta one report covers — the main thread's
 * `AUDIO_LOAD_REPORT_SECONDS` converted with the live sample rate, because the
 * processor has no wall clock with which to measure a second.
 */
export interface ReportLoadMessage {
  type: 'reportLoad';
  quanta: number;
}

export type WorkletMessage =
  ScheduledMessage | PatchMessage | ControlMessage | LiveRetuneMessage | ReportLoadMessage;

/**
 * One processor's audio-thread cost over the interval just ended (#445) — the
 * only message that travels worklet → main, and the reason this union exists
 * beside `WorkletMessage`, which is main → worklet by construction.
 *
 * ## Why counters and not a duration
 *
 * Neither measurement the platform would ideally give us exists in Chrome 152
 * (probed 2026-09-11, `docs/research/2026-09-11-445-audio-bench-arm/`):
 * `AudioContext.renderCapacity` is absent, flagged builds included, and
 * `AudioWorkletGlobalScope` exposes no `performance.now()`. The only clock the
 * scope has is `Date.now()`, at one-millisecond resolution against a 2.9 ms
 * quantum budget — so the processor does not time a call, it **samples a duty
 * cycle**: `busyMs` counts the integer-millisecond boundaries that fell inside
 * a `process()` call, which over an interval estimates the wall time the audio
 * thread spent inside that processor. `audioLoad.ts` turns these into
 * percentages and states what they are worth.
 *
 * Every field is an integer accumulated in the processor's own fields; the
 * post happens once per interval, never per quantum, and `process()` still
 * allocates nothing.
 */
export interface LoadReportMessage {
  type: 'load';
  /** Millisecond boundaries that fell inside `process()` during the interval. */
  busyMs: number;
  /** Wall milliseconds the interval spanned, `Date.now()` end to end. */
  wallMs: number;
  /** Render quanta in the interval. */
  quanta: number;
  /** Worst single quantum's measured span, ms — 1 ms resolution, so a lower bound. */
  peakMs: number;
  /**
   * Cumulative since the processor started: quanta whose measured span reached
   * the whole quantum budget, i.e. that provably could not have met their
   * render deadline. Cumulative rather than per-interval so a dropped post
   * never loses one.
   */
  underruns: number;
}

/** Everything a processor may post back. One member today; a union so the next lands here. */
export type ProcessorMessage = LoadReportMessage;

/** Options handed to the processor at construction. */
export interface ProcessorOptions {
  maxVoices: number;
  patch: Patch;
  /**
   * Notes present before the first render block. Offline renders must use this
   * rather than `postMessage`, which is asynchronous and loses the race against
   * `OfflineAudioContext.startRendering()`.
   */
  events?: NoteMessage[];
  /**
   * The automation slots' map from the first block (windsor#346,
   * `VoiceSlotsMessage`), for the same reason: an offline render's voice
   * lanes play from its first sample. Absent, every slot is free.
   */
  voiceSlots?: (string | null)[];
  /**
   * Pins the processor's one random source — free-running operator phase, the
   * per-voice noise seed and `panRandom` jitter — so a render is reproducible.
   * Omitted in live playback, which gets `Math.random`: a part whose every note
   * started from the same phase would sound mechanical. The DSP tests (#78)
   * supply it; an offline bake that wants byte-identical output may too.
   */
  seed?: number;
  /**
   * Seconds a slid note glides when the patch's `glide` is 0 (#602). The
   * engine passes `SLIDE_SECONDS_DEFAULT`; absent, a slide is instant.
   */
  slideSeconds?: number;
}

/** The `AudioContext` timeline is frames at the sample rate, so this is exact. */
export function frameForTime(context: BaseAudioContext, time: number): number {
  return Math.max(0, Math.round(time * context.sampleRate));
}

/** Where the DSP lives: the bundle `scripts/build-worklets.mjs` writes from `worklet/fm/`. No imports in it, so Vite emits it as an asset. */
export const WORKLET_URL = new URL('../worklet/generated/fm-processor.js', import.meta.url);

export const PROCESSOR_NAME = 'fm-part';

export const RETRO_REVERB_WORKLET_URL = new URL(
  '../worklet/generated/retro-reverb-processor.js',
  import.meta.url,
);

/** The reverb DSP, a separate module so a part can load without it: the bundle `scripts/build-worklets.mjs` writes from `worklet/reverb/` (#671). */
export const REVERB_WORKLET_URL = new URL(
  '../worklet/generated/reverb-processor.js',
  import.meta.url,
);

export const REVERB_PROCESSOR_NAME = 'dattorro-reverb';

/** Stereo insert processor, loaded before synchronous insert creation. */
export const COMPRESSOR_WORKLET_URL = new URL(
  '../worklet/generated/compressor-processor.js',
  import.meta.url,
);

/** The channel strips' sample-peak meter (#666, windsor#155). */
export const PEAK_METER_WORKLET_URL = new URL(
  '../worklet/generated/peak-meter-processor.js',
  import.meta.url,
);

export const DELAY_WORKLET_URL = new URL(
  '../worklet/generated/delay-processor.js',
  import.meta.url,
);
export const PHASER_WORKLET_URL = new URL(
  '../worklet/generated/phaser-processor.js',
  import.meta.url,
);

export const ADVANCED_DRIVE_WORKLET_URL = new URL(
  '../worklet/generated/advanced-drive-processor.js',
  import.meta.url,
);

export const TAPE_WORKLET_URL = new URL('../worklet/generated/tape-processor.js', import.meta.url);

/** The Parametric EQ (windsor#198). */
export const EQ_WORKLET_URL = new URL('../worklet/generated/eq-processor.js', import.meta.url);
