import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeContext, FakeWorkletNode } from '../__fixtures__/fakeAudioContext';
import { FakeNode, FakeParam } from '../__fixtures__/fakeAudioNodes';
import { eqParams, loadEq } from '../__fixtures__/eqHarness';
import {
  EQ_BAND_COUNT,
  EQ_LISTEN,
  EQ_NAME,
  EQ_SLOPES,
  EQ_SPECTRUM,
  EQ_TYPE_ID,
} from './eqConstants';
import { EQ_INSERT } from './eqInsert';
import {
  EQ_BAND_PARAMS,
  eqParamName,
  eqParameterDescriptors,
  eqParameterValues,
} from './eqParameters';
import { DEFAULT_EQ } from './eqSpec';
import type { EqSpec } from './eqSpec';
import { INSERT_KINDS, INSERT_KIND_NAMES } from './insertRegistry';

class EqNode extends FakeNode {
  readonly kind = 'eq';
  readonly parameters = new Map<string, FakeParam>();
  readonly posted: unknown[] = [];
  readonly port = Object.assign(new EventTarget(), {
    postMessage: (data: unknown): void => {
      this.posted.push(data);
    },
    start: vi.fn(),
    close: vi.fn(),
    onmessage: null,
  });
  readonly options: AudioWorkletNodeOptions;
  private readonly params = eqParams();
  private readonly processor = loadEq();
  constructor(context: FakeContext, options: AudioWorkletNodeOptions) {
    super(context, 1, 1);
    this.options = options;
    for (const [key, value] of Object.entries(this.params))
      this.parameters.set(key, new FakeParam(options.parameterData?.[key] ?? value[0]!));
  }
  protected render(block: number): Float32Array[][] {
    for (const [key, param] of this.parameters) this.params[key]![0] = param.value;
    const output = [[new Float32Array(128), new Float32Array(128)]];
    this.processor.process([this.gather(block)], output, this.params);
    return output;
  }
}
function install(): void {
  vi.stubGlobal(
    'AudioWorkletNode',
    function (context: FakeContext, name: string, options: AudioWorkletNodeOptions) {
      return name === EQ_NAME
        ? new EqNode(context, options)
        : new FakeWorkletNode(context, name, options);
    },
  );
}
afterEach(() => vi.unstubAllGlobals());

/** An analyser that reads every bin at −42 dBFS. */
class FakeAnalyser extends FakeNode {
  readonly kind = 'analyser';
  fftSize = 2048;
  smoothingTimeConstant = 0.8;
  getFloatFrequencyData(into: Float32Array): void {
    into.fill(-42);
  }
  protected render(): Float32Array[][] {
    return [[]];
  }
}

/** A context whose `createAnalyser` builds `FakeAnalyser`s, each kept in `analysers`. */
function analysingContext(): { context: FakeContext; analysers: FakeAnalyser[] } {
  const context = new FakeContext();
  const analysers: FakeAnalyser[] = [];
  Object.assign(context, {
    createAnalyser: (): FakeAnalyser => {
      const analyser = new FakeAnalyser(context);
      analysers.push(analyser);
      return analyser;
    },
  });
  return { context, analysers };
}

const PAD: EqSpec = {
  ...DEFAULT_EQ,
  scale: 0.8,
  output: -2,
  bands: DEFAULT_EQ.bands.map((band, i) =>
    i === 0
      ? { ...band, on: true, freq: 120, q: 0.9, slope: 24 }
      : i === 3
        ? { ...band, type: 'notch', freq: 1240, q: 8 }
        : band,
  ),
};

describe('the parameters', () => {
  it('name every band field flat, b1Freq … b8On, then scale, output and enabled', () => {
    const names = eqParameterDescriptors().map((d) => d.name);
    expect(names).toHaveLength(EQ_BAND_COUNT * EQ_BAND_PARAMS.length + 3);
    expect(names.slice(0, 6)).toEqual(['b1Freq', 'b1Gain', 'b1Q', 'b1Type', 'b1Slope', 'b1On']);
    expect(names.slice(-3)).toEqual(['scale', 'output', 'enabled']);
    expect(Object.keys(eqParameterValues(DEFAULT_EQ))).toEqual(names);
    for (const d of eqParameterDescriptors()) {
      expect(d.automationRate).toBe('k-rate');
      expect(eqParameterValues(DEFAULT_EQ)[d.name]).toBe(d.defaultValue);
    }
  });

  it('carry type and slope as their ids', () => {
    const values = eqParameterValues(PAD);
    expect(values[eqParamName(3, 'Type')]).toBe(EQ_TYPE_ID.notch);
    expect(values[eqParamName(0, 'Slope')]).toBe(EQ_SLOPES.indexOf(24));
    expect(values[eqParamName(0, 'On')]).toBe(1);
    expect(values.scale).toBe(0.8);
  });
});

