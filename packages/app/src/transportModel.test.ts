/**
 * The transport strip's pure rules (#708): the position readout and the
 * ▶ ■ ‖ state machine, plus the partials the strip writes. The tick fixtures
 * are the issue's; 4/4 at 24 PPQ is the engine's constant (epic #703
 * decision 7), not a tunable, and the injected-grid case shows the format
 * follows whatever grid it is handed.
 */
import { describe, expect, it } from 'vitest';

import { TICKS_PER_BAR } from '../../../packages/client/src/audio/index-for-editor';
import {
  barsChange,
  bpmChange,
  formatPosition,
  keyChange,
  nextTransportState,
  pressedButtons,
  scaleChange,
  type TransportAction,
  type TransportState,
} from './transportModel';
import { KEY_OPTIONS, POSITION_GRID, SCALE_OPTIONS } from './transportTables';

describe('formatPosition', () => {
  const LONG = 16 * TICKS_PER_BAR;
  it.each([
    [0, '1.1.1'],
    [23, '1.1.4'],
    [24, '1.2.1'],
    [95, '1.4.4'],
    [96, '2.1.1'],
    [383, '4.4.4'],
    [384, '5.1.1'],
  ])('tick %i reads %s', (tick, expected) => {
    expect(formatPosition(tick, LONG)).toBe(expected);
  });

  it('reads the last tick of the song as its last sixteenth, and wraps at the song end', () => {
    const bars = 4;
    const songTicks = bars * TICKS_PER_BAR;
    expect(formatPosition(songTicks - 1, songTicks)).toBe(`${bars}.4.4`);
    expect(formatPosition(songTicks, songTicks)).toBe('1.1.1');
    expect(formatPosition(songTicks + TICKS_PER_BAR, songTicks)).toBe('2.1.1');
  });

  it('follows the grid it is handed', () => {
    const grid = { bar: 12, beat: 4, sixteenth: 1 };
    expect(formatPosition(13, 48, grid)).toBe('2.1.2');
    expect(POSITION_GRID.bar).toBe(TICKS_PER_BAR);
  });
});

describe('the ▶ ■ ‖ state machine', () => {
  const run = (from: TransportState, actions: TransportAction[]): TransportState[] =>
    actions.reduce<TransportState[]>(
      (states, action) => [...states, nextTransportState(states.at(-1) ?? from, action)],
      [],
    );

  it('idle → ▶ playing → ‖ paused → ▶ playing', () => {
    expect(run('idle', ['play', 'pause', 'play'])).toEqual(['playing', 'paused', 'playing']);
  });

  it('playing → ■ idle, and paused → ■ idle', () => {
    expect(run('playing', ['stop'])).toEqual(['idle']);
    expect(run('playing', ['pause', 'stop'])).toEqual(['paused', 'idle']);
  });

  it('‖ pauses only what plays: idle and paused stay put', () => {
    expect(nextTransportState('idle', 'pause')).toBe('idle');
    expect(nextTransportState('paused', 'pause')).toBe('paused');
    expect(nextTransportState('idle', 'stop')).toBe('idle');
  });

  it('shows ▶ or ‖ pressed, never ■', () => {
    expect(pressedButtons('playing')).toEqual({ play: true, pause: false });
    expect(pressedButtons('paused')).toEqual({ play: false, pause: true });
    expect(pressedButtons('idle')).toEqual({ play: false, pause: false });
  });
});

describe("the strip's writes", () => {
  it('are live partials at the document paths the engine reads', () => {
    expect(bpmChange(132)).toEqual({ transport: { bpm: 132 } });
    expect(barsChange(8)).toEqual({ transport: { bars: 8 } });
    expect(keyChange(7)).toEqual({ harmony: { root: 7 } });
    expect(scaleChange('dorian')).toEqual({ harmony: { scale: 'dorian' } });
  });

  it('refuses a scale name the engine does not know (the custom row)', () => {
    expect(scaleChange('custom')).toBeNull();
    expect(scaleChange('')).toBeNull();
  });

  it('offers twelve sharp-spelt keys and every named scale', () => {
    expect(KEY_OPTIONS.map((o) => o.label)).toEqual([
      'C',
      'C#',
      'D',
      'D#',
      'E',
      'F',
      'F#',
      'G',
      'G#',
      'A',
      'A#',
      'B',
    ]);
    expect(SCALE_OPTIONS.every((o) => scaleChange(o.value) !== null)).toBe(true);
  });
});
