import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeContext, FakeWorkletNode } from '../__fixtures__/fakeAudioContext';
import { FakeNode, FakeParam } from '../__fixtures__/fakeAudioNodes';
import { AudioSystem } from '../game/audioSystem';
import { FmEngine } from '../synth/fmEngine';
import { FieldNormaliser } from '../song/arrangementFields';
import { COMPRESSOR_INSERT, DEFAULT_COMPRESSOR } from './compressorInsert';
import { COMPRESSOR_NAME } from './compressorConstants';
import { compressorParams } from '../__fixtures__/compressorHarness';
import { makePatch } from '../patch/patch';

class Node extends FakeNode {
  readonly kind = 'compressor';
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
  constructor(
    context: FakeContext,
    readonly options: AudioWorkletNodeOptions,
  ) {
    super(context, 2, 1);
    for (const [key, values] of Object.entries(compressorParams())) {
      this.parameters.set(key, new FakeParam(options.parameterData?.[key] ?? values[0]!));
    }
  }
  protected render(block: number): Float32Array[][] {
    return [this.gather(block)];
  }
}
function install(): void {
  vi.stubGlobal(
    'AudioWorkletNode',
    function (context: FakeContext, name: string, options: AudioWorkletNodeOptions) {
      return name === COMPRESSOR_NAME
        ? new Node(context, options)
        : new FakeWorkletNode(context, name, options);
    },
  );
}
afterEach(() => vi.unstubAllGlobals());

describe('compressor insert integration', () => {
  it('normalizes junk and stepped choices without losing valid settings', () => {
    const n = new FieldNormaliser();
    expect(COMPRESSOR_INSERT.normalise({ ...DEFAULT_COMPRESSOR }, 'x', n)).toEqual(
      DEFAULT_COMPRESSOR,
    );
    expect(n.corrections).toEqual([]);
    const fixed = COMPRESSOR_INSERT.normalise(
      {
        kind: 'compressor',
        attack: 9,
        threshold: NaN,
        ratio: 99,
        mix: -1,
        enabled: 'false',
        alien: true,
      },
      'x',
      n,
    );
    expect(fixed).toMatchObject({
      attack: 10,
      threshold: DEFAULT_COMPRESSOR.threshold,
      ratio: 10,
      mix: 0,
      enabled: true,
    });
    expect(n.corrections).toHaveLength(6);
  });
  it('builds separate program/detector edges, sets only params, and disposes its own graph', () => {
    install();
    const context = new FakeContext();
    const stage = COMPRESSOR_INSERT.create(context.asAudioContext(), DEFAULT_COMPRESSOR);
    const node = stage.processor as unknown as Node;
    const edges = context.nodes.map((n) => [...n.outbound]);
    stage.set({ ...DEFAULT_COMPRESSOR, makeup: 6, enabled: false });
    stage.detector!.setExternal(true);
    expect(context.nodes.map((n) => n.outbound)).toEqual(edges);
    expect(node.parameters.get('enabled')!.value).toBe(0);
    expect(node.parameters.get('external')!.value).toBe(1);
    expect(node.parameters.get('makeup')!.value).toBe(6);
    stage.reduction!.setActive(true);
    stage.reduction!.setActive(true);
    expect(node.posted).toEqual([{ type: 'meter', enabled: true }]);
    node.port.dispatchEvent(new MessageEvent('message', { data: { type: 'reduction', db: 5 } }));
    expect(stage.reduction!.read()).toBe(5);
    const output = stage.output as unknown as FakeNode;
    output.connect(context.destination);
    stage.dispose();
    expect(node.posted).toContainEqual({ type: 'stop' });
    expect(node.port.close).toHaveBeenCalledOnce();
    expect(output.outbound).toHaveLength(1);
    expect(context.nodes.filter((n) => n !== output && n.outbound.length > 0)).toEqual([]);
  });
  it('attaches load exactly once, preserves it across edits/reorder, and removes it on disposal', async () => {
    install();
    const context = new FakeContext();
    const engine = new FmEngine(context.asAudioContext());
    const system = new AudioSystem(engine, { defer: (run) => run() });
    await system.init();
    system.createMusicPart('test', makePatch());
    const strip = system.strip('test')!;
    const before = system.meteredProcessors;
    strip.setInserts([DEFAULT_COMPRESSOR]);
    const stage = strip.inserts[0]!;
    expect(system.meteredProcessors).toBe(before + 1);
    const node = stage.processor as unknown as Node;
    expect(node.posted).toContainEqual(expect.objectContaining({ type: 'reportLoad' }));
    strip.setInserts([{ ...DEFAULT_COMPRESSOR, threshold: -20 }]);
    expect(strip.inserts[0]).toBe(stage);
    expect(node.parameters.get('threshold')!.value).toBe(-20);
    // Reorder with another kind keeps this processor and its detector state.
    const { DEFAULT_DRIVE } = await import('./driveInsert');
    strip.setInserts([DEFAULT_COMPRESSOR, DEFAULT_DRIVE]);
    const moved = strip.inserts[0];
    strip.setInserts([DEFAULT_DRIVE, DEFAULT_COMPRESSOR]);
    expect(strip.inserts[1]).toBe(moved);
    expect(system.meteredProcessors).toBe(before + 1);
    strip.setInserts([]);
    expect(system.meteredProcessors).toBe(before);
    system.dispose();
    expect(system.meteredProcessors).toBe(0);
  });
});
