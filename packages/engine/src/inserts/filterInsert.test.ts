import { afterEach, expect, it, vi } from 'vitest';
import { FakeContext, FakeWorkletNode } from '../__fixtures__/fakeAudioContext';
import { FakeNode, FakeParam } from '../__fixtures__/fakeAudioNodes';
import { filterParams, loadFilter } from '../__fixtures__/filterHarness';
import { FILTER_NAME } from './filterConstants';
import { FILTER_INSERT } from './filterInsert';
import { DEFAULT_FILTER } from './filterSpec';

/** The real bundle behind a fake node: each block reads the params as they stand. */
class FilterNode extends FakeNode {
  readonly kind = 'filter';
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
  private readonly params = filterParams();
  private readonly processor = loadFilter();
  constructor(context: FakeContext, options: AudioWorkletNodeOptions) {
    super(context, 1, 1);
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

afterEach(() => vi.unstubAllGlobals());

it('writes the mode as its index and the switches as 0 or 1, and hands lanes only the sweep', () => {
  vi.stubGlobal(
    'AudioWorkletNode',
    function (context: FakeContext, name: string, options: AudioWorkletNodeOptions) {
      return name === FILTER_NAME
        ? new FilterNode(context, options)
        : new FakeWorkletNode(context, name, options);
    },
  );
  const context = new FakeContext();
  const stage = FILTER_INSERT.create(context.asAudioContext(), {
    ...DEFAULT_FILTER,
    mode: 'notch',
  });
  const node = stage.processor as unknown as FilterNode;
  const value = (name: string): number => node.parameters.get(name)!.value;
  expect([value('mode'), value('slope24'), value('enabled'), value('cutoff')]).toEqual([
    3, 0, 1, 18000,
  ]);
  const edges = context.nodes.map((n) => [...n.outbound]);
  stage.set({ ...DEFAULT_FILTER, mode: 'acid', slope24: true, cutoff: 440, enabled: false });
  expect(context.nodes.map((n) => n.outbound)).toEqual(edges);
  expect([value('mode'), value('slope24'), value('enabled'), value('cutoff')]).toEqual([
    4, 1, 0, 440,
  ]);
  for (const field of ['cutoff', 'resonance', 'mix'])
    expect(stage.param!(field), field).toBeDefined();
  for (const field of ['mode', 'slope24', 'enabled'])
    expect(stage.param!(field), field).toBeUndefined();
  stage.dispose();
  expect(node.posted).toEqual([{ type: 'stop' }]);
  expect(node.port.close).toHaveBeenCalledOnce();
});
