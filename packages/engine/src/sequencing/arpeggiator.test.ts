import { describe, expect, it } from 'vitest';

import {
  ARP_WALK_MODES,
  Arpeggiator,
  DEFAULT_ARPEGGIATOR_CONFIG,
  type ArpeggiatorConfig,
} from './arpeggiator';
import type { NoteEvent } from './noteEvent';
import { ScaleSampler, uniformWeights } from './scaleSampler';
import { TICKS_PER_BAR, TickTransport } from './scheduler';

const sampler = new ScaleSampler({ root: 48, scale: 'dorian', weights: uniformWeights('dorian') });

function make(extra: Partial<ArpeggiatorConfig> = {}): Arpeggiator {
  return new Arpeggiator(sampler, { ...DEFAULT_ARPEGGIATOR_CONFIG, ...extra });
}

/** Run for `bars` and return the events emitted per step (empty for a rest). */
function run(arp: Arpeggiator, bars: number): NoteEvent[][] {
  const transport = new TickTransport(120);
  const steps: NoteEvent[][] = [];
  transport.subscribe(arp.config.divisor, (e) => steps.push(arp.handleTick(e)));
  for (let i = 0; i < bars * TICKS_PER_BAR; i++) transport.advance(i * transport.secondsPerTick);
  return steps;
}

const noteOns = (steps: NoteEvent[][]) =>
  steps.flat().filter((e): e is Extract<NoteEvent, { kind: 'noteOn' }> => e.kind === 'noteOn');

