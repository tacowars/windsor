/**
 * bloom's worklet adapter: its k-rate descriptors, the DSP's construction
 * from `parameterData`, the block loop, `stop` and the load telemetry. The
 * signal path is `bloomDsp.ts`. Output 0 is bloom's output (the dry share
 * alone while the slot's split is 1); when the node has them, output 1 is the
 * layer after Amount (stereo) and output 2 the gain the child's return takes
 * (mono), written every frame, zeros included (`BLOOM_SLOT`). `split` is the
 * one a-rate param: read sample by sample when it is moving (128 values), the
 * one value otherwise, and 0 for a caller that lacks it. Loading the module
 * builds the wavetables for the context's rate (`bloomTables.ts`).
 */
import { BLOOM_NAME, BLOOM_SLOT } from '../../inserts/bloomConstants';
import type { ReportLoadMessage } from '../../synth/workletMessages';
import { LoadSampler } from '../loadSampler';
import { BloomDsp } from './bloomDsp';
import {
  BLOOM_SLOT_NAMES,
  bloomDescriptors,
  bloomSlotDescriptors,
  readBloomSlots,
} from './bloomSlots';
import type { BloomParams, BloomSlotName } from './bloomSlots';
import { bloomTables } from './bloomTables';

class BloomProcessor extends AudioWorkletProcessor {
  dsp: BloomDsp;
  slots: Float64Array;
  running: boolean;
  load: LoadSampler;
  /** `split` for a caller without the param: 0, the empty slot. */
  noSplit: Float32Array;

  static get parameterDescriptors(): AudioParamDescriptor[] {
    return bloomDescriptors();
  }

  constructor(options: AudioWorkletNodeOptions) {
    super();
    this.slots = new Float64Array(BLOOM_SLOT_NAMES.length);
    for (const descriptor of bloomSlotDescriptors()) {
      const at = BLOOM_SLOT_NAMES.indexOf(descriptor.name as BloomSlotName);
      this.slots[at] = Number(options.parameterData?.[descriptor.name] ?? descriptor.defaultValue);
    }
    this.dsp = new BloomDsp(sampleRate, this.slots);
    this.noSplit = new Float32Array(1);
    this.running = true;
    this.load = new LoadSampler(sampleRate, this.port);
    this.port.onmessage = ({ data }: MessageEvent<{ type: 'stop' } | ReportLoadMessage>) => {
      if (data.type === 'stop') this.running = false;
      if (data.type === 'reportLoad') this.load.start(data.quanta);
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][], params: BloomParams): boolean {
    if (!this.running) return false;
    this.load.begin();
    const out = outputs[0];
    if (!out?.[0]) return true;
    const left = inputs[0]?.[0];
    const right = inputs[0]?.[1] ?? left;
    const frames = out[0].length;
    // A bounded load stays a double; `left?.[i] ?? 0` would keep it tagged and box every sample.
    const leftFrames = left ? left.length : 0,
      rightFrames = right ? right.length : 0;
    // The slot's outputs, when the node was built with them.
    const sendLeft = outputs[1]?.[0],
      sendRight = outputs[1]?.[1],
      sendGain = outputs[2]?.[0];
    const splits: Float32Array = params[BLOOM_SLOT.splitParam] ?? this.noSplit;
    const splitStride = splits.length > 1 ? 1 : 0;
    const dsp = this.dsp;
    readBloomSlots(params, this.slots);
    dsp.configure(frames);
    for (let i = 0; i < frames; i++) {
      // Through fields, not arguments, which V8 boxes across a call it does not inline.
      dsp.inputLeft = i < leftFrames ? left![i] : 0;
      dsp.inputRight = i < rightFrames ? right![i] : 0;
      dsp.split = splits[i * splitStride];
      dsp.tick();
      out[0][i] = dsp.left;
      if (out[1]) out[1][i] = dsp.right;
      if (sendLeft) sendLeft[i] = dsp.sendLeft;
      if (sendRight) sendRight[i] = dsp.sendRight;
      if (sendGain) sendGain[i] = dsp.sendGain;
    }
    this.load.end(frames);
    return true;
  }
}

// The wavetables for this context's rate, built now (once, when the module loads) rather than when the
// first bloom is inserted, so inserting one never stalls the audio thread (~10 ms).
bloomTables(sampleRate);

registerProcessor(BLOOM_NAME, BloomProcessor);
