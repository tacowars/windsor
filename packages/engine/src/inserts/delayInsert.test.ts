import { afterEach, expect, it, vi } from 'vitest';
import { FakeContext, FakeWorkletNode } from '../__fixtures__/fakeAudioContext';
import { FakeNode, FakeParam } from '../__fixtures__/fakeAudioNodes';
import { loadDelay, delayParams } from '../__fixtures__/delayHarness';
import { DELAY_NAME } from './delayConstants';
import { DEFAULT_DELAY } from './delaySpec';
import { DELAY_INSERT } from './delayInsert';
import { FmEngine } from '../synth/fmEngine';
import { AudioSystem } from '../game/audioSystem';
import { FULL_DOCUMENT } from '../__fixtures__/fullArrangement';
import { makePatch } from '../patch/patch';

class DelayNode extends FakeNode {
  readonly kind = 'delay';
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
  private readonly params = delayParams();
  private readonly processor = loadDelay();
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
      return name === DELAY_NAME
        ? new DelayNode(context, options)
        : new FakeWorkletNode(context, name, options);
    },
  );
}
afterEach(() => vi.unstubAllGlobals());

it('updates parameters without wiring changes and releases only owned edges', () => {
  install();
  const context = new FakeContext();
  const stage = DELAY_INSERT.create(context.asAudioContext(), DEFAULT_DELAY);
  const node = stage.processor as unknown as DelayNode;
  const edges = context.nodes.map((n) => [...n.outbound]);
  stage.set({ ...DEFAULT_DELAY, lowpass: 1200, feedback: 1.1, enabled: false });
  expect(context.nodes.map((n) => n.outbound)).toEqual(edges);
  expect(node.parameters.get('lowpass')!.value).toBe(1200);
  expect(node.parameters.get('feedback')!.value).toBe(1.1);
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
  strip.setInserts([DEFAULT_DELAY]);
  system.masterStrip!.apply({ inserts: [DEFAULT_DELAY] });
  const stage = strip.inserts[0]!;
  expect(system.meteredProcessors).toBe(before + 2);
  expect((stage.processor as unknown as DelayNode).posted).toContainEqual(
    expect.objectContaining({ type: 'reportLoad' }),
  );
  strip.setInserts([{ ...DEFAULT_DELAY, feedback: 0.8 }]);
  expect(strip.inserts[0]).toBe(stage);
  expect(stage.processor!.parameters.get('feedback')!.value).toBe(0.8);
  system.dispose();
  expect(system.meteredProcessors).toBe(0);
});

it('follows initial/live tempo on track, master and deferred new inserts, without resetting history', async () => {
  install();
  const context = new FakeContext();
  const pending: Array<() => void> = [];
  const system = new AudioSystem(new FmEngine(context.asAudioContext()), {
    defer: (run) => pending.push(run),
  });
  await system.init();
  system.initMusic({
    ...FULL_DOCUMENT,
    transport: { ...FULL_DOCUMENT.transport, bpm: 60 },
    parts: FULL_DOCUMENT.parts.map((part) => ({
      ...part,
      strip: { ...part.strip!, inserts: [DEFAULT_DELAY] },
    })),
    master: { level: 1, inserts: [DEFAULT_DELAY] },
  });
  pending.splice(0).forEach((run) => run());
  const stage = system.strip('music-0')!.inserts[0]!;
  const left = () => stage.processor!.parameters.get('leftMs')!.value;
  expect(left()).toBe(750);
  expect(system.masterStrip!.inserts[0]!.processor!.parameters.get('rightMs')!.value).toBe(1000);
  expect(system.apply({ transport: { bpm: 120 } }).ok).toBe(true);
  expect(left()).toBe(375);
  expect(system.strip('music-0')!.inserts[0]).toBe(stage);
  expect(system.apply({ transport: { bpm: -1 } }).ok).toBe(false);
  expect(left()).toBe(375);
  expect(
    system.apply({
      master: { inserts: [DEFAULT_DELAY, { ...DEFAULT_DELAY, rightSync: false, rightMs: 123 }] },
    }).ok,
  ).toBe(true);
  expect(system.apply({ transport: { bpm: 90 } }).ok).toBe(true);
  pending.splice(0).forEach((run) => run());
  const added = system.masterStrip!.inserts[1]!;
  expect(added.processor!.parameters.get('leftMs')!.value).toBe(500);
  expect(added.processor!.parameters.get('rightMs')!.value).toBe(123);
  system.dispose();
  expect(system.meteredProcessors).toBe(0);
});
