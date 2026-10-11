/**
 * What an insert kind is (#641): the contract every entry in
 * `insertRegistry.ts` meets. A kind is code-owned — its fields, their ranges,
 * its node graph — and a song names which kinds it uses and how they are set.
 */
import type { AutomationHandle } from '../automation/automationHandles';
import type { FieldNormaliser } from '../song/arrangementFields';
import type { StripStage } from '../mixer/channelStrip';
import type { Harmony } from '../harmony/harmonyTimeline';

/**
 * A host's wet path (record `2026-10-11-wet-path-slot`): where its slot's
 * child insert is wired in, on the wet layer before the host's Mix. A host
 * kind is one whose `fields` include `slot`; only a host's stage has one.
 */
export interface WetPath {
  /** Where the wet layer leaves, before the host's Mix: a node and its output index. */
  readonly send: { readonly node: AudioNode; readonly output: number };
  /** Where the child's output re-enters: from here on it takes the host's Mix and switch. */
  readonly ret: AudioNode;
  /**
   * Cross the host's own internal wet edge out (true) or back in (false) over
   * INSERT_FADE_SECONDS from now. The slot module fades the child's gain itself;
   * route never touches it. route(false) on a fresh stage is today's graph.
   */
  route(on: boolean): void;
}

/** A live insert: a strip stage that can take its kind's settings without re-wiring. */
export interface InsertStage<S extends { readonly kind: string }> extends StripStage {
  readonly kind: S['kind'];
  /** A host kind's wet path (`WetPath`); absent on every other kind. */
  readonly wetPath?: WetPath;
  /** Present only for a worklet effect; owned and stopped by the stage. */
  readonly processor?: AudioWorkletNode;
  readonly reduction?: { read(): number; setActive(enabled: boolean): void };
  /**
   * The stage's output spectrum (windsor#200, the EQ): `read` fills `into`
   * (half the analyser's FFT size) with each bin's level in dBFS. An analyser
   * on a tap after the output, outside the program path, connected only
   * while active; inactive, `read` fills −Infinity.
   */
  readonly spectrum?: {
    read(into: Float32Array<ArrayBuffer>): void;
    setActive(active: boolean): void;
  };
  /** Mixer-owned external detector routing, separate from program audio. */
  readonly detector?: { readonly input: AudioNode; setExternal(external: boolean): void };
  /**
   * Param writes only; the caller has normalised `spec`. A field a lane holds
   * (`param`, windsor#345) is recorded, and its params are left to the lane.
   */
  set(spec: S): void;
  /** Optional song tempo input; the registry initializes it and forwards live changes. */
  setTempo?(bpm: number): void;
  /**
   * Optional song key input (windsor#717): the harmony's root (pitch class)
   * and scale. `harmonyInsertRegistry` hands a new stage the current key and
   * forwards a change of root or scale.
   */
  setHarmony?(root: number, scale: Harmony['scale']): void;
  /**
   * Optional song chord input (windsor#729): the pitch set of the chord the
   * harmony track is on, from `time` on the audio clock; `hold` cancels what
   * was scheduled from `time` first. `harmonyInsertRegistry` forwards what
   * `bloomChordFollower.ts` schedules to every live stage.
   */
  setChord?(mask: number, time: number, hold: boolean): void;
  /**
   * A song lane's handle on `field` (windsor#345, record
   * `2026-10-01-song-automation-lanes` decision 1): the param or params `set`
   * writes for it, with `set`'s mapping at each breakpoint. While engaged it
   * holds them and `set` leaves them alone; its release restores the spec's
   * value. Undefined for a field the stage writes no param for.
   */
  param?(field: string): AutomationHandle | undefined;
  /**
   * Play only band `band` of the stage (windsor#200, the EQ's Listen on
   * drag), or everything again at −1. Live only: never in the spec or the song.
   */
  listen?(band: number): void;
}

export interface InsertKind<S extends { readonly kind: string }> {
  /** Every key a spec of this kind may carry, `kind` included. */
  readonly fields: readonly string[];
  /** A fresh insert of this kind: what the console adds. */
  readonly defaults: S;
  /** `raw` over the kind's defaults: every number clamped, unknown keys reported. */
  normalise(raw: Record<string, unknown>, path: string, n: FieldNormaliser): S;
  create(context: BaseAudioContext, spec: S): InsertStage<S>;
}
