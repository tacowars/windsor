/**
 * A block-rate stand-in for the native Web Audio nodes the mixer is built
 * from, so the routing can be rendered headlessly under Node.
 *
 * The worklet harnesses shim `AudioWorkletGlobalScope` so the DSP can be
 * driven a block at a time; this does the same for the graph *around* the DSP
 * -- gains, splitter, merger, delay, biquad -- which is where sends, returns
 * and the pan rotation live. Every node here evaluates the same linear
 * arithmetic the spec defines for one 128-frame render quantum with k-rate
 * parameters: a gain multiplies, a splitter and merger move channels, a delay
 * reads what was written `delayTime` ago, a biquad is the spec's RBJ section
 * (with `Q` in dB for lowpass and highpass, as the spec has it). It is not the
 * browser's implementation, and it says so: the compressor is a pass-through,
 * parameters step at block boundaries, and a delay must be at least one block
 * (which a real cycle requires anyway).
 *
 * Pull-based: a node renders once per block on first request and caches; a
 * `DelayNode` renders from its ring without pulling upstream, which is what
 * lets a feedback loop evaluate, and is then `commit()`ed once the block's
 * consumers have read it. Node-only, by design: excluded from the engine's tsc
 * build (see packages/engine/tsconfig.json).
 */

export const BLOCK = 128;

/** What a node needs from its context. `FakeContext` provides it. */
export interface FakeHost {
  readonly sampleRate: number;
  register(node: FakeNode): void;
}

export class FakeParam {
  value: number;
  /** Nodes connected into this param: a-rate modulation summed onto `value`, as the spec has it. */
  readonly inputs: FakeNode[] = [];
  /**
   * Every automation call, in order. The fake applies each one immediately
   * rather than over time, so a ramp's shape is not modelled; what a test can
   * assert from this is the order of the calls around a graph change (#652).
   */
  readonly automation: { call: string; value: number; time?: number }[] = [];

  constructor(
    value: number,
    readonly minValue = -Infinity,
    readonly maxValue = Infinity,
  ) {
    this.value = value;
  }

  setValueAtTime(value: number, time?: number): this {
    this.automation.push({
      call: 'setValueAtTime',
      value,
      ...(time === undefined ? {} : { time }),
    });
    this.value = value;
    return this;
  }

  setTargetAtTime(value: number, time?: number): this {
    this.automation.push({
      call: 'setTargetAtTime',
      value,
      ...(time === undefined ? {} : { time }),
    });
    this.value = value;
    return this;
  }

  linearRampToValueAtTime(value: number, time?: number): this {
    this.automation.push({
      call: 'linearRampToValueAtTime',
      value,
      ...(time === undefined ? {} : { time }),
    });
    this.value = value;
    return this;
  }

  cancelScheduledValues(time?: number): this {
    this.automation.push({
      call: 'cancelScheduledValues',
      value: this.value,
      ...(time === undefined ? {} : { time }),
    });
    return this;
  }

  /** The block's per-sample value: `value` plus every connected node's first channel. */
  valuesAt(block: number): Float32Array {
    const out = new Float32Array(BLOCK).fill(this.value);
    for (const node of this.inputs) {
      const channel = node.pull(block)[0];
      if (channel) for (let i = 0; i < BLOCK; i++) out[i] = (out[i] ?? 0) + (channel[i] ?? 0);
    }
    return out;
  }
}

export interface Connection {
  from: FakeNode;
  to: FakeNode;
  output: number;
  input: number;
}

export abstract class FakeNode {
  abstract readonly kind: string;
  readonly inbound: Connection[] = [];
  readonly outbound: Connection[] = [];
  /** Params this node modulates (`connect(param)`). */
  readonly paramOutbound: FakeParam[] = [];
  private cachedBlock = -1;
  private cached: Float32Array[][] = [];
  private rendering = false;

  constructor(
    readonly context: FakeHost,
    readonly numberOfInputs = 1,
    readonly numberOfOutputs = 1,
  ) {
    context.register(this);
  }

  connect(destination: FakeNode, output?: number, input?: number): FakeNode;
  connect(destination: FakeParam, output?: number): void;
  connect(destination: FakeNode | FakeParam, output = 0, input = 0): FakeNode | void {
    if (output >= this.numberOfOutputs) throw new RangeError(`${this.kind}: no output ${output}`);
    if (destination instanceof FakeParam) {
      destination.inputs.push(this);
      this.paramOutbound.push(destination);
      return;
    }
    if (input >= destination.numberOfInputs) {
      throw new RangeError(`${destination.kind}: no input ${input}`);
    }
    const connection: Connection = { from: this, to: destination, output, input };
    this.outbound.push(connection);
    destination.inbound.push(connection);
    return destination;
  }

