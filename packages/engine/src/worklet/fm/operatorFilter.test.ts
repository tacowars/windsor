/**
 * An operator's own filters (windsor#362, every wave since windsor#590), as
 * a unit: each section is a two-pole Butterworth, −3 dB at its cutoff and
 * 12 dB an octave beyond; the tuning reaches every wave, follows the note
 * by `opTrack`, retunes only on a change, starts a section that turns on
 * from rest, and holds a cutoff to the floor and the ceiling. Through the
 * voice (both render paths, every wave, the feedback tap, the goldens
 * unchanged): `synth/fmProcessorOperatorFilter.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import type { Operator } from '../../patch/patch';
import { OP_FILTER_CEILING } from './fmConstants';
import { OP_FILTER_FLOOR_HZ } from './patchDefaults';
import { WAVE } from './waveIds';
import type { Voice } from './voice';

// `waveTables` warms the wave cache at load and reads the scope's sample rate.
Object.assign(globalThis, { sampleRate: 48000 });
const { OperatorFilter, bindOperatorFilter } = await import('./operatorFilter');

const SR = 48000;
const MIDDLE_C = 60;

type Filter = InstanceType<typeof OperatorFilter>;

/** A voice as far as `bindOperatorFilter` reads one: operator 0 only, at `note`. */
function voiceWith(
  op: Partial<Operator>,
  filter: Filter = new OperatorFilter(),
  note = MIDDLE_C,
): Voice {
  const full = { wave: WAVE.SAW, opLp: 0, opHp: 0, opTrack: 0, ...op };
  return {
    opFilter: [filter],
    patch: { ops: [full] },
    note,
    sr: SR,
    opRate: SR,
  } as unknown as Voice;
}

function tuned(op: Partial<Operator>, note = MIDDLE_C): Filter {
  const voice = voiceWith(op, new OperatorFilter(), note);
  bindOperatorFilter(voice, 0);
  return voice.opFilter[0]!;
}

/** The steady-state gain at `hz`: a sine through the sections, RMS out over RMS in across its second second. */
function gainAt(filter: Filter, hz: number): number {
  filter.reset();
  let energyIn = 0;
  let energyOut = 0;
  for (let n = 0; n < 2 * SR; n++) {
    const x = Math.sin((2 * Math.PI * hz * n) / SR);
    filter.point = x;
    filter.process();
    if (n < SR) continue;
    energyIn += x * x;
    energyOut += filter.point * filter.point;
  }
  return Math.sqrt(energyOut / energyIn);
}

const db = (ratio: number): number => 20 * Math.log10(ratio);

describe("an operator's own filter sections (windsor#362, windsor#590)", () => {
  it('passes the sample untouched with both cutoffs 0, at any tracking, and stays off', () => {
    for (const opTrack of [0, 1, -1, 2]) {
      const filter = tuned({ opTrack }, 100);
      expect([filter.on, filter.lpOn, filter.hpOn]).toEqual([false, false, false]);
    }
  });

  it('is a Butterworth lowpass: −3 dB at the cutoff, about −24 dB two octaves above', () => {
    const filter = tuned({ opLp: 2000 });
    expect([filter.on, filter.lpOn, filter.hpOn]).toEqual([true, true, false]);
    // Measured on Node 24: −3.01 dB at 2 kHz, −0.00 at 100 Hz, −25.7 at
    // 8 kHz (the analog −24.1, steeper by the prewarp toward Nyquist).
    expect(db(gainAt(filter, 2000))).toBeCloseTo(-3.01, 1);
    expect(db(gainAt(filter, 100))).toBeGreaterThan(-0.01);
    expect(db(gainAt(filter, 8000))).toBeLessThan(-24);
    expect(db(gainAt(filter, 8000))).toBeGreaterThan(-27);
  });

  it('is a Butterworth highpass: −3 dB at the cutoff, about −24 dB two octaves below', () => {
    const filter = tuned({ opHp: 2000 });
    expect([filter.on, filter.lpOn, filter.hpOn]).toEqual([true, false, true]);
    // Measured on Node 24: −3.01 dB at 2 kHz, −0.00 at 16 kHz, −24.2 at 500 Hz.
    expect(db(gainAt(filter, 2000))).toBeCloseTo(-3.01, 1);
    expect(db(gainAt(filter, 16000))).toBeGreaterThan(-0.01);
    expect(db(gainAt(filter, 500))).toBeLessThan(-23);
  });

  it('runs both in series as a band', () => {
    const filter = tuned({ opHp: 1000, opLp: 8000 });
    expect([filter.lpOn, filter.hpOn]).toEqual([true, true]);
    // Measured on Node 24: −0.11 dB at 2.8 kHz, −24.1 at 250 Hz, −32.4 at 20 kHz.
    expect(db(gainAt(filter, 2800))).toBeGreaterThan(-0.5);
    expect(db(gainAt(filter, 250))).toBeLessThan(-23);
    expect(db(gainAt(filter, 20000))).toBeLessThan(-12);
  });

  it('tunes on every wave alike', () => {
    const saw = tuned({ opLp: 3000, opHp: 500 });
    for (const wave of [WAVE.SINE, WAVE.SQUARE, WAVE.PULSE, WAVE.USER, WAVE.NOISE]) {
      const filter = tuned({ wave, opLp: 3000, opHp: 500 });
      expect([filter.on, filter.lpA1, filter.hpA1], String(wave)).toEqual([
        true,
        saw.lpA1,
        saw.hpA1,
      ]);
    }
  });

  it('retunes only on a change, and starts a section that turns on from rest', () => {
    const filter = new OperatorFilter();
    const voice = voiceWith({ opLp: 3000 }, filter);
    bindOperatorFilter(voice, 0);
    const a1 = filter.lpA1;
    filter.lp1 = 0.25;
    bindOperatorFilter(voice, 0);
    // Unchanged: the state runs on.
    expect([filter.lpA1, filter.lp1]).toEqual([a1, 0.25]);
    // Retuned while on: new coefficients, the state runs on.
    voice.patch!.ops[0]!.opLp = 4000;
    bindOperatorFilter(voice, 0);
    expect(filter.lpA1).not.toBe(a1);
    expect(filter.lp1).toBe(0.25);
    // Off, then on again: from rest.
    voice.patch!.ops[0]!.opLp = 0;
    bindOperatorFilter(voice, 0);
    expect(filter.on).toBe(false);
    voice.patch!.ops[0]!.opLp = 4000;
    bindOperatorFilter(voice, 0);
    expect([filter.on, filter.lp1, filter.lp2]).toEqual([true, 0, 0]);
  });

  it('holds a cutoff that is on to the floor and the ceiling', () => {
    const floor = tuned({ opLp: OP_FILTER_FLOOR_HZ });
    expect(tuned({ opLp: 1 }).lpA1).toBe(floor.lpA1);
    const top = tuned({ opLp: OP_FILTER_CEILING * SR });
    expect(tuned({ opLp: 30000 }).lpA1).toBe(top.lpA1);
  });
});

