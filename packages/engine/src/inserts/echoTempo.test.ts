/**
 * The Echo follows the song's tempo (windsor#816, record
 * `2026-10-16-echo-follows-song-tempo`): synced, its loop plays a note value
 * at the song's BPM and glides to a new one; free, it plays its saved
 * seconds, which a synced Echo keeps. Old songs load free.
 */
import { describe, expect, it } from 'vitest';

import { FakeContext } from '../__fixtures__/fakeAudioContext';
import type { FakeParam } from '../__fixtures__/fakeAudioNodes';
import { FULL_ARRANGEMENT } from '../__fixtures__/fullArrangement';
import { build } from '../__fixtures__/insertStageRig';
import { withoutInsertIds } from '../__fixtures__/insertIds';
import { sources } from '../__fixtures__/stripRig';
import { ARRANGEMENT_VERSION } from '../audioConstants';
import { RETURNS } from '../mixer/mix';
import { makeArrangement } from '../song/arrangementDocument';
import { FieldNormaliser } from '../song/arrangementFields';
import type { EchoSpec } from './echoInsert';
import { DEFAULT_ECHO, ECHO_INSERT } from './echoInsert';
import { ringTime } from './echoSwitchSettle';
import { echoSeconds } from './echoTempo';
import { INSERT_SWITCH_FADE_S } from './insertConstants';
import { tempoInsertRegistry } from './tempoInsertRegistry';

const synced = (division: EchoSpec['division']): EchoSpec => ({ ...DEFAULT_ECHO, division });

/** The Echo's stage on a fresh context, and its loop's time param. */
function echoStage(spec: EchoSpec) {
  const built = build(spec);
  const context = built.context;
  const time = context.delays[0]!.delayTime as unknown as FakeParam;
  return { stage: built.stage, context, time };
}

describe('echoSeconds', () => {
  it('is the note value at the tempo while synced, and the saved seconds while free', () => {
    expect(echoSeconds(synced('1/8D'), 120)).toBe(0.375);
    expect(echoSeconds(synced('1/8D'), 100)).toBeCloseTo(0.45, 12);
    expect(echoSeconds(synced('1/4T'), 120)).toBeCloseTo(1 / 3, 12);
    expect(echoSeconds({ ...synced('1/8D'), sync: false, delayTime: 0.61 }, 100)).toBe(0.61);
  });

  it('clamps to the line’s 5 s', () => {
    // A whole note at 40 bpm is 6 s.
    expect(echoSeconds(synced('1/1'), 40)).toBe(5);
  });

  it.each([NaN, Infinity, 0, -90])('reads 120 bpm for a tempo of %d', (bpm) => {
    expect(echoSeconds(synced('1/8D'), bpm)).toBe(0.375);
  });
});

describe('a new Echo', () => {
  it('and Send B’s, plays a dotted eighth: 0.375 s at 120 bpm', () => {
    const bus = RETURNS.b.inserts[0] as EchoSpec;
    expect(bus).toMatchObject({ kind: 'echo', sync: true, division: '1/8D' });
    for (const spec of [DEFAULT_ECHO, bus]) {
      const { context } = echoStage(spec);
      expect(context.delays[0]!.delayTime.value).toBe(0.375);
    }
  });

  it('takes the song’s tempo through the registry when it is created', () => {
    const tempo = tempoInsertRegistry(100);
    const context = new FakeContext();
    tempo.registry.echo!.create(context.asAudioContext(), DEFAULT_ECHO);
    const time = context.delays[0]!.delayTime as unknown as FakeParam;
    expect(time.automation.at(-1)).toMatchObject({ call: 'setTargetAtTime', value: 0.45 });
  });
});

describe('setTempo', () => {
  it('glides a synced Echo’s time to the new tempo’s, and writes nothing for the same tempo', () => {
    const { stage, context, time } = echoStage(DEFAULT_ECHO);
    context.currentTime = 2;
    stage.setTempo!(100);
    expect(time.automation).toEqual([
      { call: 'cancelScheduledValues', value: 0.375, time: 2 },
      { call: 'setTargetAtTime', value: 0.45, time: 2 },
    ]);
    stage.setTempo!(100);
    expect(time.automation).toHaveLength(2);
  });

  it('writes nothing on a free Echo', () => {
    const { stage, time } = echoStage({ ...DEFAULT_ECHO, sync: false });
    stage.setTempo!(100);
    expect(time.automation).toEqual([]);
    expect(time.value).toBe(DEFAULT_ECHO.delayTime);
  });

  it('writes nothing when the clamped time does not move', () => {
    const { stage, time } = echoStage(synced('1/1'));
    stage.setTempo!(40);
    expect(time.automation.at(-1)).toMatchObject({ call: 'setTargetAtTime', value: 5 });
    const calls = time.automation.length;
    stage.setTempo!(30);
    expect(time.automation).toHaveLength(calls);
  });
});

