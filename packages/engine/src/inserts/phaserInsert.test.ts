import { afterEach, expect, it, vi } from 'vitest';
import { FakeContext, FakeWorkletNode } from '../__fixtures__/fakeAudioContext';
import { FakeNode, FakeParam } from '../__fixtures__/fakeAudioNodes';
import { loadPhaser, phaserParams } from '../__fixtures__/phaserHarness';
import { PHASER_NAME } from './phaserConstants';
import { DEFAULT_PHASER } from './phaserSpec';
import { PHASER_INSERT } from './phaserInsert';
import { FmEngine } from '../synth/fmEngine';
import { AudioSystem } from '../game/audioSystem';
import { makePatch } from '../patch/patch';

class PhaserNode extends FakeNode {
  readonly kind = 'phaser';
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
  private readonly params = phaserParams();
  private readonly processor = loadPhaser();
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
      return name === PHASER_NAME
        ? new PhaserNode(context, options)
        : new FakeWorkletNode(context, name, options);
    },
  );
}
afterEach(() => vi.unstubAllGlobals());

it('updates parameters without wiring changes and releases only owned edges', () => {
  install();
  const context = new FakeContext();
  const stage = PHASER_INSERT.create(context.asAudioContext(), DEFAULT_PHASER);
  const node = stage.processor as unknown as PhaserNode;
  const edges = context.nodes.map((n) => [...n.outbound]);
  stage.set({ ...DEFAULT_PHASER, center: 1200, feedback: -0.8, enabled: false });
  expect(context.nodes.map((n) => n.outbound)).toEqual(edges);
  expect(node.parameters.get('center')!.value).toBe(1200);
  expect(node.parameters.get('feedback')!.value).toBe(-0.8);
  expect(node.parameters.get('enabled')!.value).toBe(0);
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
  strip.setInserts([DEFAULT_PHASER]);
  system.masterStrip!.apply({ inserts: [DEFAULT_PHASER] });
  const stage = strip.inserts[0]!;
  expect(system.meteredProcessors).toBe(before + 2);
  expect((stage.processor as unknown as PhaserNode).posted).toContainEqual(
    expect.objectContaining({ type: 'reportLoad' }),
  );
  strip.setInserts([{ ...DEFAULT_PHASER, rate: 1.5 }]);
  expect(strip.inserts[0]).toBe(stage);
  expect(stage.processor!.parameters.get('rate')!.value).toBe(1.5);
  system.dispose();
  expect(system.meteredProcessors).toBe(0);
});
