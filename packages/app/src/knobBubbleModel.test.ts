/**
 * The compact knob's value bubble (windsor#768 decisions 6 and 7): what it
 * reads, when it shows and hides, and where it sits.
 */
import { describe, expect, it } from 'vitest';

import { STRIP_LOW_CUT_KNOB, STRIP_PAN_KNOB } from './mixerTables';
import type { KnobBubbleInput, KnobBubbleState } from './knobBubbleModel';
import { BUBBLE_IDLE, knobBubbleContent, knobBubblePlace, knobBubbleStep } from './knobBubbleModel';
import { KNOB_BUBBLE_TIMING } from './knobBubbleTables';

const T = KNOB_BUBBLE_TIMING;

/** The state and the last action after `inputs`, from idle. */
function run(...inputs: KnobBubbleInput[]): ReturnType<typeof knobBubbleStep> {
  let step: ReturnType<typeof knobBubbleStep> = { state: BUBBLE_IDLE, action: null };
  for (const input of inputs) step = knobBubbleStep(step.state, input);
  return step;
}

describe('what the bubble reads', () => {
  const read = (spec: { label: string; fmt?: (v: number) => string }, v: number, unit?: string) =>
    knobBubbleContent({
      label: spec.label,
      value: spec.fmt?.(v) ?? '',
      unit,
      lock: null,
      enveloped: false,
    });

  it('prints Low cut in Hz at both ends, the floor included', () => {
    expect(read(STRIP_LOW_CUT_KNOB, STRIP_LOW_CUT_KNOB.min, 'Hz')).toMatchObject({
      label: 'Low cut',
      value: '20 Hz',
    });
    expect(read(STRIP_LOW_CUT_KNOB, STRIP_LOW_CUT_KNOB.max, 'Hz').value).toBe('500 Hz');
  });

  it('prints Pan signed', () => {
    expect(read(STRIP_PAN_KNOB, 0.25).value).toBe('+0.25');
    expect(read(STRIP_PAN_KNOB, -0.5).value).toBe('-0.50');
  });

  it("carries a lock's tag in its colour, a macro's name, or ENV under an envelope", () => {
    const base = { label: 'Level', value: '0.80', enveloped: true };
    expect(knobBubbleContent({ ...base, lock: { color: '#123456', value: 0.8 } }).tag).toEqual({
      text: 'AUTO',
      color: '#123456',
    });
    const macro = { color: '#654321', value: 0.8, macro: 'Wobble' };
    expect(knobBubbleContent({ ...base, lock: macro }).tag?.text).toBe('Wobble');
    expect(knobBubbleContent({ ...base, lock: null }).tag?.text).toBe('ENV');
    expect(knobBubbleContent({ ...base, lock: null, enveloped: false }).tag).toBeNull();
  });
});

describe('when the bubble shows and hides', () => {
  it('shows after a hover, and at once on a press or keyboard focus', () => {
    expect(run({ kind: 'enter' }).action).toEqual({ show: T.hoverMs });
    expect(run({ kind: 'enter' }, { kind: 'press' }).action).toEqual({ show: 0 });
    expect(run({ kind: 'focus' }).action).toEqual({ show: 0 });
  });

  it('hides after the pointer leaves, but stays through a drag that leaves', () => {
    expect(run({ kind: 'enter' }, { kind: 'leave' }).action).toEqual({ hide: T.leaveMs });
    expect(run({ kind: 'enter' }, { kind: 'press' }, { kind: 'leave' }).action).toBeNull();
  });

  it('hides later after a release off the knob, and stays after one on it', () => {
    const pressed: KnobBubbleInput[] = [{ kind: 'enter' }, { kind: 'press' }];
    expect(run(...pressed, { kind: 'release', inside: false }).action).toEqual({
      hide: T.releaseMs,
    });
    expect(run(...pressed, { kind: 'release', inside: true }).action).toBeNull();
    // The leave the browser sends after the release changes nothing more.
    expect(
      run(...pressed, { kind: 'release', inside: false }, { kind: 'leave' }).action,
    ).toBeNull();
  });

  it('stays while keyboard focus holds it, and hides on the blur', () => {
    const focused: KnobBubbleState = { ...BUBBLE_IDLE, focused: true };
    expect(knobBubbleStep(focused, { kind: 'release', inside: false }).action).toBeNull();
    expect(run({ kind: 'focus' }, { kind: 'blur' }).action).toEqual({ hide: 0 });
  });

  it('shows a reset for a moment', () => {
    expect(run({ kind: 'reset' }).action).toEqual({ show: 0, hideAfter: T.resetMs });
  });
});

describe('where the bubble sits', () => {
  const anchor = { centreX: 200, top: 100, width: 80, height: 20, viewportWidth: 1000 };

  it('centres over the dial, clear of it', () => {
    expect(knobBubblePlace(anchor, { gapPx: 6, marginPx: 4 })).toEqual({
      left: 160,
      top: 74,
      tipX: 40,
    });
  });

  it('stays whole at the window edge, its tip still on the dial', () => {
    const left = knobBubblePlace({ ...anchor, centreX: 10 }, { gapPx: 6, marginPx: 4 });
    expect(left.left).toBe(4);
    expect(left.tipX).toBe(6);
    const right = knobBubblePlace({ ...anchor, centreX: 990 }, { gapPx: 6, marginPx: 4 });
    expect(right.left).toBe(916);
  });
});
