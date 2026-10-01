/**
 * The mixer column's writes (windsor#157, windsor#158): a Level, Pan, Low
 * cut, send or Output set here lands in the part's strip, where the Mixer
 * tab reads it; M and S are one undo step a press, named after the part; on
 * a sidechain-only part only a lit switch can be pressed, and only to clear
 * it.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { openGestureConsole } from './__fixtures__/gestureConsole';
import { partChange } from './context';
import { settleGestures } from './gestureHooks';
import { RETURN_NAMES } from '@windsor/engine';
import {
  setStripLevel,
  setStripLowCut,
  setStripOutput,
  setStripPan,
  setStripSend,
  stripOf,
  stripOutput,
  stripSignature,
  switchEnabled,
  switchLabel,
  switchOn,
  switchesApply,
  toggleStripSwitch,
} from './songMixerModel';

afterEach(() => settleGestures());

/** A console on the new song, its one part renamed so the labels read. */
function console0(): ReturnType<typeof openGestureConsole> {
  const ctx = openGestureConsole();
  ctx.change(partChange(0, { name: 'Pulse' }));
  return ctx;
}

describe('the mixer column', () => {
  it('sets the Level in the part’s strip, the field the Mixer tab reads', () => {
    const ctx = console0();
    setStripLevel(ctx, 0, 0.62);
    expect(stripOf(ctx, 0).level).toBe(0.62);
    expect(ctx.model.doc.parts[0]?.strip.level).toBe(0.62);
  });

  it.each(['mute', 'solo'] as const)(
    'toggles %s as one step a press, named after the part',
    (which) => {
      const ctx = console0();
      expect(switchOn(stripOf(ctx, 0), which)).toBe(false);
      expect(toggleStripSwitch(ctx, 0, which)).toBe(true);
      expect(switchOn(stripOf(ctx, 0), which)).toBe(true);
      expect(ctx.undoLabel).toBe(switchLabel(which, 'Pulse'));
      expect(toggleStripSwitch(ctx, 0, which)).toBe(true);
      expect(switchOn(stripOf(ctx, 0), which)).toBe(false);
      expect(ctx.undo()).toBe(true);
      expect(switchOn(stripOf(ctx, 0), which)).toBe(true);
      expect(ctx.undo()).toBe(true);
      expect(switchOn(stripOf(ctx, 0), which)).toBe(false);
    },
  );

  it('labels the switches "Mute <Part>" and "Solo <Part>"', () => {
    expect(switchLabel('mute', 'Pulse')).toBe('Mute Pulse');
    expect(switchLabel('solo', 'Mallet I')).toBe('Solo Mallet I');
  });

  it('leaves a sidechain-only part’s switches alone', () => {
    const ctx = console0();
    ctx.change(partChange(0, { strip: { output: 'sidechain' } }));
    expect(switchesApply(stripOf(ctx, 0))).toBe(false);
    const label = ctx.undoLabel;
    expect(toggleStripSwitch(ctx, 0, 'mute')).toBe(false);
    expect(toggleStripSwitch(ctx, 0, 'solo')).toBe(false);
    expect(switchOn(stripOf(ctx, 0), 'mute')).toBe(false);
    expect(switchOn(stripOf(ctx, 0), 'solo')).toBe(false);
    expect(ctx.undoLabel).toBe(label);
  });

  it.each([
    ['mute', 'solo'],
    ['solo', 'mute'],
  ] as const)(
    'keeps a lit %s clearable after the output moves to the sidechain, and %s disabled',
    (lit, off) => {
      const ctx = console0();
      expect(toggleStripSwitch(ctx, 0, lit)).toBe(true);
      ctx.change(partChange(0, { strip: { output: 'sidechain' } }));
      expect(switchEnabled(stripOf(ctx, 0), lit)).toBe(true);
      expect(switchEnabled(stripOf(ctx, 0), off)).toBe(false);
      expect(toggleStripSwitch(ctx, 0, off)).toBe(false);
      expect(switchOn(stripOf(ctx, 0), off)).toBe(false);
      expect(toggleStripSwitch(ctx, 0, lit)).toBe(true);
      expect(switchOn(stripOf(ctx, 0), lit)).toBe(false);
      expect(ctx.undoLabel).toBe(switchLabel(lit, 'Pulse'));
      // Cleared, it is disabled like the other: it cannot be turned back on here.
      expect(switchEnabled(stripOf(ctx, 0), lit)).toBe(false);
      expect(toggleStripSwitch(ctx, 0, lit)).toBe(false);
    },
  );

  it('sets Pan, Low cut and each send in the part’s strip, leaving the other sends', () => {
    const ctx = console0();
    const [first, second] = RETURN_NAMES;
    if (first === undefined || second === undefined) throw new Error('two returns expected');
    setStripPan(ctx, 0, -0.15);
    setStripLowCut(ctx, 0, 120);
    setStripSend(ctx, 0, first, 0.25);
    setStripSend(ctx, 0, second, 0.08);
    const strip = ctx.model.doc.parts[0]?.strip;
    expect(strip?.pan).toBe(-0.15);
    expect(strip?.lowCut).toBe(120);
    expect(strip?.sends[first]).toBe(0.25);
    expect(strip?.sends[second]).toBe(0.08);
  });

  it('undoes a Pan as one step', () => {
    const ctx = console0();
    const before = stripOf(ctx, 0).pan;
    setStripPan(ctx, 0, 0.5);
    expect(ctx.undo()).toBe(true);
    expect(stripOf(ctx, 0).pan).toBe(before);
  });

  it('routes the Output, and M and S follow it', () => {
    const ctx = console0();
    expect(stripOutput(stripOf(ctx, 0))).toBe('master');
    expect(toggleStripSwitch(ctx, 0, 'solo')).toBe(true);
    expect(setStripOutput(ctx, 0, 'sidechain')).toBe(true);
    expect(stripOutput(stripOf(ctx, 0))).toBe('sidechain');
    expect(switchEnabled(stripOf(ctx, 0), 'mute')).toBe(false);
    expect(switchEnabled(stripOf(ctx, 0), 'solo')).toBe(true);
    expect(setStripOutput(ctx, 0, 'master')).toBe(true);
    expect(switchEnabled(stripOf(ctx, 0), 'mute')).toBe(true);
    expect(switchEnabled(stripOf(ctx, 0), 'solo')).toBe(true);
    expect(ctx.undo()).toBe(true);
    expect(stripOutput(stripOf(ctx, 0))).toBe('sidechain');
  });

  it('routes the Output to a group, keeping M and S enabled (windsor#287)', () => {
    const ctx = console0();
    ctx.change({ groups: { 2: { id: 2, name: 'Drums', level: 1, pan: 0, inserts: [] } } });
    expect(setStripOutput(ctx, 0, { group: 2 })).toBe(true);
    expect(stripOutput(stripOf(ctx, 0))).toEqual({ group: 2 });
    expect(switchesApply(stripOf(ctx, 0))).toBe(true);
    expect(switchEnabled(stripOf(ctx, 0), 'mute')).toBe(true);
    expect(switchEnabled(stripOf(ctx, 0), 'solo')).toBe(true);
    expect(setStripOutput(ctx, 0, 'sidechain')).toBe(true);
    expect(switchEnabled(stripOf(ctx, 0), 'mute')).toBe(false);
    expect(ctx.undo()).toBe(true);
    expect(stripOutput(stripOf(ctx, 0))).toEqual({ group: 2 });
  });

  it('moves its strip signature on every field the expanded cell shows, and on nothing else', () => {
    const ctx = console0();
    const drawn = stripSignature(ctx);
    ctx.change(partChange(0, { name: 'Pulse II' }));
    expect(stripSignature(ctx)).toBe(drawn);
    const [ret = 'a'] = RETURN_NAMES;
    const edits = [
      { level: 0.3 },
      { pan: 0.5 },
      { lowCut: 200 },
      { sends: { [ret]: 0.4 } },
      { mute: true },
      { solo: true },
      { output: 'sidechain' },
      { output: { group: 2 } },
    ];
    ctx.change({ groups: { 2: { id: 2, name: 'Drums', level: 1, pan: 0, inserts: [] } } });
    for (const strip of edits) {
      const before = stripSignature(ctx);
      ctx.change(partChange(0, { strip }));
      expect(stripSignature(ctx)).not.toBe(before);
    }
  });

  it('refuses a slot with no part', () => {
    expect(toggleStripSwitch(console0(), 7, 'mute')).toBe(false);
  });
});