describe('Sync and the note value', () => {
  it('glides to a new note value while synced', () => {
    const { stage, time } = echoStage(DEFAULT_ECHO);
    stage.set(synced('1/4'));
    expect(time.automation.at(-1)).toMatchObject({ call: 'setTargetAtTime', value: 0.5 });
  });

  it('restores the saved free time on Sync off, and the saved note value on Sync on', () => {
    const spec = { ...synced('1/16'), delayTime: 0.61 };
    const { stage, time } = echoStage(spec);
    expect(time.value).toBe(0.125);
    stage.set({ ...spec, sync: false });
    expect(time.value).toBe(0.61);
    stage.set(spec);
    expect(time.automation.at(-1)).toMatchObject({ call: 'setTargetAtTime', value: 0.125 });
  });

  it('writes a free Echo’s time at once, as the knob always has', () => {
    const { stage, time } = echoStage({ ...DEFAULT_ECHO, sync: false });
    stage.set({ ...DEFAULT_ECHO, sync: false, delayTime: 0.5 });
    expect(time.automation).toEqual([]);
    expect(time.value).toBe(0.5);
  });
});

describe('the switch’s wait while synced', () => {
  const OFF_AT = 3;
  const offEnd = OFF_AT + INSERT_SWITCH_FADE_S;

  /** The wet gain of `spec`'s stage, switched off at `OFF_AT` and on right after the fade. */
  function wetAfterSwitch(spec: EchoSpec): FakeParam {
    const { stage, context } = echoStage(spec);
    const [wet] = (sources(stage.output) as unknown as { gain: FakeParam }[]).map((n) => n.gain);
    context.currentTime = OFF_AT;
    stage.set({ ...spec, enabled: false });
    context.currentTime = offEnd + 1 / context.sampleRate;
    stage.set(spec);
    return wet!;
  }

  it('waits for the loop to empty at the synced time, not the saved one', () => {
    // A whole note at 120 bpm: 2 s, where the saved time is 0.28 s.
    const spec = { ...synced('1/1'), mix: 1 };
    const ring = ringTime(spec.damp, spec.resonance, 48000);
    const free = wetAfterSwitch({ ...spec, sync: false });
    const held = wetAfterSwitch(spec);
    const early = offEnd + spec.delayTime + ring + INSERT_SWITCH_FADE_S + 0.01;
    expect(free.valueAt(early)).toBe(1);
    expect(held.valueAt(early)).toBe(0);
    expect(held.valueAt(offEnd + 2 - 0.01)).toBe(0);
    expect(held.valueAt(offEnd + 2 + ring + INSERT_SWITCH_FADE_S + 0.01)).toBe(1);
  });
});

describe('the song document', () => {
  const song = (echo: Record<string, unknown>) => ({
    version: ARRANGEMENT_VERSION,
    ...FULL_ARRANGEMENT,
    patches: { kick: {}, hat: {}, 'saw-arp': {}, 'drone-sqr': {} },
    returns: { b: { level: 0.6, inserts: [echo] } },
  });
  const echoOf = (r: ReturnType<typeof makeArrangement>) =>
    withoutInsertIds(r.document.returns)?.b?.inserts[0];

  it('loads a saved Echo with no Sync free, at its saved time', () => {
    const old: Record<string, unknown> = { ...DEFAULT_ECHO, delayTime: 0.61 };
    delete old.sync;
    delete old.division;
    const r = makeArrangement(song(old));
    expect(r.corrections).toEqual([]);
    expect(echoOf(r)).toEqual({ ...DEFAULT_ECHO, delayTime: 0.61, sync: false });
  });

  it.each([
    { sync: true, division: '1/4T', delayTime: 0.61 },
    { sync: false, division: '1/2D', delayTime: 0.42 },
  ])('round-trips Sync $sync, $division and $delayTime s', (timing) => {
    const echo = { ...DEFAULT_ECHO, mix: 1, ...timing };
    const first = makeArrangement(song(echo));
    expect(first.corrections).toEqual([]);
    expect(echoOf(first)).toEqual(echo);
    const again = makeArrangement(JSON.parse(JSON.stringify(first.document)));
    expect(again.document).toEqual(first.document);
  });

  it('reads a junk note value as the dotted eighth', () => {
    const n = new FieldNormaliser();
    const spec = ECHO_INSERT.normalise({ kind: 'echo', sync: true, division: '1/5' }, 'x', n);
    expect(spec).toMatchObject({ sync: true, division: '1/8D' });
    expect(n.corrections).toHaveLength(1);
  });
});
