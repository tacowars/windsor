import { afterEach, expect, it, vi } from 'vitest';
import { FakeContext, FakeWorkletNode } from '../__fixtures__/fakeAudioContext';
import { FakeNode, FakeParam } from '../__fixtures__/fakeAudioNodes';
import { loadAdvancedDrive, advancedDriveParams } from '../__fixtures__/advancedDriveHarness';
import { ADVANCED_DRIVE_NAME } from './advancedDriveConstants';
import { DEFAULT_ADVANCED_DRIVE } from './advancedDriveSpec';
import { ADVANCED_DRIVE_INSERT } from './advancedDriveInsert';
import { FmEngine } from '../synth/fmEngine';
import { AudioSystem } from '../system/audioSystem';
import { makePatch } from '../patch/patch';

class AdvancedDriveNode extends FakeNode {
  readonly kind = 'advancedDrive';
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
  private readonly params = advancedDriveParams();
  private readonly processor = loadAdvancedDrive();
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
      return name === ADVANCED_DRIVE_NAME
        ? new AdvancedDriveNode(context, options)
        : new FakeWorkletNode(context, name, options);
    },
  );
}
afterEach(() => vi.unstubAllGlobals());

it('updates parameters without wiring changes and releases only owned edges', () => {
  install();
  const context = new FakeContext();
  const stage = ADVANCED_DRIVE_INSERT.create(context.asAudioContext(), DEFAULT_ADVANCED_DRIVE);
  const node = stage.processor as unknown as AdvancedDriveNode;
  const edges = context.nodes.map((n) => [...n.outbound]);
  stage.set({ ...DEFAULT_ADVANCED_DRIVE, route: 'multiband', drive: 12, enabled: false });
  expect(context.nodes.map((n) => n.outbound)).toEqual(edges);
  expect(node.parameters.get('route')!.value).toBe(3);
  expect(node.parameters.get('drive')!.value).toBe(12);
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
  strip.setInserts([DEFAULT_ADVANCED_DRIVE]);
  system.masterStrip!.apply({ inserts: [DEFAULT_ADVANCED_DRIVE] });
  const stage = strip.inserts[0]!;
  expect(system.meteredProcessors).toBe(before + 2);
  expect((stage.processor as unknown as AdvancedDriveNode).posted).toContainEqual(
    expect.objectContaining({ type: 'reportLoad' }),
  );
  strip.setInserts([{ ...DEFAULT_ADVANCED_DRIVE, rate: 1.5 }]);
  expect(strip.inserts[0]).toBe(stage);
  expect(stage.processor!.parameters.get('rate')!.value).toBe(1.5);
  system.dispose();
  expect(system.meteredProcessors).toBe(0);
});
