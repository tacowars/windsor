/**
 * The Transient insert's flat param vocabulary (record
 * `2026-10-18-transient-insert` decision 2): the spec's four numbers and its
 * switch as k-rate params, shared by the insert, the processor's descriptors
 * and the harness. It imports only the constants, so the worklet's project
 * never reads the spec's normaliser and, through it, the rest of the engine.
 */
import { TRANSIENT_BOUNDS, TRANSIENT_DEFAULTS } from './transientConstants';

/** What the params are written from: a `TransientSpec`'s fields, stated here rather than imported. */
export interface TransientParamSource {
  readonly attack: number;
  readonly sustain: number;
  readonly output: number;
  readonly mix: number;
  readonly enabled: boolean;
}

export interface TransientParamDescriptor {
  readonly name: string;
  readonly minValue: number;
  readonly maxValue: number;
  readonly defaultValue: number;
}

/** Every param `set` writes, by name, for `spec`. */
export function transientParameters(spec: TransientParamSource): Record<string, number> {
  return {
    attack: spec.attack,
    sustain: spec.sustain,
    output: spec.output,
    mix: spec.mix,
    enabled: Number(spec.enabled),
  };
}

const range = (name: keyof typeof TRANSIENT_BOUNDS): TransientParamDescriptor => ({
  name,
  minValue: TRANSIENT_BOUNDS[name][0],
  maxValue: TRANSIENT_BOUNDS[name][1],
  defaultValue: TRANSIENT_DEFAULTS[name],
});

/** The processor's params, in slot order: the four smoothed controls, then the switch. */
export const TRANSIENT_PARAMS: readonly TransientParamDescriptor[] = [
  range('attack'),
  range('sustain'),
  range('output'),
  range('mix'),
  { name: 'enabled', minValue: 0, maxValue: 1, defaultValue: 1 },
];
