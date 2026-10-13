/**
 * The Pump insert's graph (record `2026-10-13-pump-insert`): one worklet
 * node with the program on input 0 and the mixer-owned detector on input 1,
 * as the compressor's. Settings and the song's tempo only write params; the
 * mixer's routing owns `external`. While its card is open the stage relays
 * the processor's scope: the key's level across the last cycle and where
 * the cycle is now.
 */
import { workletFieldParams } from './insertFieldHandles';
import type { InsertKind, InsertStage } from './insertKind';
import { PUMP_DSP, PUMP_NAME } from './pumpConstants';
import { pumpParamOf, pumpParameters, pumpTiming } from './pumpParameters';
import { DEFAULT_PUMP, PUMP_FIELDS, normalisePump } from './pumpSpec';
import type { PumpSpec } from './pumpSpec';

/** What the card reads of a live Pump: the last cycle's key trace and the playhead. */
export interface PumpScopeReading {
  /** The key's peak level in each of `PUMP_DSP.scopeBins` bins of the last cycle, or null before one. */
  readonly trace: Float32Array | null;
  /** Bumped each time a new trace arrives. */
  readonly traces: number;
  /** Where the cycle is: 0 at a trigger, 1 at rest. */
  readonly phase: number;
  /** The gain applied now. */
  readonly gain: number;
}

export interface PumpScope {
  read(): PumpScopeReading;
  setActive(active: boolean): void;
}

type ScopeMessage =
  { type: 'trace'; levels: Float32Array } | { type: 'phase'; phase: number; gain: number };

function scopeOf(processor: AudioWorkletNode): { scope: PumpScope; release(): void } {
  let reading: PumpScopeReading = { trace: null, traces: 0, phase: 1, gain: 1 };
  let active = false;
  const receive = (event: MessageEvent): void => {
    const data = event.data as ScopeMessage;
    if (data.type === 'trace') {
      reading = { ...reading, trace: data.levels, traces: reading.traces + 1 };
    } else if (data.type === 'phase' && Number.isFinite(data.phase)) {
      reading = { ...reading, phase: data.phase, gain: data.gain };
    }
  };
  processor.port.addEventListener('message', receive);
  processor.port.start();
  const scope: PumpScope = {
    read: () => reading,
    setActive(next): void {
      if (next === active) return;
      active = next;
      if (!active) reading = { trace: null, traces: reading.traces, phase: 1, gain: 1 };
      processor.port.postMessage({ type: 'scope', enabled: active });
    },
  };
  return { scope, release: () => processor.port.removeEventListener('message', receive) };
}

function create(context: BaseAudioContext, spec: PumpSpec): InsertStage<PumpSpec> {
  let current = spec;
  let bpm: number = PUMP_DSP.defaultBpm;
  const processor = new AudioWorkletNode(context, PUMP_NAME, {
    numberOfInputs: 2,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    channelCount: 2,
    channelCountMode: 'explicit',
    parameterData: {
      ...pumpParameters(spec, bpm),
      external: Number(spec.sidechain !== undefined && spec.sidechain !== 'internal'),
    },
  });
  const input = context.createGain();
  const detector = context.createGain();
  const output = context.createGain();
  input.connect(processor);
  detector.connect(processor, 0, 1);
  processor.connect(output);
  const { scope, release } = scopeOf(processor);
  const params = workletFieldParams(
    processor,
    (name) => pumpParameters(current, bpm)[name]!,
    pumpParamOf,
  );
  return {
    kind: 'pump',
    input,
    output,
    processor,
    set(next): void {
      current = next;
      params.write(pumpParameters(current, bpm));
    },
    setTempo(next): void {
      bpm = next;
      params.write(pumpTiming(current, bpm));
    },
    param: (field) => params.param(field),
    detector: {
      input: detector,
      setExternal(external): void {
        processor.parameters.get('external')!.value = Number(external);
      },
    },
    pumpScope: scope,
    dispose(): void {
      input.disconnect();
      detector.disconnect();
      processor.disconnect();
      processor.port.postMessage({ type: 'stop' });
      release();
      processor.port.close();
    },
  };
}

export const PUMP_INSERT: InsertKind<PumpSpec> = {
  fields: PUMP_FIELDS,
  defaults: DEFAULT_PUMP,
  normalise: normalisePump,
  create,
};
