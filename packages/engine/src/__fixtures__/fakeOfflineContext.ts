/**
 * An `OfflineAudioContext` stand-in over the headless graph (windsor#40): the
 * `FakeContext` with `suspend(t)` / `resume()` / `startRendering()`, rendering
 * the destination block by block the way `renderGraph` does and pausing at
 * each suspend frame until `resume()` is called. `renderSong` drives it as it
 * drives a real one. Suspend times round up to the 128-frame block.
 *
 * `onNode` sees every node just after it is constructed, so a test can hand each
 * `fm-part` a feed before a note reaches it. Node-only, like the rest of this
 * directory.
 */
import { FakeContext } from './fakeAudioContext';
import type { FakeNode } from './fakeAudioNodes';
import { BLOCK } from './fakeAudioNodes';

export interface FakeOfflineInit {
  numberOfChannels: number;
  length: number;
  sampleRate: number;
}

export class FakeOfflineContext extends FakeContext {
  readonly length: number;
  /** Every suspend frame asked for, in order: what the render's stops were. */
  readonly suspendFrames: number[] = [];
  onNode: ((node: FakeNode) => void) | null = null;
  private readonly pending = new Map<number, () => void>();
  private release: (() => void) | null = null;

  constructor(init: FakeOfflineInit) {
    super();
    // The graph stand-in carries one rate as a field; a render at another rate
    // overrides it on this instance.
    Object.defineProperty(this, 'sampleRate', { value: init.sampleRate });
    this.length = init.length;
  }

  override register(node: FakeNode): void {
    super.register(node);
    // Registered from the node's base constructor, before a subclass's own
    // fields (a worklet's `name`) exist: hand it over once construction ends.
    queueMicrotask(() => this.onNode?.(node));
  }

  suspend(time: number): Promise<void> {
    const frame = Math.ceil((time * this.sampleRate) / BLOCK) * BLOCK;
    if (frame >= this.length || this.pending.has(frame)) {
      return Promise.reject(new Error(`suspend(${time}): frame ${frame} not schedulable`));
    }
    this.suspendFrames.push(frame);
    return new Promise((resolve) => this.pending.set(frame, resolve));
  }

  override async resume(): Promise<void> {
    this.state = 'running';
    const release = this.release;
    this.release = null;
    release?.();
  }

  async startRendering(): Promise<AudioBuffer> {
    const blocks = Math.ceil(this.length / BLOCK);
    const left = new Float32Array(blocks * BLOCK);
    const right = new Float32Array(blocks * BLOCK);
    this.state = 'running';
    for (let b = 0; b < blocks; b++) {
      this.currentTime = (b * BLOCK) / this.sampleRate;
      await this.pauseAt(b * BLOCK);
      for (const delay of this.delays) delay.pull(b);
      const channels = this.destination.pull(b);
      left.set(channels[0] ?? new Float32Array(BLOCK), b * BLOCK);
      right.set(channels[1] ?? channels[0] ?? new Float32Array(BLOCK), b * BLOCK);
      for (const delay of this.delays) delay.commit(b);
    }
    const out = [left.subarray(0, this.length), right.subarray(0, this.length)];
    return {
      length: this.length,
      numberOfChannels: out.length,
      sampleRate: this.sampleRate,
      duration: this.length / this.sampleRate,
      getChannelData: (channel: number) => out[channel] ?? new Float32Array(this.length),
    } as unknown as AudioBuffer;
  }

  private async pauseAt(frame: number): Promise<void> {
    const resolve = this.pending.get(frame);
    if (!resolve) return;
    this.pending.delete(frame);
    this.state = 'suspended';
    const resumed = new Promise<void>((r) => {
      this.release = r;
    });
    resolve();
    await resumed;
  }
}
