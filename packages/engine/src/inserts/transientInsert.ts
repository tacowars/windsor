/**
 * The Transient insert's graph (record `2026-10-18-transient-insert`): one
 * worklet node, stereo in and out, its five params written from the spec.
 * While its card is on screen the stage relays the processor's meter, each
 * frame window's largest boost and largest cut of the shaping's gain
 * (decision 9), and asks for none otherwise.
 */
import { ownParam, workletFieldParams } from './insertFieldHandles';
import type { InsertKind, InsertStage } from './insertKind';
import { TRANSIENT_BOUNDS, TRANSIENT_NAME } from './transientConstants';
import { transientParameters } from './transientParameters';
import { DEFAULT_TRANSIENT, TRANSIENT_FIELDS, normaliseTransient } from './transientSpec';
import type { TransientSpec } from './transientSpec';

/** What the card's meter reads of a live Transient: the last window's extremes, in dB. */
export interface TransientShapingReading {
  /** The largest boost, 0 or above. */
  readonly boost: number;
  /** The largest cut, 0 or below. */
  readonly cut: number;
}

export interface TransientShaping {
  read(): TransientShapingReading;
  setActive(active: boolean): void;
}

const AT_REST: TransientShapingReading = { boost: 0, cut: 0 };

function shapingOf(processor: AudioWorkletNode): { shaping: TransientShaping; release(): void } {
  let reading = AT_REST;
  let active = false;
  const receive = (event: MessageEvent): void => {
    const data = event.data as { type?: string; boost?: number; cut?: number };
    if (data.type !== 'shaping' || !Number.isFinite(data.boost) || !Number.isFinite(data.cut))
      return;
    reading = { boost: data.boost!, cut: data.cut! };
  };
  processor.port.addEventListener('message', receive);
  processor.port.start();
  const shaping: TransientShaping = {
    read: () => reading,
    setActive(next): void {
      if (next === active) return;
      active = next;
      if (!active) reading = AT_REST;
      processor.port.postMessage({ type: 'meter', enabled: active });
    },
  };
  return { shaping, release: () => processor.port.removeEventListener('message', receive) };
}

function create(context: BaseAudioContext, spec: TransientSpec): InsertStage<TransientSpec> {
  let current = spec;
  const processor = new AudioWorkletNode(context, TRANSIENT_NAME, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    channelCount: 2,
    channelCountMode: 'explicit',
    parameterData: transientParameters(spec),
  });
  const input = context.createGain();
  const output = context.createGain();
  input.connect(processor);
  processor.connect(output);
  const { shaping, release } = shapingOf(processor);
  const params = workletFieldParams(
    processor,
    (name) => transientParameters(current)[name]!,
    ownParam(TRANSIENT_BOUNDS),
  );
  return {
    kind: 'transient',
    input,
    output,
    processor,
    set(next): void {
      current = next;
      params.write(transientParameters(current));
    },
    param: (field) => params.param(field),
    shaping,
    dispose(): void {
      input.disconnect();
      processor.disconnect();
      processor.port.postMessage({ type: 'stop' });
      release();
      processor.port.close();
    },
  };
}

export const TRANSIENT_INSERT: InsertKind<TransientSpec> = {
  fields: TRANSIENT_FIELDS,
  defaults: DEFAULT_TRANSIENT,
  normalise: normaliseTransient,
  create,
};
