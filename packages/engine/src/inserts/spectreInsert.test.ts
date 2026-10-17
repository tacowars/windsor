import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeContext, FakeWorkletNode } from '../__fixtures__/fakeAudioContext';
import { FakeNode, FakeParam } from '../__fixtures__/fakeAudioNodes';
import { spectreParams } from '../__fixtures__/spectreHarness';
import { spectreCellPayload, spectreRampCells } from './spectreCells';
import { SPECTRE_NAME, SPECTRE_PITCHES_ALL } from './spectreConstants';
import { SPECTRE_INSERT } from './spectreInsert';
import { DEFAULT_SPECTRE } from './spectreSpec';

/** A fake node with Spectre's params; its port records what is posted. */
class SpectreNode extends FakeNode {
  readonly kind = 'spectre';
  readonly parameters = new Map<string, FakeParam>();
  readonly posted: unknown[] = [];
  readonly listeners = new Set<(event: { data: unknown }) => void>();
  readonly port = {
    postMessage: (data: unknown): void => {
      this.posted.push(data);
    },
    addEventListener: (_: string, listener: (event: { data: unknown }) => void): void => {
      this.listeners.add(listener);
    },
    removeEventListener: (_: string, listener: (event: { data: unknown }) => void): void => {
      this.listeners.delete(listener);
    },
    start: vi.fn(),
    close: vi.fn(),
    onmessage: null,
  };
  readonly options: AudioWorkletNodeOptions;
  constructor(context: FakeContext, options: AudioWorkletNodeOptions) {
    super(context, 1, 1);
    this.options = options;
    for (const [key, value] of Object.entries(spectreParams()))
      this.parameters.set(key, new FakeParam(options.parameterData?.[key] ?? value[0]!));
  }
  protected render(block: number): Float32Array[][] {
    return [this.gather(block)];
  }
}

afterEach(() => vi.unstubAllGlobals());

describe('the Spectre stage', () => {
  it('writes params without re-wiring, folds the tempo in, hands lanes its moves, and stops on dispose', () => {
    vi.stubGlobal(
      'AudioWorkletNode',
      function (context: FakeContext, name: string, options: AudioWorkletNodeOptions) {
        return name === SPECTRE_NAME
          ? new SpectreNode(context, options)
          : new FakeWorkletNode(context, name, options);
      },
    );
    const context = new FakeContext();
    const stage = SPECTRE_INSERT.create(context.asAudioContext(), DEFAULT_SPECTRE);
    const node = stage.processor as unknown as SpectreNode;
    const value = (name: string): number => node.parameters.get(name)!.value;
    // Two beats and a sixteenth at the default tempo.
    expect([value('timeMs'), value('gridMs')]).toEqual([1000, 125]);
    const edges = context.nodes.map((n) => [...n.outbound]);
    stage.setTempo!(150);
    expect([value('timeMs'), value('gridMs')]).toEqual([800, 100]);
    stage.set({ ...DEFAULT_SPECTRE, sync: false, timeMs: 333, delayShift: 1.5, mod: 'comb' });
    expect([value('timeMs'), value('delayShift'), value('mod')]).toEqual([333, 1.5, 5]);
    expect(context.nodes.map((n) => n.outbound)).toEqual(edges);
    for (const field of ['delayShift', 'gainOffset', 'spread', 'freeze', 'modA', 'mix', 'enabled'])
      expect(stage.param!(field), field).toBeDefined();
    for (const field of ['curves', 'bands', 'mod', 'grid', 'sync'])
      expect(stage.param!(field), field).toBeUndefined();
    stage.dispose();
    expect(node.posted).toEqual([{ type: 'stop' }]);
    expect(node.port.close).toHaveBeenCalledOnce();
    expect(node.listeners.size).toBe(0);
  });

  it('hands its cells over at construction and posts them again only when a set changes them', () => {
    vi.stubGlobal(
      'AudioWorkletNode',
      function (context: FakeContext, _: string, options: AudioWorkletNodeOptions) {
        return new SpectreNode(context, options);
      },
    );
    const context = new FakeContext();
    const stage = SPECTRE_INSERT.create(context.asAudioContext(), DEFAULT_SPECTRE);
    const node = stage.processor as unknown as SpectreNode;
    expect((node.options.processorOptions as { cells: Float32Array }).cells).toEqual(
      spectreCellPayload(DEFAULT_SPECTRE),
    );
    stage.set({ ...DEFAULT_SPECTRE, mix: 0.9 });
    expect(node.posted).toEqual([]);
    const moved = {
      ...DEFAULT_SPECTRE,
      curves: {
        ...DEFAULT_SPECTRE.curves,
        delay: { left: spectreRampCells(0.5, 0.1), link: true, steps: true },
      },
      selection: [[10, 20]] as const,
    };
    stage.set(moved);
    expect(node.posted).toEqual([{ type: 'cells', cells: spectreCellPayload(moved) }]);
    stage.set({ ...moved });
    expect(node.posted).toHaveLength(1);
  });

  it('turns its scope and Listen on and off by message, and reads the reports it is posted', () => {
    vi.stubGlobal(
      'AudioWorkletNode',
      function (context: FakeContext, _: string, options: AudioWorkletNodeOptions) {
        return new SpectreNode(context, options);
      },
    );
    const context = new FakeContext();
    const stage = SPECTRE_INSERT.create(context.asAudioContext(), DEFAULT_SPECTRE);
    const node = stage.processor as unknown as SpectreNode;
    const scope = stage.spectreScope!;
    scope.setActive(true);
    scope.setActive(true);
    scope.setListen(true);
    expect(node.posted).toEqual([
      { type: 'scope', enabled: true },
      { type: 'listen', enabled: true },
    ]);
    const input = new Float32Array(360).fill(0.5),
      output = new Float32Array(360).fill(0.25);
    for (const listener of node.listeners)
      listener({ data: { type: 'scope', input, output, lfo: -0.5 } });
    expect(scope.read()).toEqual({ input, output, lfo: -0.5, reports: 1 });
    scope.setActive(false);
    expect(scope.read().input).toBeNull();
  });
});

describe('the Spectre stage’s Follow', () => {
  it('holds every pitch class, the key, or the chords scheduled, as Follow asks', () => {
    vi.stubGlobal(
      'AudioWorkletNode',
      function (context: FakeContext, _: string, options: AudioWorkletNodeOptions) {
        return new SpectreNode(context, options);
      },
    );
    const context = new FakeContext();
    const stage = SPECTRE_INSERT.create(context.asAudioContext(), DEFAULT_SPECTRE);
    const node = stage.processor as unknown as SpectreNode;
    const pitches = node.parameters.get('pitches')!;
    expect(pitches.value).toBe(SPECTRE_PITCHES_ALL);
    // C major: C D E F G A B.
    stage.setHarmony!(0, 'major');
    expect(pitches.value).toBe(SPECTRE_PITCHES_ALL);
    stage.set({ ...DEFAULT_SPECTRE, follow: 'key' });
    expect(pitches.value).toBe(0b101010110101);
    stage.setChord!(0b000010010001, 0, false);
    expect(pitches.value).toBe(0b101010110101);
    stage.set({ ...DEFAULT_SPECTRE, follow: 'chord' });
    expect(pitches.value).toBe(0b000010010001);
    stage.setChord!(0b000100100001, 1, true);
    expect(pitches.automation.at(-1)).toEqual({
      call: 'setValueAtTime',
      value: 0b000100100001,
      time: 1,
    });
    stage.set({ ...DEFAULT_SPECTRE, follow: 'off' });
    expect(pitches.value).toBe(SPECTRE_PITCHES_ALL);
  });
});
