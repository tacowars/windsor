/**
 * The Transient insert's stage and its place in a song (record
 * `2026-10-18-transient-insert`): the stage writes its params without
 * re-wiring and hands lanes its four knobs and its switch; it relays the
 * meter only while the card asks; and a song with a Transient on a part
 * saves, reloads and renders the same: the reloaded spec is the saved one,
 * and the shipped bundle plays both to the same bits.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeContext, FakeWorkletNode } from '../__fixtures__/fakeAudioContext';
import { FakeNode, FakeParam } from '../__fixtures__/fakeAudioNodes';
import { FULL_ARRANGEMENT } from '../__fixtures__/fullArrangement';
import {
  hit,
  loadTransient,
  runTransient,
  transientParams,
} from '../__fixtures__/transientHarness';
import { ARRANGEMENT_VERSION } from '../audioConstants';
import { makeArrangement } from '../song/arrangementDocument';
import { FieldNormaliser } from '../song/arrangementFields';
import { TRANSIENT_NAME } from './transientConstants';
import { TRANSIENT_INSERT } from './transientInsert';
import { DEFAULT_TRANSIENT, normaliseTransient } from './transientSpec';
import type { TransientSpec } from './transientSpec';

/** A fake node with the Transient's params; its port records what is posted. */
class TransientNode extends FakeNode {
  readonly kind = 'transient';
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
    super(context, 1, 1);
    for (const [key, value] of Object.entries(transientParams()))
      this.parameters.set(key, new FakeParam(options.parameterData?.[key] ?? value[0]!));
  }
  protected render(block: number): Float32Array[][] {
    return [this.gather(block)];
  }
}

const installTransientNode = (): void => {
  vi.stubGlobal(
    'AudioWorkletNode',
    function (context: FakeContext, name: string, options: AudioWorkletNodeOptions) {
      return name === TRANSIENT_NAME
        ? new TransientNode(context, options)
        : new FakeWorkletNode(context, name, options);
    },
  );
};

afterEach(() => vi.unstubAllGlobals());

const SHAPED: TransientSpec = {
  ...DEFAULT_TRANSIENT,
  attack: 10,
  sustain: -12,
  output: -3,
  mix: 0.8,
};

describe('the Transient stage', () => {
  it('writes params without re-wiring and hands lanes its knobs and its switch', () => {
    installTransientNode();
    const context = new FakeContext();
    const stage = TRANSIENT_INSERT.create(context.asAudioContext(), SHAPED);
    const node = stage.processor as unknown as TransientNode;
    const value = (name: string): number => node.parameters.get(name)!.value;
    expect([value('attack'), value('sustain'), value('output'), value('mix')]).toEqual([
      10, -12, -3, 0.8,
    ]);
    const edges = context.nodes.map((n) => [...n.outbound]);
    stage.set({ ...SHAPED, attack: -15, enabled: false });
    expect([value('attack'), value('enabled')]).toEqual([-15, 0]);
    expect(context.nodes.map((n) => [...n.outbound])).toEqual(edges);
    for (const field of ['attack', 'sustain', 'output', 'mix', 'enabled'])
      expect(stage.param!(field), field).toBeDefined();
    expect(stage.param!('kind')).toBeUndefined();
  });

  it('relays the meter only while active, and stops and closes on dispose', () => {
    installTransientNode();
    const stage = TRANSIENT_INSERT.create(new FakeContext().asAudioContext(), DEFAULT_TRANSIENT);
    const node = stage.processor as unknown as TransientNode;
    const shaping = stage.shaping!;
    shaping.setActive(true);
    shaping.setActive(true);
    node.port.dispatchEvent(
      new MessageEvent('message', { data: { type: 'shaping', boost: 9.5, cut: -14 } }),
    );
    expect(shaping.read()).toEqual({ boost: 9.5, cut: -14 });
    node.port.dispatchEvent(new MessageEvent('message', { data: { type: 'shaping', boost: NaN } }));
    expect(shaping.read()).toEqual({ boost: 9.5, cut: -14 });
    shaping.setActive(false);
    expect(shaping.read()).toEqual({ boost: 0, cut: 0 });
    stage.dispose();
    expect(node.posted).toEqual([
      { type: 'meter', enabled: true },
      { type: 'meter', enabled: false },
      { type: 'stop' },
    ]);
    expect(node.port.close).toHaveBeenCalledOnce();
  });
});

describe('a Transient in a song', () => {
  it('reads its defaults back unchanged and clamps each knob to its range', () => {
    const n = new FieldNormaliser();
    expect(normaliseTransient({ ...DEFAULT_TRANSIENT }, 't', n)).toEqual(DEFAULT_TRANSIENT);
    expect(n.corrections).toEqual([]);
    const clamped = normaliseTransient(
      { kind: 'transient', attack: 40, sustain: -99, output: 12, mix: 2, threshold: -20 },
      't',
      n,
    );
    expect(clamped).toEqual({ ...DEFAULT_TRANSIENT, attack: 15, sustain: -24, output: 6, mix: 1 });
    expect(n.corrections.length).toBeGreaterThanOrEqual(5);
  });

  it('saves, reloads and renders the same', () => {
    const raw = {
      ...FULL_ARRANGEMENT,
      version: ARRANGEMENT_VERSION,
      patches: { kick: {}, hat: {}, 'saw-arp': {}, 'drone-sqr': {} },
      parts: FULL_ARRANGEMENT.parts.map((part, i) =>
        i === 0 ? { ...part, strip: { inserts: [SHAPED] } } : part,
      ),
    };
    const saved = makeArrangement(raw);
    expect(saved.corrections).toEqual([]);
    const reloaded = makeArrangement(JSON.parse(JSON.stringify(saved.document)));
    expect(reloaded.corrections).toEqual([]);
    const specOf = (r: typeof saved): TransientSpec =>
      r.document.parts[0]!.strip!.inserts![0] as TransientSpec;
    // The song gave it an id; everything else is the spec as saved.
    expect({ ...specOf(reloaded), id: undefined }).toEqual(SHAPED);
    expect(specOf(reloaded)).toEqual(specOf(saved));
    const play = (s: TransientSpec): Float32Array => {
      const params = transientParams(s);
      return runTransient(loadTransient(48000, params), hit(24000, 48000), params).left;
    };
    expect(play(specOf(reloaded))).toEqual(play(specOf(saved)));
  });
});
