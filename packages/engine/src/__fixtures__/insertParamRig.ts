/**
 * The insert lanes' rig (windsor#345): a stand-in `AudioWorkletNode` for every
 * worklet insert kind that holds a `FakeParam` per parameter (made on first
 * `get`, the way the real node lists its descriptors) and renders silence,
 * and a walk over every param a fake graph built, so a test can compare two
 * stages param by param. Node-only, like the rest of this directory.
 */
import { OUTPUT_STAGE_NAME } from '../mixer/outputStageConstants';
import { PEAK_METER_NAME } from '../mixer/peakMeterConstants';
import { PROCESSOR_NAME, REVERB_PROCESSOR_NAME } from '../synth/workletMessages';
import { BLOCK, FakeNode, FakeParam } from './fakeAudioNodes';
import type { FakeContext } from './fakeAudioContext';
import { FakeWorkletNode } from './fakeAudioContext';

/** A parameter map that makes each param on first `get`, at 0. */
class ParamMap extends Map<string, FakeParam> {
  override get(name: string): FakeParam {
    let param = super.get(name);
    if (!param) {
      param = new FakeParam(0);
      this.set(name, param);
    }
    return param;
  }
}

/** A worklet insert's node: its params, a port that takes messages, silence out. */
export class ParamWorkletNode extends FakeNode {
  readonly kind = 'worklet';
  readonly parameters = new ParamMap();
  readonly posted: unknown[] = [];
  readonly port = Object.assign(new EventTarget(), {
    postMessage: (data: unknown): void => {
      this.posted.push(data);
    },
    start(): void {},
    close(): void {},
    onmessage: null,
  });

  constructor(
    context: FakeContext,
    readonly name: string,
    options: AudioWorkletNodeOptions = {},
  ) {
    super(context, options.numberOfInputs ?? 1, options.numberOfOutputs ?? 1);
    for (const [key, value] of Object.entries(options.parameterData ?? {})) {
      this.parameters.set(key, new FakeParam(value));
    }
  }

  protected render(): Float32Array[][] {
    return [[new Float32Array(BLOCK), new Float32Array(BLOCK)]];
  }
}

/** The engine's own worklets, which the context's fake models: what a whole system needs. */
export const ENGINE_WORKLETS: ReadonlySet<string> = new Set([
  PROCESSOR_NAME,
  REVERB_PROCESSOR_NAME,
  OUTPUT_STAGE_NAME,
  PEAK_METER_NAME,
]);

/**
 * Point the global `AudioWorkletNode` at `ParamWorkletNode`, except for the
 * names in `modelled` and the part's `fm-part` node, which stay the
 * context's fake. Returns the undo.
 */
export function installParamWorklet(modelled: ReadonlySet<string> = new Set()): () => void {
  const previous = globalThis.AudioWorkletNode;
  globalThis.AudioWorkletNode = function (
    context: FakeContext,
    name: string,
    options: AudioWorkletNodeOptions,
  ) {
    return name === PROCESSOR_NAME || modelled.has(name)
      ? new FakeWorkletNode(context, name, options)
      : new ParamWorkletNode(context, name, options);
  } as unknown as typeof AudioWorkletNode;
  return (): void => {
    globalThis.AudioWorkletNode = previous;
  };
}

/** One param of a fake graph, named by its node's place in the context and its key. */
export interface NamedParam {
  readonly name: string;
  readonly param: FakeParam;
}

/** Every param of every node `context` built, in build order, a worklet's by name. */
export function graphParams(context: FakeContext): NamedParam[] {
  const out: NamedParam[] = [];
  context.nodes.forEach((node, i) => {
    const prefix = `${i}:${node.constructor.name}`;
    for (const [key, value] of Object.entries(node)) {
      if (value instanceof FakeParam) out.push({ name: `${prefix}.${key}`, param: value });
    }
    const params = (node as { parameters?: unknown }).parameters;
    if (params instanceof Map) {
      for (const key of [...params.keys()].sort()) {
        out.push({ name: `${prefix}.${key}`, param: params.get(key) as FakeParam });
      }
    }
  });
  return out;
}
