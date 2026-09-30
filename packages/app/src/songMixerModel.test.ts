/**
 * The mixer column's writes (windsor#157): a Level set here lands in the
 * part's strip, where the Mixer tab reads it; M and S are one undo step a
 * press, named after the part; on a sidechain-only part only a lit switch
 * can be pressed, and only to clear it.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { openGestureConsole } from './__fixtures__/gestureConsole';
import { partChange } from './context';
import { settleGestures } from './gestureHooks';
import {
  setStripLevel,
  stripOf,
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

  it('moves its strip signature on a Level, a switch or an output change, and on nothing else', () => {
    const ctx = console0();
    const drawn = stripSignature(ctx);
    ctx.change(partChange(0, { strip: { pan: 0.5 } }));
    expect(stripSignature(ctx)).toBe(drawn);
    for (const strip of [{ level: 0.3 }, { mute: true }, { solo: true }, { output: 'sidechain' }]) {
      const before = stripSignature(ctx);
      ctx.change(partChange(0, { strip }));
      expect(stripSignature(ctx)).not.toBe(before);
    }
  });

  it('refuses a slot with no part', () => {
    expect(toggleStripSwitch(console0(), 7, 'mute')).toBe(false);
  });
});
