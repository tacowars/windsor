/**
 * The shipped bloom bundle, rendered block by block through
 * `__fixtures__/bloomHarness.ts`: bypass exactness, the switch fade, the
 * generated layer's level and partials at three rates, Amount and Mix, the
 * band range, sleep and waking, block-size independence, and every control
 * reaching its slot.
 */
// reads-by-path: packages/engine/src/worklet/generated/**
import { describe, expect, it } from 'vitest';
import {
  bloomParams,
  bloomRig,
  lineDb,
  loadBloom,
  mixed,
  noise,
  peak,
  renderBloom,
  tone,
} from '../__fixtures__/bloomHarness';
import type { BloomRender, BloomSource } from '../__fixtures__/bloomHarness';
import { INSERT_SWITCH_FADE_S } from './insertConstants';

const RATE = 48000;
const QUANTUM = 128;
const WET = { mix: 1 } as const;
const FADE = Math.round(INSERT_SWITCH_FADE_S * RATE);
/** −12 dBFS peak. */
const LEVEL = 0.25;
/** The target layer at 220 Hz, −12 dBFS: E1 −3.3 dB re the input, E2 6 dB under E1 (a sawtooth). */
const E1_DB = -3.3;
const SAW_STEP_DB = -6.02;
/** Within this of the target level, and of one another across rates. */
const LEVEL_DB = 0.5;
/** Amount 0.5 is (0.5)², −12.04 dB. */
const HALF_AMOUNT_DB = -12.04;
/** Out of range (60 Hz, 1.76 kHz) the layer stays under this, re the input. */
const SILENT_DB = -80;

const seconds = (s: number, rate = RATE): number => Math.round(s * rate);
/** E_k of `hz`'s layer over the settled second [0.6, 1.6) s, in dB re `LEVEL`. */
const partial = (render: BloomRender, hz: number, rate = RATE): number =>
  lineDb(render.left, {
    hz,
    rate,
    from: seconds(0.6, rate),
    to: seconds(1.6, rate),
    reference: LEVEL,
  });

describe('bypass and the switch', () => {
  const input = mixed(tone(330, 0.5, RATE), noise(0.25));
  it.each([{ mix: 0 }, { enabled: false }])('%j gives the stereo input to the bit', (spec) => {
    const out = renderBloom(spec, { seconds: 0.5, source: input });
    for (let i = 0; i < out.left.length; i++) {
      expect(out.left[i]).toBe(Math.fround(input(i, 0)));
      expect(out.right[i]).toBe(Math.fround(input(i, 1)));
    }
  });

  it('crosses on and off linearly over INSERT_SWITCH_FADE_S and lands exactly', () => {
    // Amount 0 at Mix 1 plays input·(1 − level), so a steady input shows the fade itself.
    const on = 10 * QUANTUM,
      off = 20 * QUANTUM;
    const out = renderBloom(
      { mix: 1, amount: 0, enabled: false },
      {
        seconds: 0.1,
        source: () => 0.5,
        onBlock: (f, p) => {
          if (f === on) p.enabled![0] = 1;
          if (f === off) p.enabled![0] = 0;
        },
      },
    ).left;
    for (let k = 0; k < FADE; k++) {
      expect(out[on + k]).toBeCloseTo(0.5 * (1 - (k + 1) / FADE), 6);
      expect(out[off + k]).toBeCloseTo((0.5 * (k + 1)) / FADE, 6);
    }
    expect(peak(out, on + FADE, off)).toBe(0);
    expect([...out.subarray(off + FADE)].every((v) => v === 0.5)).toBe(true);
    expect([...out.subarray(0, on)].every((v) => v === 0.5)).toBe(true);
  });

  it('switching back on starts from rest: the old layer is gone', () => {
    const tail = (switched: boolean): number => {
      const onBlock = (f: number, p: Record<string, Float32Array>): void => {
        if (switched && f === 40 * QUANTUM) p.enabled![0] = 0;
        if (switched && f === 44 * QUANTUM) p.enabled![0] = 1;
      };
      const source = tone(220, LEVEL, RATE, 0, 40 * QUANTUM);
      const out = renderBloom(WET, { seconds: 0.3, source, onBlock });
      return peak(out.left, 44 * QUANTUM, out.left.length);
    };
    expect(tail(false)).toBeGreaterThan(1e-3);
    expect(tail(true)).toBe(0);
  });
});

