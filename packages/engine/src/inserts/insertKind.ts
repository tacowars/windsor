/**
 * What an insert kind is (#641): the contract every entry in
 * `insertRegistry.ts` meets. A kind is code-owned — its fields, their ranges,
 * its node graph — and a song names which kinds it uses and how they are set.
 */
import type { FieldNormaliser } from '../arrangementFields';
import type { StripStage } from '../channelStrip';

/** A live insert: a strip stage that can take its kind's settings without re-wiring. */
export interface InsertStage<S extends { readonly kind: string }> extends StripStage {
  readonly kind: S['kind'];
  /** Present only for a worklet effect; owned and stopped by the stage. */
  readonly processor?: AudioWorkletNode;
  readonly reduction?: { read(): number; setActive(enabled: boolean): void };
  /** Mixer-owned external detector routing, separate from program audio. */
  readonly detector?: { readonly input: AudioNode; setExternal(external: boolean): void };
  /** Param writes only; the caller has normalised `spec`. */
  set(spec: S): void;
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
