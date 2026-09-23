/**
 * Compressor insert graph and telemetry (#660). The second input is reserved
 * for mixer-owned detector routing; selecting it is explicit, never inferred
 * from silence. Makeup and dry/wet live inside the zero-lookahead processor.
 */
import { COMPRESSOR_NAME } from './compressorConstants';
import {
  COMPRESSOR_FIELDS,
  COMPRESSOR_NUMBERS,
  DEFAULT_COMPRESSOR,
  normaliseCompressor,
} from './compressorSpec';
import type { CompressorSpec } from './compressorSpec';
import type { InsertKind, InsertStage } from './insertKind';
export { DEFAULT_COMPRESSOR } from './compressorSpec';
export type { CompressorSpec } from './compressorSpec';

// eslint-disable-next-line max-lines-per-function -- 62 lines: one compressor graph and its parameter/telemetry lifetime (#225 decision 4)
function create(context: BaseAudioContext, spec: CompressorSpec): InsertStage<CompressorSpec> {
  const parameterData: Record<string, number> = {
    enabled: Number(spec.enabled),
    external: Number(spec.sidechain !== undefined && spec.sidechain !== 'internal'),
  };
  for (const name of COMPRESSOR_NUMBERS) parameterData[name] = spec[name];
  const processor = new AudioWorkletNode(context, COMPRESSOR_NAME, {
    numberOfInputs: 2,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    channelCount: 2,
    channelCountMode: 'explicit',
    parameterData,
  });
  const input = context.createGain();
  const detector = context.createGain();
  const output = context.createGain();
  input.connect(processor);
  detector.connect(processor, 0, 1);
  processor.connect(output);
  let reductionDb = 0;
  let active = false;
  const receive = (event: MessageEvent): void => {
    const data = event.data as { type?: string; db?: number };
    if (data.type === 'reduction' && Number.isFinite(data.db)) reductionDb = data.db!;
  };
  processor.port.addEventListener('message', receive);
  processor.port.start();
  return {
    kind: 'compressor',
    input,
    output,
    processor,
    set(next): void {
      for (const name of COMPRESSOR_NUMBERS) processor.parameters.get(name)!.value = next[name];
      processor.parameters.get('enabled')!.value = Number(next.enabled);
    },
    detector: {
      input: detector,
      setExternal(external): void {
        processor.parameters.get('external')!.value = Number(external);
      },
    },
    reduction: {
      read: () => reductionDb,
      setActive(enabled): void {
        if (enabled === active) return;
        active = enabled;
        if (!active) reductionDb = 0;
        processor.port.postMessage({ type: 'meter', enabled });
      },
    },
    dispose(): void {
      input.disconnect();
      detector.disconnect();
      processor.disconnect();
      processor.port.postMessage({ type: 'stop' });
      processor.port.removeEventListener('message', receive);
      processor.port.close();
    },
  };
}

export const COMPRESSOR_INSERT: InsertKind<CompressorSpec> = {
  fields: COMPRESSOR_FIELDS,
  defaults: DEFAULT_COMPRESSOR,
  normalise: normaliseCompressor,
  create,
};
