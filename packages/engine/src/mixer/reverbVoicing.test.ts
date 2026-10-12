/**
 * The plate's voicing (windsor#746, `worklet/reverb/plateVoicing.ts`): a row
 * of tables, `plate` at 0 and `room` at 1, that one tank reads. Both rows
 * have one shape; a switch ducks the wet output and the tank's feed, renders
 * the duck with the parameters as they stood, swaps the tables at silence
 * and fades back in, so a switch with a tail ringing and a drum loop playing
 * steps no further than the loop through a still plate, and the tail rings
 * on; a switch while asleep applies at once; and each row's times are
 * seconds at any rate. The onset, the T30, the sides, the level, the mono
 * sum, the whole box and the CPU are measured in
 * `docs/research/2026-10-12-plate-room-voicing/`.
 */
import { describe, expect, it } from 'vitest';

import type { Automate, Feed, ReverbProcessorLike } from '../__fixtures__/reverbHarness';
import {
  channel,
  internals,
  loadReverb,
  renderReverb,
  spaceParams,
} from '../__fixtures__/reverbHarness';
import { SPACES } from './reverbSpace';

const loaded = loadReverb();
const SR = loaded.sampleRate;
const BLOCK = 128;
const blockAt = (seconds: number): number => Math.round((seconds * SR) / BLOCK);
/** A tail that rings through the switches: Decay 10 s (the issue's). */
const RINGING = { decay: 10 };

/** A 0.4 s burst for a tail, then a kick every 0.5 s and a hat every 0.25 s. */
function drums(): Feed {
  let seed = 1;
  const noise = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x80000000 - 1;
  };
  return (block, left, right) => {
    for (let i = 0; i < left.length; i++) {
      const t = (block * BLOCK + i) / SR;
      const beat = t % 0.5;
      let v = t < 0.4 ? noise() * 0.5 : 0;
      if (t >= 0.5) v += Math.sin(2 * Math.PI * 55 * beat) * Math.exp(-beat / 0.08) * 0.8;
      if (t >= 0.5 && t % 0.25 < 0.004) v += noise() * 0.4;
      left[i] = right[i] = v;
    }
  };
}

/** The largest step on either side from 1 s on, where the switches start. */
function stepFrom1s(params: Record<string, number>, automate: Automate, seconds = 5): number {
  const { samples } = renderReverb(loaded, seconds, drums(), params, {
    automate,
    collectSamples: true,
  });
  let step = 0;
  for (const side of [0, 1] as const) {
    const x = channel(samples, side, SR);
    for (let i = 1; i < x.length; i++) step = Math.max(step, Math.abs(x[i]! - x[i - 1]!));
  }
  return step;
}

/** `values` set to every field of `space` at once, as a starting point writes them. */
const writeSpace = (values: Record<string, Float32Array>, space: Record<string, number>): void => {
  for (const [name, value] of Object.entries(space)) values[name]![0] = value;
};

const PLATE_HALL = spaceParams({ ...SPACES.hall, voicing: 'plate', decay: 10 });
const ROOM_SPACE = spaceParams({ ...SPACES.room, voicing: 'room', decay: 10 });

/** Each switch, as automation from 2 s: the issue's four, each way where it has two. */
const switches: [string, Record<string, number>, Automate][] = [
  [
    'a starting point plate to room, and back',
    PLATE_HALL,
    (block, values) => {
      if (block === blockAt(2)) writeSpace(values, ROOM_SPACE);
      if (block === blockAt(3)) writeSpace(values, PLATE_HALL);
    },
  ],
  [
    'the voicing alone, plate to room and back',
    { ...RINGING, voicing: 0 },
    (block, values) => {
      values.voicing![0] = block >= blockAt(2) && block < blockAt(3) ? 1 : 0;
    },
  ],
  [
    'the voicing alone, room to plate and back',
    { ...RINGING, voicing: 1 },
    (block, values) => {
      values.voicing![0] = block >= blockAt(2) && block < blockAt(3) ? 0 : 1;
    },
  ],
  [
    'a flip back during the duck',
    { ...RINGING, voicing: 0 },
    (block, values) => {
      values.voicing![0] = block === blockAt(2) ? 1 : 0;
    },
  ],
  [
    'the voicing alone with HOLD on',
    { ...RINGING, voicing: 0 },
    (block, values) => {
      values.hold![0] = block >= blockAt(1.5) && block < blockAt(3.5) ? 1 : 0;
      values.voicing![0] = block >= blockAt(2) && block < blockAt(3) ? 1 : 0;
    },
  ],
];

