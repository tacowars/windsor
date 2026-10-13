import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeContext, FakeWorkletNode } from '../__fixtures__/fakeAudioContext';
import { FakeNode, FakeParam } from '../__fixtures__/fakeAudioNodes';
import { pumpParams } from '../__fixtures__/pumpHarness';
import { sidechainRig } from '../__fixtures__/sidechainRig';
import { fake, sources } from '../__fixtures__/stripRig';
import { musicPartName } from '../song/documentParts';
import { PUMP_DSP, PUMP_NAME } from './pumpConstants';
import { PUMP_INSERT } from './pumpInsert';
import { DEFAULT_PUMP } from './pumpSpec';

/** A fake node with the Pump's params and two inputs; its port records what is posted. */
class PumpNode extends FakeNode {
  readonly kind = 'pump';
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
  constructor(context: FakeContext, options: AudioWorkletNodeOptions) {
    super(context, 2, 1);
    for (const [key, value] of Object.entries(pumpParams()))
      this.parameters.set(key, new FakeParam(options.parameterData?.[key] ?? value[0]!));
  }
  protected render(block: number): Float32Array[][] {
    return [this.gather(block)];
  }
}

const installPumpNode = (): void => {
  vi.stubGlobal(
    'AudioWorkletNode',
    function (context: FakeContext, name: string, options: AudioWorkletNodeOptions) {
      return name === PUMP_NAME
        ? new PumpNode(context, options)
        : new FakeWorkletNode(context, name, options);
    },
  );
};

afterEach(() => vi.unstubAllGlobals());

describe('the Pump stage', () => {
  it('writes params without re-wiring, folds the tempo into a synced length, and hands lanes its knobs', () => {
    installPumpNode();
    const context = new FakeContext();
    const stage = PUMP_INSERT.create(context.asAudioContext(), DEFAULT_PUMP);
    const node = stage.processor as unknown as PumpNode;
    const value = (name: string): number => node.parameters.get(name)!.value;
    // A beat at the default tempo.
    expect(value('lengthMs')).toBe(60000 / PUMP_DSP.defaultBpm);
    expect(value('count')).toBe(DEFAULT_PUMP.points.length);
    const edges = context.nodes.map((n) => [...n.outbound]);
    stage.setTempo!(150);
    expect(value('lengthMs')).toBe(400);
    stage.set({ ...DEFAULT_PUMP, sync: false, lengthMs: 333, depth: 0.5 });
    expect([value('lengthMs'), value('depth')]).toEqual([333, 0.5]);
    expect(context.nodes.map((n) => n.outbound)).toEqual(edges);
    for (const field of ['depth', 'lengthMs', 'sensitivity', 'holdMs', 'smoothMs', 'enabled'])
      expect(stage.param!(field), field).toBeDefined();
    for (const field of ['points', 'division', 'sync', 'sidechain'])
      expect(stage.param!(field), field).toBeUndefined();
    stage.detector!.setExternal(true);
    expect(value('external')).toBe(1);
  });

  it('relays the scope only while active, and stops and closes on dispose', () => {
    installPumpNode();
    const stage = PUMP_INSERT.create(new FakeContext().asAudioContext(), DEFAULT_PUMP);
    const node = stage.processor as unknown as PumpNode;
    const scope = stage.pumpScope!;
    scope.setActive(true);
    scope.setActive(true);
    const levels = new Float32Array(PUMP_DSP.scopeBins).fill(0.5);
    node.port.dispatchEvent(new MessageEvent('message', { data: { type: 'trace', levels } }));
    node.port.dispatchEvent(
      new MessageEvent('message', { data: { type: 'phase', phase: 0.25, gain: 0.3 } }),
    );
    expect(scope.read()).toEqual({ trace: levels, traces: 1, phase: 0.25, gain: 0.3 });
    scope.setActive(false);
    expect(scope.read().trace).toBeNull();
    stage.dispose();
    expect(node.posted).toEqual([
      { type: 'scope', enabled: true },
      { type: 'scope', enabled: false },
      { type: 'stop' },
    ]);
    expect(node.port.close).toHaveBeenCalledOnce();
  });

  it('keys from another part through the mixer’s sidechain routing', async () => {
    installPumpNode();
    const { system } = await sidechainRig();
    system.apply({
      parts: { 1: { strip: { inserts: [{ ...DEFAULT_PUMP, sidechain: { track: 0 } }] } } },
    });
    const strip = (slot: number) => system.strip(musicPartName(slot))!;
    const stage = strip(1).inserts[0]!;
    expect(stage.kind).toBe('pump');
    expect(sources(stage.detector!.input)).toEqual([fake(strip(0).head)]);
    expect(stage.processor!.parameters.get('external')!.value).toBe(1);
    system.dispose();
  });
});