  /**
   * Every outbound edge, or only those to `destination` -- which, as the spec
   * has it, throws when there is no such edge (an `InvalidAccessError`).
   */
  disconnect(destination?: FakeNode | FakeParam): void {
    if (destination === undefined || destination instanceof FakeParam) {
      const params = this.paramOutbound.filter(
        (p) => destination === undefined || p === destination,
      );
      if (destination !== undefined && params.length === 0) {
        throw new Error(`${this.kind}: InvalidAccessError, not connected to that param`);
      }
      for (const param of params) {
        param.inputs.splice(param.inputs.indexOf(this), 1);
        this.paramOutbound.splice(this.paramOutbound.indexOf(param), 1);
      }
      if (destination !== undefined) return;
    }
    const dropped = this.outbound.filter((c) => destination === undefined || c.to === destination);
    if (destination !== undefined && dropped.length === 0) {
      throw new Error(
        `${this.kind}: InvalidAccessError, not connected to that ${destination.kind}`,
      );
    }
    for (const connection of dropped) {
      const inbound = connection.to.inbound.indexOf(connection);
      if (inbound >= 0) connection.to.inbound.splice(inbound, 1);
      this.outbound.splice(this.outbound.indexOf(connection), 1);
    }
  }

  /** The channels on `output` for `block`, rendered once per block. */
  pull(block: number, output = 0): Float32Array[] {
    if (this.cachedBlock !== block) {
      if (this.rendering) throw new Error(`cycle through a ${this.kind} with no DelayNode in it`);
      this.rendering = true;
      this.cached = this.render(block);
      this.rendering = false;
      this.cachedBlock = block;
    }
    return this.cached[output] ?? [];
  }

  /** Everything connected to `input`, summed; stereo when any source is. */
  protected gather(block: number, input = 0): Float32Array[] {
    const left = new Float32Array(BLOCK);
    const right = new Float32Array(BLOCK);
    let stereo = false;
    for (const connection of this.inbound) {
      if (connection.input !== input) continue;
      const channels = connection.from.pull(block, connection.output);
      const l = channels[0];
      if (!l) continue;
      const r = channels[1] ?? l;
      if (channels.length > 1) stereo = true;
      for (let i = 0; i < BLOCK; i++) {
        left[i] = (left[i] ?? 0) + (l[i] ?? 0);
        right[i] = (right[i] ?? 0) + (r[i] ?? 0);
      }
    }
    return stereo ? [left, right] : [left];
  }

  protected abstract render(block: number): Float32Array[][];
}

export class FakeGain extends FakeNode {
  readonly kind = 'gain';
  readonly gain = new FakeParam(1);

  protected render(block: number): Float32Array[][] {
    const channels = this.gather(block);
    const g = this.gain.value;
    for (const channel of channels)
      for (let i = 0; i < BLOCK; i++) channel[i] = (channel[i] ?? 0) * g;
    return [channels];
  }
}

export class FakeSplitter extends FakeNode {
  readonly kind = 'splitter';

  constructor(context: FakeHost, outputs = 6) {
    super(context, 1, outputs);
  }

  protected render(block: number): Float32Array[][] {
    const channels = this.gather(block);
    const outputs: Float32Array[][] = [];
    for (let i = 0; i < this.numberOfOutputs; i++) {
      outputs.push([channels[i] ?? new Float32Array(BLOCK)]);
    }
    return outputs;
  }
}

export class FakeMerger extends FakeNode {
  readonly kind = 'merger';

  constructor(context: FakeHost, inputs = 6) {
    super(context, inputs, 1);
  }

  /** Each input is down-mixed to mono and becomes one output channel. */
  protected render(block: number): Float32Array[][] {
    const out: Float32Array[] = [];
    for (let i = 0; i < this.numberOfInputs; i++) {
      const channels = this.gather(block, i);
      const l = channels[0] ?? new Float32Array(BLOCK);
      const r = channels[1];
      if (r) for (let k = 0; k < BLOCK; k++) l[k] = 0.5 * ((l[k] ?? 0) + (r[k] ?? 0));
      out.push(l);
    }
    return [out];
  }
}

export class FakeDelay extends FakeNode {
  readonly kind = 'delay';
  readonly delayTime: FakeParam;
  private readonly ring: [Float32Array, Float32Array];
  private write = 0;

  constructor(context: FakeHost, maxDelayTime = 1) {
    super(context);
    this.delayTime = new FakeParam(0, 0, maxDelayTime);
    const length = Math.ceil(maxDelayTime * context.sampleRate) + BLOCK;
    this.ring = [new Float32Array(length), new Float32Array(length)];
  }

  /**
   * Reads the ring only; never pulls upstream through its input, so a feedback
   * loop can evaluate. A modulated `delayTime` (a node connected into it) is
   * read per sample, with linear interpolation between ring samples, which is
   * what a chorus rests on.
   */
  protected render(block: number): Float32Array[][] {
    if (this.delayTime.inputs.length > 0) return this.renderModulated(block);
    const samples = Math.round(this.delayTime.value * this.context.sampleRate);
    if (samples < BLOCK) {
      throw new Error(`fake DelayNode needs delayTime >= one block (${BLOCK} frames)`);
    }
    const length = this.ring[0].length;
    const start = (this.write - samples + length) % length;
    const left = new Float32Array(BLOCK);
    const right = new Float32Array(BLOCK);
    for (let i = 0; i < BLOCK; i++) {
      left[i] = this.ring[0][(start + i) % length] ?? 0;
      right[i] = this.ring[1][(start + i) % length] ?? 0;
    }
    return [[left, right]];
  }