describe('the stage', () => {
  it('starts from the spec and updates parameters without wiring changes, releasing only its own edges', () => {
    install();
    const context = new FakeContext();
    const stage = EQ_INSERT.create(context.asAudioContext(), DEFAULT_EQ);
    const node = stage.processor as unknown as EqNode;
    expect(node.options.parameterData).toEqual(eqParameterValues(DEFAULT_EQ));
    expect(node.options.outputChannelCount).toEqual([2]);
    const edges = context.nodes.map((n) => [...n.outbound]);
    stage.set(PAD);
    expect(context.nodes.map((n) => n.outbound)).toEqual(edges);
    for (const [name, value] of Object.entries(eqParameterValues(PAD)))
      expect(node.parameters.get(name)!.value, name).toBe(value);
    const output = stage.output as unknown as FakeNode;
    output.connect(context.destination);
    stage.dispose();
    expect(output.outbound).toHaveLength(1);
    expect(node.posted).toEqual([{ type: 'stop' }]);
    expect(node.port.close).toHaveBeenCalledOnce();
    expect(context.nodes.filter((n) => n !== output && n.outbound.length)).toEqual([]);
  });

  it('is a kind with the defaults and normaliser, registered as eq (windsor#199)', () => {
    expect(EQ_INSERT.defaults).toBe(DEFAULT_EQ);
    expect(EQ_INSERT.fields).toEqual(['kind', 'enabled', 'scale', 'output', 'bands']);
    expect(INSERT_KIND_NAMES).toContain('eq');
    expect(INSERT_KINDS.eq).toBe(EQ_INSERT);
  });

  it('taps its output into an analyser only while the spectrum is active', () => {
    install();
    const { context, analysers } = analysingContext();
    const stage = EQ_INSERT.create(context.asAudioContext(), PAD);
    const output = stage.output as unknown as FakeNode;
    output.connect(context.destination);
    const bins = new Float32Array(EQ_SPECTRUM.fftSize / 2);
    stage.spectrum!.read(bins);
    expect(analysers, 'nothing is built before the first activation').toEqual([]);
    expect(bins.every((v) => v === -Infinity)).toBe(true);

    stage.spectrum!.setActive(true);
    expect(analysers).toHaveLength(1);
    const [analyser] = analysers as [FakeAnalyser];
    expect(analyser.fftSize).toBe(EQ_SPECTRUM.fftSize);
    expect(analyser.smoothingTimeConstant).toBe(EQ_SPECTRUM.smoothing);
    expect(output.outbound.map((c) => c.to)).toEqual([context.destination, analyser]);
    expect(analyser.outbound, 'a tap, never in the program path').toEqual([]);
    stage.spectrum!.read(bins);
    expect(bins.every((v) => v === -42)).toBe(true);

    stage.spectrum!.setActive(false);
    stage.spectrum!.setActive(false);
    expect(output.outbound.map((c) => c.to)).toEqual([context.destination]);
    stage.spectrum!.read(bins);
    expect(bins.every((v) => v === -Infinity)).toBe(true);

    stage.spectrum!.setActive(true);
    expect(analysers, 'the analyser is built once').toHaveLength(1);
    stage.dispose();
    expect(output.outbound.map((c) => c.to)).toEqual([context.destination]);
  });

  it('stops processing once told to stop', () => {
    const processor = loadEq();
    processor.port.onmessage({ data: { type: 'stop' } });
    const out = [[new Float32Array(128), new Float32Array(128)]];
    expect(processor.process([[new Float32Array(128)]], out, eqParams())).toBe(false);
  });

  it('sends Listen to the processor, and leaves every parameter where it was', () => {
    install();
    const context = new FakeContext();
    const stage = EQ_INSERT.create(context.asAudioContext(), PAD);
    const node = stage.processor as unknown as EqNode;
    const before = [...node.parameters].map(([name, p]) => [name, p.value]);
    stage.listen!(3);
    stage.listen!(EQ_LISTEN.off);
    stage.listen!(-7);
    expect(node.posted).toEqual([
      { type: 'listen', band: 3 },
      { type: 'listen', band: EQ_LISTEN.off },
      { type: 'listen', band: EQ_LISTEN.off },
    ]);
    expect([...node.parameters].map(([name, p]) => [name, p.value])).toEqual(before);
  });

  it('reports load when asked', () => {
    const processor = loadEq();
    processor.port.onmessage({ data: { type: 'reportLoad', quanta: 2 } });
    const out = [[new Float32Array(128), new Float32Array(128)]];
    const params = eqParams(PAD);
    processor.process([[new Float32Array(128).fill(0.1)]], out, params);
    processor.process([[new Float32Array(128).fill(0.1)]], out, params);
    expect(processor.port.posted).toEqual([expect.objectContaining({ type: 'load', quanta: 2 })]);
  });
});