describe('switching voicing (record 2026-08-31-dattorro-reverb-not-plateau §3)', () => {
  /** The loop's largest step through a still plate: each voicing, and each starting point. */
  let still = 0;
  const stillStep = (): number =>
    (still ||= Math.max(
      ...[{ ...RINGING, voicing: 0 }, { ...RINGING, voicing: 1 }, PLATE_HALL, ROOM_SPACE].map(
        (params) => stepFrom1s(params, () => {}),
      ),
    ));

  it.each(switches)(
    '%s steps no further than a drum loop through a still plate',
    (_, params, automate) => {
      expect(stepFrom1s(params, automate)).toBeLessThanOrEqual(stillStep());
    },
    60_000,
  );

  /** A steady 220 Hz tone at 0.3, the signal a step is judged against. */
  const tone: Feed = (block, left, right) => {
    for (let i = 0; i < left.length; i++) {
      left[i] = right[i] = Math.sin((2 * Math.PI * 220 * (block * BLOCK + i)) / SR) * 0.3;
    }
  };

  // Not the starting point: its Size falls from 1.4 to 0.28 in Size's 50 ms
  // glide, whose Doppler outruns a tone's slew with or without a voicing
  // (on `main` too: the research note's "Switching").
  it.each(switches.slice(1))(
    '%s steps no further than a steady tone slews',
    (_, params, automate) => {
      const result = renderReverb(loaded, 4, tone, params, automate);
      expect(result.nonFinite).toBe(0);
      expect(result.maxStep).toBeLessThan(((2 * Math.PI * 220) / SR) * result.peak * 3);
    },
    60_000,
  );

  it.each(switches)(
    '%s leaves the tail ringing',
    (_, params, automate) => {
      // The burst alone, then nothing: what follows each switch is the tail.
      const burst: Feed = (block, left, right) => {
        if (block >= blockAt(0.4)) return;
        drums()(block, left, right);
      };
      const { trace } = renderReverb(loaded, 4, burst, params, automate);
      for (const at of [2, 3]) {
        const before = trace[blockAt(at) - 4]!;
        const after = trace[blockAt(at) + 8]!;
        expect(after, `at ${at} s`).toBeGreaterThan(before * 0.25);
      }
    },
    60_000,
  );
});

