/**
 * What an insert kind is (#641): the contract every entry in
 * `insertRegistry.ts` meets. A kind is code-owned — its fields, their ranges,
 * its node graph — and a song names which kinds it uses and how they are set.
 */
import type { FieldNormaliser } from '../song/arrangementFields';
import type { StripStage } from '../mixer/channelStrip';

/** A live insert: a strip stage that can take its kind's settings without re-wiring. */
export interface InsertStage<S extends { readonly kind: string }> extends StripStage {
  readonly kind: S['kind'];
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
  /** Param writes only; the caller has normalised `spec`. */
  set(spec: S): void;
  /** Optional song tempo input; the registry initializes it and forwards live changes. */
  setTempo?(bpm: number): void;
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
