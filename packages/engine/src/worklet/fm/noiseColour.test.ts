/**
 * A Noise operator's colour (windsor#362), as a unit: each section is a
 * two-pole Butterworth, −3 dB at its cutoff and 12 dB an octave beyond; the
 * tuning reaches a Noise operator only, retunes only on a change, starts
 * a section that turns on from rest, and holds a cutoff to the floor and the
 * ceiling. Through the voice (both render paths, the fields heard on Noise
 * only, the goldens unchanged): `synth/fmProcessorNoiseColour.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import type { Operator } from '../../patch/patch';
import { NOISE_COLOUR_CEILING } from './fmConstants';
import { NOISE_COLOUR_FLOOR_HZ } from './patchDefaults';
import { WAVE } from './waveIds';
import type { Voice } from './voice';

// `waveTables` warms the wave cache at load and reads the scope's sample rate.
Object.assign(globalThis, { sampleRate: 48000 });
const { NoiseColour, bindNoiseColour } = await import('./noiseColour');
const { waveKind } = await import('./waveTables');

const SR = 48000;

type Colour = InstanceType<typeof NoiseColour>;

/** A voice as far as `bindNoiseColour` reads one: operator 0 only. */
function voiceWith(op: Partial<Operator>, colour: Colour = new NoiseColour()): Voice {
  const full = { wave: WAVE.NOISE, noiseLp: 0, noiseHp: 0, ...op };
  return {
    noiseColour: [colour],
    patch: { ops: [full] },
    kind: Int32Array.of(waveKind(full.wave)),
    sr: SR,
  } as unknown as Voice;
}

function tuned(op: Partial<Operator>): Colour {
  const voice = voiceWith(op);
  bindNoiseColour(voice, 0);
  return voice.noiseColour[0]!;
}

/** The steady-state gain at `hz`: a sine through the sections, RMS out over RMS in across its second second. */
function gainAt(colour: Colour, hz: number): number {
  colour.reset();
  let energyIn = 0;
  let energyOut = 0;
  for (let n = 0; n < 2 * SR; n++) {
    const x = Math.sin((2 * Math.PI * hz * n) / SR);
    colour.point = x;
    colour.process();
    if (n < SR) continue;
    energyIn += x * x;
    energyOut += colour.point * colour.point;
  }
  return Math.sqrt(energyOut / energyIn);
}

const db = (ratio: number): number => 20 * Math.log10(ratio);

describe("a Noise operator's colour sections (windsor#362)", () => {
  it('passes the sample untouched with both fields 0, and stays off', () => {
    const colour = tuned({});
    expect([colour.on, colour.lpOn, colour.hpOn]).toEqual([false, false, false]);
  });

  it('is a Butterworth lowpass: −3 dB at the cutoff, about −24 dB two octaves above', () => {
    const colour = tuned({ noiseLp: 2000 });
    expect([colour.on, colour.lpOn, colour.hpOn]).toEqual([true, true, false]);
    // Measured on Node 24: −3.01 dB at 2 kHz, −0.00 at 100 Hz, −25.7 at
    // 8 kHz (the analog −24.1, steeper by the prewarp toward Nyquist).
    expect(db(gainAt(colour, 2000))).toBeCloseTo(-3.01, 1);
    expect(db(gainAt(colour, 100))).toBeGreaterThan(-0.01);
    expect(db(gainAt(colour, 8000))).toBeLessThan(-24);
    expect(db(gainAt(colour, 8000))).toBeGreaterThan(-27);
  });

  it('is a Butterworth highpass: −3 dB at the cutoff, about −24 dB two octaves below', () => {
    const colour = tuned({ noiseHp: 2000 });
    expect([colour.on, colour.lpOn, colour.hpOn]).toEqual([true, false, true]);
    // Measured on Node 24: −3.01 dB at 2 kHz, −0.00 at 16 kHz, −24.2 at 500 Hz.
    expect(db(gainAt(colour, 2000))).toBeCloseTo(-3.01, 1);
    expect(db(gainAt(colour, 16000))).toBeGreaterThan(-0.01);
    expect(db(gainAt(colour, 500))).toBeLessThan(-23);
  });

  it('runs both in series as a band', () => {
    const colour = tuned({ noiseHp: 1000, noiseLp: 8000 });
    expect([colour.lpOn, colour.hpOn]).toEqual([true, true]);
    // Measured on Node 24: −0.11 dB at 2.8 kHz, −24.1 at 250 Hz, −32.4 at 20 kHz.
    expect(db(gainAt(colour, 2800))).toBeGreaterThan(-0.5);
    expect(db(gainAt(colour, 250))).toBeLessThan(-23);
    expect(db(gainAt(colour, 20000))).toBeLessThan(-12);
  });

  it('ignores the fields on any other wave', () => {
    for (const wave of [WAVE.SINE, WAVE.SAW, WAVE.SQUARE, WAVE.PULSE, WAVE.USER]) {
      expect(tuned({ wave, noiseLp: 3000, noiseHp: 500 }).on).toBe(false);
    }
  });

  it('retunes only on a change, and starts a section that turns on from rest', () => {
    const colour = new NoiseColour();
    const voice = voiceWith({ noiseLp: 3000 }, colour);
    bindNoiseColour(voice, 0);
    const a1 = colour.lpA1;
    colour.lp1 = 0.25;
    bindNoiseColour(voice, 0);
    // Unchanged: the state runs on.
    expect([colour.lpA1, colour.lp1]).toEqual([a1, 0.25]);
    // Retuned while on: new coefficients, the state runs on.
    voice.patch!.ops[0]!.noiseLp = 4000;
    bindNoiseColour(voice, 0);
    expect(colour.lpA1).not.toBe(a1);
    expect(colour.lp1).toBe(0.25);
    // Off, then on again: from rest.
    voice.patch!.ops[0]!.noiseLp = 0;
    bindNoiseColour(voice, 0);
    expect(colour.on).toBe(false);
    voice.patch!.ops[0]!.noiseLp = 4000;
    bindNoiseColour(voice, 0);
    expect([colour.on, colour.lp1, colour.lp2]).toEqual([true, 0, 0]);
  });

  it('holds a cutoff that is on to the floor and the ceiling', () => {
    const floor = tuned({ noiseLp: NOISE_COLOUR_FLOOR_HZ });
    expect(tuned({ noiseLp: 1 }).lpA1).toBe(floor.lpA1);
    const top = tuned({ noiseLp: NOISE_COLOUR_CEILING * SR });
    expect(tuned({ noiseLp: 30000 }).lpA1).toBe(top.lpA1);
  });
});