describe('the duck', () => {
  /** Render quanta of a centred noise into a plate, moving parameters at each block. */
  function run(
    blocks: number,
    automate: Automate,
    watch: (b: number, p: ReverbProcessorLike) => void,
  ) {
    let seed = 7;
    const feed: Feed = (_, left, right) => {
      for (let i = 0; i < BLOCK; i++) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        left[i] = right[i] = (seed / 0x80000000 - 1) * 0.3;
      }
    };
    renderReverb(loaded, (blocks * BLOCK) / SR, feed, {}, { automate, afterBlock: watch });
  }

  it('renders the duck with the fields as they stood, and takes the new ones at silence', () => {
    const at = blockAt(1);
    const states: number[] = [];
    const voicings: number[] = [];
    run(
      at + 8,
      (block, values) => {
        // A starting point writes every field in the block the voicing moves.
        if (block === at) {
          values.voicing![0] = 1;
          values.wet![0] = 0;
        }
      },
      (block, processor) => {
        if (block < at) return;
        states.push(internals(processor)._duckState);
        voicings.push(internals(processor)._voicing);
      },
    );
    // Down over 5 ms (240 samples at 48 kHz: two quanta), still the plate's
    // row; silence at the next boundary swaps it and fades in; then done.
    expect(states.slice(0, 2)).toEqual([1, 1]);
    expect(voicings.slice(0, 2)).toEqual([0, 0]);
    expect(states[2]).toBe(2);
    expect(voicings[2]).toBe(1);
    expect(states.at(-1)).toBe(0);
  });

  it('takes a change during the fade down at its silence, with no second duck', () => {
    const at = blockAt(1);
    const states: number[] = [];
    run(
      at + 8,
      (block, values) => {
        values.voicing![0] = block === at ? 1 : 0;
      },
      (block, processor) => {
        if (block >= at) states.push(internals(processor)._duckState);
      },
    );
    expect(states.slice(0, 2)).toEqual([1, 1]);
    expect(states[2]).toBe(2);
    expect(states.slice(4)).toEqual([0, 0, 0, 0]);
  });

  it('ends at a clear mid-duck, the asked row applied at once on the emptied tank', () => {
    const at = blockAt(1);
    const seen: [number, number, number][] = [];
    run(
      at + 4,
      (block, values) => {
        values.voicing![0] = block >= at ? 1 : 0;
        // The Plate insert's switch empties the tank through `clear`.
        values.clear![0] = block === at + 1 ? 1 : 0;
      },
      (block, processor) => {
        const p = internals(processor);
        if (block >= at) seen.push([p._duckState, p._voicing, p._duck]);
      },
    );
    expect(seen[0]).toEqual([1, 0, expect.any(Number)]);
    expect(seen[1]).toEqual([0, 1, 1]);
    expect(seen.at(-1)).toEqual([0, 1, 1]);
  });

  it('turns a fade back up round from where it stands', () => {
    const at = blockAt(1);
    const ducks: number[] = [];
    run(
      at + 10,
      (block, values) => {
        values.voicing![0] = block >= at && block < at + 3 ? 1 : 0;
      },
      (block, processor) => {
        if (block >= at) ducks.push(internals(processor)._duck);
      },
    );
    // Up from silence over the third quantum, then down again from where it got to.
    expect(ducks[2]).toBeGreaterThan(0);
    expect(ducks[2]).toBeLessThan(1);
    expect(ducks[3]).toBeLessThan(ducks[2]!);
    expect(ducks.at(-1)).toBe(1);
  });
});

describe('the room voicing reads as a room', () => {
  /** One centred click after the settle: the first arrival in ms, and the early density. */
  function onset(params: Record<string, number>): { firstMs: number; density: number } {
    const settle = blockAt(0.5);
    const { samples } = renderReverb(
      loaded,
      1.6,
      (block, left, right) => {
        if (block === settle) left[0] = right[0] = 1;
      },
      params,
      { collectSamples: true },
    );
    const left = channel(samples, 0, settle * BLOCK);
    const right = channel(samples, 1, settle * BLOCK);
    let peak = 0;
    for (let i = 0; i < SR; i++) peak = Math.max(peak, Math.abs(left[i]!), Math.abs(right[i]!));
    const floor = peak / 100;
    let first = -1;
    let density = 0;
    for (let i = 0; i < SR / 10; i++) {
      if (first < 0 && Math.max(Math.abs(left[i]!), Math.abs(right[i]!)) >= floor) first = i;
      density += Number(Math.abs(left[i]!) >= floor) + Number(Math.abs(right[i]!) >= floor);
    }
    return { firstMs: (first * 1000) / SR, density };
  }

  it('arrives later as Size grows, and its early field is sparser than the plate voicing at Size 1, Build 0', () => {
    const first = [0.25, 1, 4].map((size) => onset({ size, build: 0, voicing: 1 }).firstMs);
    expect(first[0]).toBeLessThan(first[1]!);
    expect(first[1]).toBeLessThan(first[2]!);
    const room = onset({ build: 0, voicing: 1 }).density;
    const plate = onset({ build: 0, voicing: 0 }).density;
    expect(room).toBeLessThan(plate);
  });
});