  /**
   * The spec clamps the computed delay time to `[0, maxDelayTime]`, and a
   * delay outside a cycle may be shorter than a block (#695): a lag under the
   * sample's own offset in the block reads this block's input, pulled
   * upstream. Inside a cycle that pull throws, as the fake's cycle rule does.
   */
  private renderModulated(block: number): Float32Array[][] {
    const times = this.delayTime.valuesAt(block);
    const maxLag = this.delayTime.maxValue * this.context.sampleRate;
    const out = [new Float32Array(BLOCK), new Float32Array(BLOCK)];
    let current: Float32Array[] | null = null;
    const sample = (rel: number, c: number): number => {
      if (rel < 0) {
        const ring = this.ring[c] ?? this.ring[0];
        const length = ring.length;
        return ring[(((this.write + rel) % length) + length) % length] ?? 0;
      }
      current ??= this.gather(block);
      return (current[c] ?? current[0])?.[rel] ?? 0;
    };
    for (let i = 0; i < BLOCK; i++) {
      const lag = Math.min(maxLag, Math.max(0, (times[i] ?? 0) * this.context.sampleRate));
      const at = i - lag;
      const k = Math.floor(at);
      const f = at - k;
      for (let c = 0; c < 2; c++) {
        const next = f > 0 ? sample(k + 1, c) : 0;
        (out[c] as Float32Array)[i] = (1 - f) * sample(k, c) + f * next;
      }
    }
    return [out];
  }

  /** Write this block's input. Call after every consumer has pulled the block. */
  commit(block: number): void {
    const channels = this.gather(block);
    const length = this.ring[0].length;
    for (let c = 0; c < 2; c++) {
      const source = channels[c] ?? channels[0] ?? new Float32Array(BLOCK);
      const ring = this.ring[c] ?? this.ring[0];
      for (let i = 0; i < BLOCK; i++) ring[(this.write + i) % length] = source[i] ?? 0;
    }
    this.write = (this.write + BLOCK) % length;
  }
}

export class FakeBiquad extends FakeNode {
  readonly kind = 'biquad';
  type: BiquadFilterType = 'lowpass';
  readonly frequency = new FakeParam(350, 0, 24000);
  readonly Q = new FakeParam(1, -770, 770);
  readonly gain = new FakeParam(0);
  readonly detune = new FakeParam(0);
  private readonly z1 = [0, 0];
  private readonly z2 = [0, 0];

  protected render(block: number): Float32Array[][] {
    const channels = this.gather(block);
    const { b0, b1, b2, a1, a2 } = this.coefficients();
    channels.forEach((channel, c) => {
      let z1 = this.z1[c] ?? 0;
      let z2 = this.z2[c] ?? 0;
      for (let i = 0; i < BLOCK; i++) {
        const x = channel[i] ?? 0;
        const y = b0 * x + z1;
        z1 = b1 * x - a1 * y + z2;
        z2 = b2 * x - a2 * y;
        channel[i] = y;
      }
      this.z1[c] = z1;
      this.z2[c] = z2;
    });
    return [channels];
  }

  /** RBJ cookbook, as the spec's BiquadFilterNode: `Q` is in dB for these two types. */
  private coefficients(): { b0: number; b1: number; b2: number; a1: number; a2: number } {
    const w0 = (2 * Math.PI * this.frequency.value) / this.context.sampleRate;
    const cos = Math.cos(w0);
    const alpha = Math.sin(w0) / (2 * Math.pow(10, this.Q.value / 20));
    const a0 = 1 + alpha;
    if (this.type === 'lowpass') {
      return {
        b0: (1 - cos) / 2 / a0,
        b1: (1 - cos) / a0,
        b2: (1 - cos) / 2 / a0,
        a1: (-2 * cos) / a0,
        a2: (1 - alpha) / a0,
      };
    }
    if (this.type === 'highpass') {
      return {
        b0: (1 + cos) / 2 / a0,
        b1: -(1 + cos) / a0,
        b2: (1 + cos) / 2 / a0,
        a1: (-2 * cos) / a0,
        a2: (1 - alpha) / a0,
      };
    }
    throw new Error(`fake BiquadFilterNode does not model type "${this.type}"`);
  }
}

/** Pass-through. The limiter's behaviour is not under test; its place in the graph is. */
export class FakeCompressor extends FakeNode {
  readonly kind = 'compressor';
  readonly threshold = new FakeParam(-24);
  readonly knee = new FakeParam(30);
  readonly ratio = new FakeParam(12);
  readonly attack = new FakeParam(0.003);
  readonly release = new FakeParam(0.25);

  protected render(block: number): Float32Array[][] {
    return [this.gather(block)];
  }
}

export class FakeDestination extends FakeNode {
  readonly kind = 'destination';

  constructor(context: FakeHost) {
    super(context, 1, 0);
  }

  protected render(block: number): Float32Array[][] {
    return [this.gather(block)];
  }
}
