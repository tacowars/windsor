/** The audio gate's rules (windsor#578): every state against every event, and what each state shows. */
import { describe, expect, it } from 'vitest';

import { buildDate, buildLine } from './audioGateBuildLine';
import {
  GATE_HIDDEN,
  audioGateView,
  gateClosed,
  stepAudioGate,
  type AudioGate,
  type AudioGateEvent,
} from './audioGateModel';

const FIRST: AudioGate = { kind: 'first' };
const STARTING: AudioGate = { kind: 'starting' };
const FAILED: AudioGate = { kind: 'failed', error: 'AbortError: no worklet' };
const BACK: AudioGate = { kind: 'back' };
const ALL = [GATE_HIDDEN, FIRST, STARTING, FAILED, BACK];

const step = (gate: AudioGate, ...events: AudioGateEvent[]): AudioGate =>
  events.reduce(stepAudioGate, gate);
const context = (running: boolean): AudioGateEvent => ({ type: 'context', running });
const visible = (running: boolean): AudioGateEvent => ({
  type: 'visibility',
  visible: true,
  running,
});

describe('the audio gate', () => {
  it('opens on load in the first-load state, from wherever it was', () => {
    for (const gate of ALL) expect(step(gate, { type: 'load' })).toEqual(FIRST);
  });

  it('starts on a press from first load, a failure or the way back; a press while hidden or starting does nothing', () => {
    for (const gate of [FIRST, FAILED, BACK])
      expect(step(gate, { type: 'press' })).toEqual(STARTING);
    expect(step(GATE_HIDDEN, { type: 'press' })).toBe(GATE_HIDDEN);
    expect(step(STARTING, { type: 'press' })).toBe(STARTING);
  });

  it('closes when the enable resolves with audio running, and asks again when it is not', () => {
    expect(step(STARTING, { type: 'resolved', running: true })).toEqual(GATE_HIDDEN);
    expect(step(STARTING, { type: 'resolved', running: false })).toEqual(BACK);
  });

  it('shows the error when the enable throws, and the next press is a retry that can succeed', () => {
    const failed = step(FIRST, { type: 'press' }, { type: 'rejected', error: 'Error: refused' });
    expect(failed).toEqual({ kind: 'failed', error: 'Error: refused' });
    expect(step(failed, { type: 'press' }, { type: 'resolved', running: true })).toEqual(
      GATE_HIDDEN,
    );
  });

  it("ignores an enable's outcome outside starting", () => {
    for (const gate of [GATE_HIDDEN, FIRST, FAILED, BACK]) {
      expect(step(gate, { type: 'resolved', running: true })).toBe(gate);
      expect(step(gate, { type: 'rejected', error: 'late' })).toBe(gate);
    }
  });

  it('reopens to resume when the context leaves running, and closes when it comes back by itself', () => {
    expect(step(GATE_HIDDEN, context(false))).toEqual(BACK);
    expect(step(GATE_HIDDEN, context(true))).toEqual(GATE_HIDDEN);
    expect(step(BACK, context(true))).toEqual(GATE_HIDDEN);
    expect(step(BACK, context(false))).toEqual(BACK);
    expect(step(BACK, { type: 'press' }, { type: 'resolved', running: true })).toEqual(GATE_HIDDEN);
  });

  it('counts a context that comes back after an enable left the gate up as closing it', () => {
    const back = step(STARTING, { type: 'resolved', running: false });
    expect(gateClosed(STARTING, back)).toBe(false);
    expect(gateClosed(back, step(back, context(true)))).toBe(true);
  });

  it('lets only the press decide while starting, before audio and after a failure', () => {
    // A fresh context reports running before its build has finished, and a
    // failed start's discarded context reports not running.
    for (const gate of [STARTING, FIRST, FAILED]) {
      expect(step(gate, context(true))).toBe(gate);
      expect(step(gate, context(false))).toBe(gate);
    }
  });

  it('checks the context when the page comes back into view, and never when it goes away', () => {
    expect(step(GATE_HIDDEN, visible(false))).toEqual(BACK);
    // Desktop Chrome keeps the context running across a tab switch.
    expect(step(GATE_HIDDEN, visible(true))).toEqual(GATE_HIDDEN);
    expect(step(BACK, visible(true))).toEqual(GATE_HIDDEN);
    expect(step(GATE_HIDDEN, { type: 'visibility', visible: false, running: false })).toBe(
      GATE_HIDDEN,
    );
    // No context yet: the first-load gate stays as it is, and so does a pending start.
    expect(step(FIRST, visible(false))).toBe(FIRST);
    expect(step(STARTING, visible(false))).toBe(STARTING);
  });

  it("shows each state in the mockup's words, the error set apart as code", () => {
    expect(audioGateView(GATE_HIDDEN)).toMatchObject({ open: false, action: 'Enable audio' });
    expect(audioGateView(FIRST)).toMatchObject({ open: true, tone: '', disabled: false });
    expect(audioGateView(STARTING)).toMatchObject({
      action: 'Starting…',
      tone: 'busy',
      disabled: true,
    });
    expect(audioGateView(BACK)).toMatchObject({ action: 'Resume audio', tone: '' });
    const failed = audioGateView(FAILED);
    expect(failed).toMatchObject({ action: 'Audio didn’t start', tone: 'fail', disabled: false });
    expect(failed.lede).toEqual({
      before: 'The audio engine failed to load (',
      code: 'AbortError: no worklet',
      after: '). Press to try again.',
    });
    expect(audioGateView(FIRST).lede.code).toBeNull();
  });
});

describe('the build line', () => {
  it("reads as the mockup's main build, PR preview and dev server", () => {
    expect(buildLine({ commit: '9543344', date: '2026-10-04', pr: null })).toBe(
      '9543344 · 4 Oct 2026',
    );
    expect(buildLine({ commit: 'abc1234', date: '2026-10-04', pr: '576' })).toBe(
      'PR #576 · abc1234 · 4 Oct 2026',
    );
    expect(buildLine(null)).toBe('dev');
  });

  it('passes a date it cannot read through as it is', () => {
    expect(buildDate('2026-13-04')).toBe('2026-13-04');
    expect(buildDate('soon')).toBe('soon');
  });
});