describe('Arpeggiator', () => {
  it('skip 0 plays every pool step; skip 1 is silence', () => {
    const every = run(make({ skipChance: 0 }), 4);
    expect(every).toHaveLength(64);
    for (const step of every) expect(step.map((e) => e.kind)).toEqual(['noteOn', 'noteOff']);
    const none = run(make({ skipChance: 1 }), 4);
    expect(none.flat()).toEqual([]);
  });

  it('emits the note-off a gate fraction of the step later, with the matching time', () => {
    const steps = run(make({ skipChance: 0, gate: 0.5, divisor: 12 }), 1);
    for (const [on, off] of steps) {
      expect(on!.kind).toBe('noteOn');
      expect(off!.kind).toBe('noteOff');
      expect(off!.tick - on!.tick).toBe(6);
      expect(off!.time - on!.time).toBeCloseTo((6 * 0.5) / 24, 12);
      expect(off!.note).toBe(on!.note);
    }
  });

  it('walks the pool up', () => {
    const arp = make({ skipChance: 0, walk: 'up', refreshBars: 64 });
    const notes = noteOns(run(arp, 2)).map((e) => e.note);
    const pool = arp.currentPool.map((p) => p.note);
    expect(pool.length).toBeGreaterThan(1);
    expect(notes.slice(0, pool.length * 3)).toEqual([...pool, ...pool, ...pool]);
  });

  it('walks the pool down', () => {
    const arp = make({ skipChance: 0, walk: 'down', refreshBars: 64 });
    const notes = noteOns(run(arp, 2)).map((e) => e.note);
    const pool = arp.currentPool.map((p) => p.note).reverse();
    expect(pool.length).toBeGreaterThan(1);
    expect(notes.slice(0, pool.length * 3)).toEqual([...pool, ...pool, ...pool]);
  });

  it('walks the pool up then down without repeating the turnaround note', () => {
    const arp = make({ skipChance: 0, walk: 'updown', refreshBars: 64, poolSize: 7 });
    const notes = noteOns(run(arp, 2)).map((e) => e.note);
    const pool = arp.currentPool.map((p) => p.note);
    expect(pool.length).toBeGreaterThan(2);
    const cycle = [...pool, ...pool.slice(1, -1).reverse()];
    expect(notes.slice(0, cycle.length * 2)).toEqual([...cycle, ...cycle]);
  });

  it('random visits every pool note in no fixed order', () => {
    const arp = make({ skipChance: 0, walk: 'random', refreshBars: 64, poolSize: 7 });
    const notes = noteOns(run(arp, 8)).map((e) => e.note);
    const pool = arp.currentPool.map((p) => p.note);
    expect(new Set(notes)).toEqual(new Set(pool));
    expect(notes.slice(0, pool.length)).not.toEqual(pool);
    for (const n of notes) expect(pool).toContain(n);
  });

  it('every walk mode keeps to the pool', () => {
    for (const walk of ARP_WALK_MODES) {
      const arp = make({ walk, skipChance: 0.3, refreshBars: 2 });
      const pools = new Set<number>();
      const transport = new TickTransport(120);
      transport.subscribe(arp.config.divisor, (e) => {
        for (const ev of arp.handleTick(e)) {
          pools.add(ev.note);
          expect(arp.currentPool.map((p) => p.note)).toContain(ev.note);
        }
      });
      for (let i = 0; i < 4 * TICKS_PER_BAR; i++) transport.advance(i / 48);
      expect(pools.size).toBeGreaterThan(0);
    }
  });

  it('refreshes the pool only on a bar line that is a multiple of refreshBars', () => {
    const arp = make({ skipChance: 0, refreshBars: 2, poolSize: 5 });
    const transport = new TickTransport(120);
    const seen: { tick: number; tickInBar: number; bar: number; pool: string }[] = [];
    transport.subscribe(arp.config.divisor, (e) => {
      arp.handleTick(e);
      seen.push({
        tick: e.tick,
        tickInBar: e.tickInBar,
        bar: e.bar,
        pool: arp.currentPool.map((p) => p.note).join(','),
      });
    });
    for (let i = 0; i < 8 * TICKS_PER_BAR; i++) transport.advance(i / 48);
    let changes = 0;
    for (let i = 1; i < seen.length; i++) {
      if (seen[i]!.pool !== seen[i - 1]!.pool) {
        changes++;
        expect(seen[i]!.tickInBar).toBe(0);
        expect(seen[i]!.bar % 2).toBe(0);
      }
    }
    expect(changes).toBeGreaterThan(0);
  });

  it('attached mid-bar, draws its first pool at once and then only on refresh bar lines', () => {
    const arp = make({ skipChance: 0, refreshBars: 2 });
    const transport = new TickTransport(120);
    const pools: { tick: number; pool: string }[] = [];
    transport.subscribe(arp.config.divisor, (e) => {
      arp.handleTick(e);
      pools.push({ tick: e.tick, pool: arp.currentPool.map((p) => p.note).join(',') });
    });
    transport.reset(30);
    for (let i = 0; i < 4 * TICKS_PER_BAR; i++) transport.advance(0);
    expect(pools[0]!.pool).not.toBe('');
    const changes = pools.filter((p, i) => i > 0 && p.pool !== pools[i - 1]!.pool);
    expect(changes.length).toBeGreaterThan(0);
    for (const c of changes) expect(c.tick % (2 * TICKS_PER_BAR)).toBe(0);
  });

  it('keeps the pool sorted ascending and free of duplicate notes', () => {
    const arp = make({ poolSize: 12, register: { octave: 1, span: 1 } });
    run(arp, 1);
    const notes = arp.currentPool.map((p) => p.note);
    expect(notes).toEqual([...new Set(notes)].sort((a, b) => a - b));
    expect(notes.length).toBeLessThanOrEqual(7);
  });

  it('is reproducible for a seed', () => {
    const a = run(make({ seed: 5 }), 8);
    const b = run(make({ seed: 5 }), 8);
    const c = run(make({ seed: 6 }), 8);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(c));
  });

  it('rejects a gate outside (0, 1] and a divisor that does not nest in the bar', () => {
    expect(() => make({ gate: 0 })).toThrow(RangeError);
    expect(() => make({ gate: 1.2 })).toThrow(RangeError);
    expect(() => make({ divisor: 7 })).toThrow(RangeError);
    expect(() => make({ poolSize: 0 })).toThrow(RangeError);
    expect(() => make({ skipChance: 1.2 })).toThrow(RangeError);
    expect(() => make({ skipChance: -0.1 })).toThrow(RangeError);
  });
});
