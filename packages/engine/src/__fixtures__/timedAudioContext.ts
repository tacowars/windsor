/**
 * A fake context whose automation plays out in time (windsor#629), for the
 * switch-fade tests: the base fake applies each automation call at once
 * (`fakeAudioNodes.ts`), which cannot show a 5 ms crossing. Here a gain reads
 * its param's timeline sample by sample, as an a-rate `GainNode` does, and a
 * worklet reads each param's timeline at its quantum's start, as k-rate
 * params are. A param no automation has reached keeps its plain value.
 * Node-only, like the rest of this directory.
 */
import { BLOCK, FakeGain } from './fakeAudioNodes';
import type { FakeParam } from './fakeAudioNodes';
import { FakeContext, FakeWorkletNode } from './fakeAudioContext';

const timed = (param: FakeParam): boolean => param.automation.length > 0;

class TimedGain extends FakeGain {
  protected override render(block: number): Float32Array[][] {
    if (!timed(this.gain)) return super.render(block);
    const channels = this.gather(block);
    for (let i = 0; i < BLOCK; i++) {
      const gain = this.gain.valueAt((block * BLOCK + i) / this.context.sampleRate);
      for (const channel of channels) channel[i] = (channel[i] ?? 0) * gain;
    }
    return [channels];
  }
}

class TimedWorkletNode extends FakeWorkletNode {
  protected override render(block: number): Float32Array[][] {
    const time = (block * BLOCK) / this.context.sampleRate;
    for (const param of this.parameters.values()) {
      if (timed(param)) param.value = param.valueAt(time);
    }
    return super.render(block);
  }
}

export class TimedContext extends FakeContext {
  override createGain(): FakeGain {
    return new TimedGain(this);
  }
}

/** Point the global `AudioWorkletNode` at the timed fake. Returns the undo. */
export function installTimedAudioWorklet(): () => void {
  const scope = globalThis as { AudioWorkletNode?: unknown };
  const previous = scope.AudioWorkletNode;
  scope.AudioWorkletNode = TimedWorkletNode;
  return () => {
    scope.AudioWorkletNode = previous;
  };
}
