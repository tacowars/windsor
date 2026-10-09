/**
 * Hard sync's binding and its resets on the voice (windsor#646, record
 * `2026-10-09-operator-hard-sync`), over the fields `voiceSync.ts` reads:
 * each operator's master, the chain order (an operator after the one it
 * follows), a synced Noise operator left unsynced while a Noise master
 * stays one, which waves are corrected, and a reset's phase and polyBLEP.
 * The render is `synth/fmProcessorSync.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import type { OpSync, Patch } from '../../patch/patch';
import { makePatch } from '../../patch/patch';
import { TABLE_SIZE } from './fmConstants';
import type { Voice } from './voice';
import { WAVE } from './waveIds';

// `waveTables` warms the wave cache at load and reads the scope's sample rate.
Object.assign(globalThis, { sampleRate: 48000 });
const { KIND_NOISE, KIND_PULSE, KIND_TABLE, waveKind } = await import('./waveTables');
const { SYNC_NONE, SYNC_NOTE, SYNC_NOTE_BIT, VoiceSync, applySyncResets, bindVoiceSync } =
  await import('./voiceSync');

/** A ramp from -1 to 1 over the table, its guard sample included: the wave reads `2x − 1`. */
const RAMP = Float32Array.from({ length: TABLE_SIZE + 1 }, (_, k) => (2 * k) / TABLE_SIZE - 1);

/** The fields the module reads, for a patch whose operators sync as `syncs` on `waves`. */
function voiceOf(syncs: OpSync[], waves: number[] = [0, 0, 0, 0]): { voice: Voice; patch: Patch } {
  const patch = makePatch({ ops: waves.map((wave, i) => ({ wave, sync: syncs[i] })) });
  const voice = {
    sync: new VoiceSync(),
    kind: Int32Array.from(waves, waveKind),
    phase: new Float64Array(4),
    phaseInc: new Float64Array(4),
    width: new Float32Array(4).fill(1),
    tables: [RAMP, RAMP, RAMP, RAMP],
  } as unknown as Voice;
  bindVoiceSync(voice, patch);
  return { voice, patch };
}

describe('bindVoiceSync', () => {
  it('reads each operator’s master: none, the note or an operator', () => {
    const { voice } = voiceOf(['off', 'note', 'B', 'A']);
    expect(Array.from(voice.sync.master)).toEqual([SYNC_NONE, SYNC_NOTE, 1, 0]);
    expect(voice.sync.synced).toBe(0b1110);
    expect(voice.sync.masters).toBe(SYNC_NOTE_BIT | 0b0011);
  });

  it('orders a chain after its masters, whatever the operators’ order', () => {
    const forward = voiceOf(['off', 'note', 'B', 'C']).voice.sync;
    expect(Array.from(forward.order.subarray(0, forward.count))).toEqual([1, 2, 3]);
    const backward = voiceOf(['C', 'off', 'D', 'note']).voice.sync;
    expect(Array.from(backward.order.subarray(0, backward.count))).toEqual([3, 2, 0]);
  });

  it('leaves a synced Noise operator unsynced, and keeps one synced to a Noise master', () => {
    const { voice } = voiceOf(['note', 'A', 'off', 'off'], [WAVE.NOISE, WAVE.SAW, 0, 0]);
    expect(voice.kind[0]).toBe(KIND_NOISE);
    expect(Array.from(voice.sync.master)).toEqual([SYNC_NONE, 0, SYNC_NONE, SYNC_NONE]);
    expect(voice.sync.synced).toBe(0b0010);
    expect(voice.sync.masters).toBe(0b0001);
  });

  it('corrects the table waves and the Pulse, and not the deliberately aliasing waves', () => {
    const corrected = [WAVE.SINE, WAVE.SAW, WAVE.PULSE, WAVE.USER];
    expect(waveKind(WAVE.PULSE)).toBe(KIND_PULSE);
    expect(waveKind(WAVE.SINE_8BIT)).toBe(KIND_TABLE);
    expect(voiceOf(['note', 'note', 'note', 'note'], corrected).voice.sync.blep).toBe(0b1111);
    const raw = [WAVE.SAW_D, WAVE.SQUARE_D, WAVE.SINE_4BIT, WAVE.SINE_8BIT];
    const { sync } = voiceOf(['note', 'note', 'note', 'note'], raw).voice;
    expect([sync.synced, sync.blep]).toEqual([0b1111, 0]);
  });

  it('clears what an operator newly corrected holds, and keeps what one still corrected does', () => {
    const { voice, patch } = voiceOf(['note', 'off', 'off', 'off']);
    voice.sync.held.fill(0.5);
    voice.sync.after.fill(0.25);
    patch.ops[1]!.sync = 'note';
    bindVoiceSync(voice, patch);
    expect(Array.from(voice.sync.held)).toEqual([0.5, 0, 0.5, 0.5]);
    expect(Array.from(voice.sync.after)).toEqual([0.25, 0, 0.25, 0.25]);
  });
});

describe('applySyncResets', () => {
  it('restarts a synced operator at d times its increment, and a chain on its master’s reset', () => {
    const { voice } = voiceOf(['off', 'note', 'B', 'off']);
    const s = voice.sync;
    // The note wrapped half a sample ago; B and C ran on.
    s.notePhase = 0.25;
    s.noteInc = 0.5;
    voice.phase.set([0.4, 0.9, 0.7, 0.3]);
    voice.phaseInc.set([0.1, 0.3, 0.2, 0.1]);
    applySyncResets(voice);
    expect(voice.phase[1]).toBeCloseTo(0.15, 15);
    expect(voice.phase[2]).toBeCloseTo(0.1, 15);
    expect([voice.phase[0], voice.phase[3]]).toEqual([0.4, 0.3]);
  });

  it('resets an operator on its master’s own wrap, and leaves it while no master wrapped', () => {
    const { voice } = voiceOf(['off', 'A', 'off', 'off']);
    voice.phaseInc.set([0.2, 0.05, 0, 0]);
    voice.phase.set([0.5, 0.6, 0, 0]);
    applySyncResets(voice);
    expect(voice.phase[1]).toBe(0.6);
    voice.phase[0] = 0.05;
    applySyncResets(voice);
    expect(voice.phase[1]).toBeCloseTo(0.0125, 15);
  });

  it('splits the step’s polyBLEP between the wave held and the next one', () => {
    const { voice } = voiceOf(['note', 'off', 'off', 'off']);
    const s = voice.sync;
    s.notePhase = 0.25;
    s.noteInc = 0.5;
    voice.phase[0] = 0.9;
    voice.phaseInc[0] = 0.3;
    s.held[0] = 0.75;
    applySyncResets(voice);
    // The ramp reads -0.7 at the reset phase 0.15 and 0.8 at 0.9: a step of -1.5, half a sample back.
    const step = -1.5;
    expect(s.held[0]).toBeCloseTo(0.75 + step * 0.25 * 0.5, 6);
    expect(s.after[0]).toBeCloseTo(step * 0.25 * 0.5, 6);
  });
});