describe("an operator filter's key tracking (windsor#590)", () => {
  it('moves both cutoffs an octave an octave of note at opTrack 1, and inverts at −1', () => {
    for (const note of [48, 72, 84]) {
      const octaves = (note - MIDDLE_C) / 12;
      const up = tuned({ opLp: 1000, opHp: 300, opTrack: 1 }, note);
      expect([up.lpHz, up.hpHz], `note ${note}`).toEqual([1000 * 2 ** octaves, 300 * 2 ** octaves]);
      const down = tuned({ opLp: 1000, opTrack: -1 }, note);
      expect(down.lpHz, `note ${note}`).toBe(1000 * 2 ** -octaves);
    }
    // The same cutoff an octave up tunes as that cutoff untracked.
    expect(tuned({ opLp: 1000, opTrack: 1 }, 72).lpA1).toBe(tuned({ opLp: 2000 }).lpA1);
    expect(tuned({ opLp: 1000, opTrack: 2 }, 66).lpHz).toBe(2000);
  });

  it('leaves the cutoff where it is set at opTrack 0, and at middle C at any tracking', () => {
    for (const note of [0, 30, 60, 100, 127])
      expect(tuned({ opLp: 1234.5 }, note).lpHz).toBe(1234.5);
    for (const opTrack of [-1, 0.5, 2]) expect(tuned({ opLp: 1234.5, opTrack }).lpHz).toBe(1234.5);
  });

  it('holds the floor and the ceiling at the register extremes', () => {
    const floor = tuned({ opLp: OP_FILTER_FLOOR_HZ });
    const top = tuned({ opLp: OP_FILTER_CEILING * SR });
    // 100 Hz at note 0 and opTrack 2 is 100 × 2^-10, under the floor.
    expect(tuned({ opLp: 100, opTrack: 2 }, 0).lpA1).toBe(floor.lpA1);
    expect(tuned({ opLp: 100, opTrack: 2 }, 0).lpOn).toBe(true);
    // 10 kHz at note 127 and opTrack 2 is far past the ceiling; so is it at note 0 inverted.
    expect(tuned({ opLp: 10000, opTrack: 2 }, 127).lpA1).toBe(top.lpA1);
    expect(tuned({ opLp: 10000, opTrack: -1 }, 0).lpA1).toBe(top.lpA1);
  });

  it('retunes a tracked section for a new note, and leaves an untracked one alone', () => {
    const tracked = new OperatorFilter();
    const trackedVoice = voiceWith({ opLp: 1000, opTrack: 1 }, tracked);
    bindOperatorFilter(trackedVoice, 0);
    const a1 = tracked.lpA1;
    tracked.lp1 = 0.25;
    (trackedVoice as { note: number }).note = 67;
    bindOperatorFilter(trackedVoice, 0);
    expect(tracked.lpA1).not.toBe(a1);
    expect(tracked.lp1).toBe(0.25);

    const fixed = new OperatorFilter();
    const fixedVoice = voiceWith({ opLp: 1000 }, fixed);
    bindOperatorFilter(fixedVoice, 0);
    // A sentinel coefficient: a retune would overwrite it.
    fixed.lpA1 = 0.5;
    (fixedVoice as { note: number }).note = 67;
    bindOperatorFilter(fixedVoice, 0);
    expect([fixed.lpHz, fixed.lpA1]).toEqual([1000, 0.5]);
  });
});
