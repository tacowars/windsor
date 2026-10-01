import { afterEach, expect, it, vi } from 'vitest';
import { FakeContext, FakeWorkletNode } from '../__fixtures__/fakeAudioContext';
import { FakeNode, FakeParam } from '../__fixtures__/fakeAudioNodes';
import { loadTape, tapeParams } from '../__fixtures__/tapeHarness';
import { TAPE_CORE_BOUNDS, TAPE_MODELS, TAPE_NAME, TAPE_TYPES } from './tapeConstants';
import { DEFAULT_TAPE } from './tapeSpec';
import { TAPE_INSERT } from './tapeInsert';
import { FmEngine } from '../synth/fmEngine';
import { AudioSystem } from '../system/audioSystem';
import { makePatch } from '../patch/patch';

class TapeNode extends FakeNode {
  readonly kind = 'tape';
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
  private readonly params = tapeParams();
  private readonly processor = loadTape();
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
function install(): void {
  vi.stubGlobal(
    'AudioWorkletNode',
    function (context: FakeContext, name: string, options: AudioWorkletNodeOptions) {
      return name === TAPE_NAME
        ? new TapeNode(context, options)
        : new FakeWorkletNode(context, name, options);
    },
  );
}
afterEach(() => vi.unstubAllGlobals());

it('updates parameters without wiring changes and releases only owned edges', () => {
  install();
  const context = new FakeContext();
  const stage = TAPE_INSERT.create(context.asAudioContext(), DEFAULT_TAPE);
  const node = stage.processor as unknown as TapeNode;
  const edges = context.nodes.map((n) => [...n.outbound]);
  stage.set({
    ...DEFAULT_TAPE,
    drive: 12,
    wear: 80,
    split: true,
    wow: 23,
    flutter: 34,
    dropouts: 45,
    wowRate: 0.5,
    flutterRate: 11,
    enabled: false,
  });
  expect(context.nodes.map((n) => n.outbound)).toEqual(edges);
  expect(node.parameters.get('drive')!.value).toBe(12);
  expect(node.parameters.get('wear')!.value).toBe(80);
  expect(node.parameters.get('enabled')!.value).toBe(0);
  for (const [key, value] of Object.entries({
    split: 1,
    wow: 23,
    flutter: 34,
    dropouts: 45,
    wowRate: 0.5,
    flutterRate: 11,
  }))
    expect(node.parameters.get(key)!.value).toBe(value);
  const output = stage.output as unknown as FakeNode;
  output.connect(context.destination);
  stage.dispose();
  expect(output.outbound).toHaveLength(1);
  expect(node.posted).toEqual([{ type: 'stop' }]);
  expect(node.port.close).toHaveBeenCalledOnce();
  expect(context.nodes.filter((n) => n !== output && n.outbound.length)).toEqual([]);
});

it('keeps track/master processors across edits and removes their load accounts on disposal', async () => {
  install();
  const context = new FakeContext();
  const system = new AudioSystem(new FmEngine(context.asAudioContext()), { defer: (run) => run() });
  await system.init();
  system.createMusicPart('test', makePatch());
  const strip = system.strip('test')!;
  const before = system.meteredProcessors;
  strip.setInserts([DEFAULT_TAPE]);
  system.masterStrip!.apply({ inserts: [DEFAULT_TAPE] });
  const stage = strip.inserts[0]!;
  expect(system.meteredProcessors).toBe(before + 2);
  expect((stage.processor as unknown as TapeNode).posted).toContainEqual(
    expect.objectContaining({ type: 'reportLoad' }),
  );
  strip.setInserts([{ ...DEFAULT_TAPE, drive: 15 }]);
  expect(strip.inserts[0]).toBe(stage);
  expect(stage.processor!.parameters.get('drive')!.value).toBe(15);
  system.dispose();
  expect(system.meteredProcessors).toBe(0);
});

it("carries a song's core to the processor's four parameters, and the model's row when cleared (windsor#291)", () => {
  install();
  const context = new FakeContext();
  const core = { drive: 0.75, width: 0.25, saturation: 0.5 };
  const stage = TAPE_INSERT.create(context.asAudioContext(), { ...DEFAULT_TAPE, core });
  const node = stage.processor as unknown as TapeNode;
  const read = (): number[] =>
    ['core', 'coreDrive', 'coreWidth', 'coreSaturation'].map(
      (name) => node.parameters.get(name)!.value,
    );
  expect(read()).toEqual([1, 0.75, 0.25, 0.5]);
  stage.set({ ...DEFAULT_TAPE, model: 'vhs', core: { ...core, width: 0.6 } });
  expect(read()).toEqual([1, 0.75, 0.6, 0.5]);
  stage.set({ ...DEFAULT_TAPE, model: 'vhs' });
  const [drive, width, saturation] = TAPE_MODELS[TAPE_TYPES.indexOf('vhs')]!.magnetic;
  expect(width).toBeLessThanOrEqual(TAPE_CORE_BOUNDS.width[1]);
  expect(read()).toEqual([0, drive, width, saturation]);
  stage.dispose();
});
