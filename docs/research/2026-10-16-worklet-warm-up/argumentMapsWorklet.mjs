/* global AudioWorkletProcessor, registerProcessor */
/** The worklet `argumentMaps.mjs` bundles (windsor#837): on its fifth quantum it compares the
 * hidden classes (V8 maps) of what Chrome hands `process` with the scratch arguments the
 * shipped warm-up builds (`worklet/warmUp.ts`'s `scratchPorts` and `scratchParams`), and with
 * plain literals, and posts the answers. It needs Chrome started with
 * `--js-flags=--allow-natives-syntax`; the native is reached through `new Function`, so the
 * bundler never parses it.
 */
import { scratchParams, scratchPorts } from '../../../packages/engine/src/worklet/warmUp.ts';

const DESCRIPTORS = [
  { name: 'a', defaultValue: 0, automationRate: 'k-rate' },
  { name: 'b', defaultValue: 1, automationRate: 'k-rate' },
];
const sameMap = new Function('a', 'b', 'return %HaveSameMap(a, b);');

class Maps extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return DESCRIPTORS;
  }

  constructor() {
    super();
    this.quanta = 0;
  }

  process(inputs, outputs, params) {
    if (this.quanta++ !== 4) return true;
    // As the node is built: input 0 connected (2 channels), input 1 not; one stereo output.
    const ins = scratchPorts([2, 0]);
    const outs = scratchPorts([2]);
    const values = scratchParams(DESCRIPTORS);
    const literalPorts = [[new Float32Array(128), new Float32Array(128)], []];
    const literalParams = { a: new Float32Array(1), b: new Float32Array(1) };
    this.port.postMessage({
      frozen: { inputs: Object.isFrozen(inputs), outputs: Object.isFrozen(outputs), params: Object.isFrozen(params) },
      warmUp: {
        inputs: sameMap(inputs, ins),
        input0: sameMap(inputs[0], ins[0]),
        input1: sameMap(inputs[1], ins[1]),
        channel: sameMap(inputs[0][0], ins[0][0]),
        outputs: sameMap(outputs, outs),
        output0: sameMap(outputs[0], outs[0]),
        params: sameMap(params, values),
        param: sameMap(params.a, values.a),
      },
      literal: {
        inputs: sameMap(inputs, literalPorts),
        input0: sameMap(inputs[0], literalPorts[0]),
        params: sameMap(params, literalParams),
      },
    });
    return true;
  }
}

registerProcessor('argument-maps', Maps);