describe('a switch while asleep', () => {
  it('applies at once, and the woken plate renders as a fresh one in the new voicing, to the bit', () => {
    const QUICK = { decay: 0.3 };
    const silentFor = blockAt(6);
    let asleepAt = -1;
    const woken = renderReverb(
      loaded,
      (silentFor * BLOCK) / SR + 1,
      (block, left, right) => {
        if (block === 0 || block === silentFor) left[0] = right[0] = 1;
      },
      { ...QUICK, voicing: 0 },
      {
        collectSamples: true,
        automate: (block, values) => {
          if (asleepAt >= 0 && block > asleepAt) values.voicing![0] = 1;
        },
        afterBlock: (block, processor) => {
          if (asleepAt < 0 && internals(processor)._asleep) asleepAt = block;
        },
      },
    );
    expect(asleepAt).toBeGreaterThan(0);
    expect(asleepAt).toBeLessThan(silentFor);
    const fresh = renderReverb(
      loaded,
      1,
      (block, left, right) => {
        if (block === 0) left[0] = right[0] = 1;
      },
      { ...QUICK, voicing: 1 },
      { collectSamples: true },
    );
    const from = silentFor * BLOCK * 2;
    expect(woken.samples.subarray(from, from + fresh.samples.length)).toEqual(fresh.samples);
  });
});

describe('each row is seconds at any rate', () => {
  it('has one shape in both voicings', () => {
    const [plate, room] = loaded.topology.voicings;
    for (const key of ['inputDelays', 'buildTapTime', 'tapTime', 'tapLine', 'tapGain'] as const) {
      expect(room![key].length, key).toBe(plate![key].length);
    }
    expect(room!.buildGainRows.map((r) => r.length)).toEqual(
      plate!.buildGainRows.map((r) => r.length),
    );
  });

  it.each([44100, 48000, 96000])(
    'at %i Hz, each input line and tap is its time within a sample, and nothing wraps short at Size 4',
    (rate) => {
      const plate = loadReverb(rate);
      for (const [voicing, row] of plate.topology.voicings.entries()) {
        for (const size of [1, 4]) {
          const processor = plate.create();
          const values: Record<string, Float32Array> = {};
          for (const d of plate.descriptors) values[d.name] = new Float32Array([d.defaultValue]);
          Object.assign(values, { voicing: [voicing], size: [size], preDelay: [1], build: [1] });
          const out = [new Float32Array(BLOCK), new Float32Array(BLOCK)];
          const silence = [new Float32Array(BLOCK), new Float32Array(BLOCK)];
          for (let b = 0; b < Math.round(rate / BLOCK); b++)
            processor.process([silence], [out], values);
          const p = internals(processor);
          expect(p._voicing).toBe(voicing);
          const scale = row.inputFollowsSize ? Math.sqrt(size) : 1;
          [0, 1, 2, 3, 12, 13, 14, 15].forEach((line, k) => {
            const want = Math.max(8, row.inputDelays[k]! * scale * rate);
            expect(Math.abs(p._length[line]! - want), `line ${line}`).toBeLessThanOrEqual(1);
            expect(p._length[line]! + 2).toBeLessThanOrEqual(p._buffers[line]!.length);
          });
          for (let t = 0; t < row.tapTime.length; t++) {
            expect(Math.abs(p._tap[t]! - row.tapTime[t]! * size * rate)).toBeLessThanOrEqual(1);
          }
          expect(Math.max(...p._buildTime) + 2).toBeLessThanOrEqual(p._buildLine.length);
        }
      }
    },
  );
});