describe('the generated layer', () => {
  it.each([44100, 48000, 96000])(
    'at %i Hz a −12 dBFS 220 Hz sine makes a sawtooth at the target level',
    (rate) => {
      const out = renderBloom(WET, { rate, seconds: 1.6, source: tone(220, LEVEL, rate) });
      const e1 = partial(out, 220, rate);
      expect(Math.abs(e1 - E1_DB)).toBeLessThan(LEVEL_DB);
      expect(Math.abs(partial(out, 440, rate) - e1 - SAW_STEP_DB)).toBeLessThan(LEVEL_DB);
      expect(out.right).toEqual(out.left);
    },
  );

  it('Mix 50 % is the input plus the layer, and Amount follows its square', () => {
    const source = tone(330, LEVEL, RATE);
    const wet = renderBloom(WET, { seconds: 1.6, source });
    const half = renderBloom({}, { seconds: 1.6, source });
    for (let i = 0; i < wet.left.length; i += 97)
      expect(half.left[i]! - Math.fround(source(i, 0))).toBeCloseTo(wet.left[i]!, 5);
    const quiet = renderBloom({ ...WET, amount: 0.5 }, { seconds: 1.6, source });
    expect(partial(quiet, 330) - partial(wet, 330)).toBeCloseTo(HALF_AMOUNT_DB, 2);
  });

  it.each([60, 1760])('makes nothing of %i Hz, outside its bands', (hz) => {
    const out = renderBloom(WET, { seconds: 1.6, source: tone(hz, LEVEL, RATE) });
    expect(20 * Math.log10(peak(out.left, seconds(0.6)) / LEVEL)).toBeLessThan(SILENT_DB);
  });

  it('renders the same bits in blocks of 128 and 32', () => {
    const source: BloomSource = mixed(tone(262, 0.2, RATE), tone(392, 0.2, RATE), noise(0.05));
    const a = renderBloom({}, { seconds: 0.5, source });
    const b = renderBloom({}, { seconds: 0.5, source, block: 32 });
    expect(b.left).toEqual(a.left);
    expect(b.right).toEqual(a.right);
  });
});

describe('sleep', () => {
  it('sleeps after the layer dies, and wakes to the same bits as a fresh insert', () => {
    const rig = bloomRig({});
    const burst = tone(440, LEVEL, RATE, 0, seconds(0.2));
    rig.render(seconds(0.2), burst);
    let asleepAt = -1;
    rig.render(seconds(4), undefined, {
      afterBlock: (frame, p) => {
        if (asleepAt < 0 && p.dsp.asleep) asleepAt = frame;
      },
    });
    expect(asleepAt).toBeGreaterThan(0);
    expect(rig.processor.dsp.asleep).toBe(true);
    const source = mixed(tone(220, LEVEL, RATE), noise(0.1));
    // The rig reads its source at its own running frame; start the woken one at 0, as the fresh one does.
    const start = (Math.ceil(seconds(0.2) / QUANTUM) + Math.ceil(seconds(4) / QUANTUM)) * QUANTUM;
    const woken = rig.render(seconds(0.5), (f, c) => source(f - start, c));
    const fresh = bloomRig({}).render(seconds(0.5), source);
    expect(woken.left).toEqual(fresh.left);
  });
});

describe('the controls', () => {
  it('every control reaches its slot', () => {
    const spec = {
      amount: 0.5,
      mix: 0.75,
      swell: 3,
      sustain: 9,
      freeze: true,
      spread: 0.4,
      shape: 1.25,
      bright: -4,
      octave: 19,
      key: 'A',
      scale: 'mixolydian',
      low: 45,
      high: 80,
      focus: 1.6,
      density: 0.8,
    } as const;
    const params = bloomParams(spec);
    const processor = loadBloom(RATE, bloomParams());
    const block = [new Float32Array(QUANTUM), new Float32Array(QUANTUM)];
    processor.process([block], [block.map((c) => c.slice())], params);
    // The descriptor (slot) order, `worklet/bloom/bloomSlots.ts`'s BLOOM_SLOT_NAMES.
    const order = [
      'amount',
      'mix',
      'swell',
      'sustain',
      'spread',
      'shape',
      'bright',
      'focus',
    ].concat(['density', 'low', 'high', 'octave', 'key', 'scale', 'freeze', 'enabled']);
    expect(order.slice().sort()).toEqual(Object.keys(params).sort());
    const slots = processor.dsp.slots;
    expect(order.map((_, i) => slots[i])).toEqual(order.map((name) => params[name]![0]));
  });
});
