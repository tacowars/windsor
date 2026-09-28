/**
 * The transport strip's pure rules (#708): the position readout and the
 * ▶ ■ ‖ state machine, plus the partials the strip writes. The tick fixtures
 * are the issue's; 4/4 at 24 PPQ is the engine's constant (epic #703
 * decision 7), not a tunable, and the injected-grid case shows the format
 * follows whatever grid it is handed.
 */
import { describe, expect, it } from 'vitest';

import { BARS_MAX, BPM_MAX, BPM_MIN, TICKS_PER_BAR } from '@windsor/engine';
import {
  barsChange,
  bpmChange,
  dragBars,
  dragBpm,
  formatPosition,
  keyChange,
  nextTransportState,
  parseBars,
  parseBpm,
  pressedButtons,
  scaleChange,
  tapTempo,
  type TransportAction,
  type TransportState,
} from './transportModel';
import {
  KEY_OPTIONS,
  NUMBER_DRAG,
  POSITION_GRID,
  SCALE_OPTIONS,
  TAP_TEMPO,
} from './transportTables';

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

describe('typing into the tempo and bars boxes (windsor#12 decision 1)', () => {
  it('sets a typed tempo to two decimals, clamps an out-of-range one, reverts on junk', () => {
    expect(parseBpm('133.5')).toBe(133.5);
    expect(parseBpm(' 120.257 ')).toBe(120.26);
    expect(parseBpm('133,5')).toBe(133.5);
    expect(parseBpm('999')).toBe(BPM_MAX);
    expect(parseBpm('3')).toBe(BPM_MIN);
    expect(parseBpm('abc')).toBeNull();
    expect(parseBpm('')).toBeNull();
    expect(parseBpm('Infinity')).toBeNull();
  });

  it('sets whole bars, clamped to 1..BARS_MAX', () => {
    expect(parseBars('12')).toBe(12);
    expect(parseBars('5.4')).toBe(5);
    expect(parseBars('0')).toBe(1);
    expect(parseBars('9999')).toBe(BARS_MAX);
    expect(parseBars('eight')).toBeNull();
  });
});

describe('dragging the boxes (decision 2)', () => {
  /** Pixels of travel that move a box by `share` of its range, at the knob's feel. */
  const px = (share: number): number => share * NUMBER_DRAG.rangePx;
  const barsPx = (bars: number): number => px(bars / (BARS_MAX - 1));

  it('sweeps tempo at the knob sensitivity, up increasing, at the box step', () => {
    expect(dragBpm(120, 0, false)).toBe(120);
    expect(dragBpm(120, px(0.1), false)).toBe(148);
    expect(dragBpm(120, -px(0.1), false)).toBe(92);
    expect(dragBpm(120, 1, true)).toBeCloseTo(
      120 + (BPM_MAX - BPM_MIN) / NUMBER_DRAG.fineRangePx,
      2,
    );
    expect(dragBpm(120, px(2), false)).toBe(BPM_MAX);
  });

  it('moves bars 6 → 8 → 12 up, 6 → 4 and 4 → 1 down, never past BARS_MAX', () => {
    expect(dragBars(6, barsPx(3), false)).toBe(6);
    expect(dragBars(6, barsPx(4), false)).toBe(8);
    expect(dragBars(6, barsPx(8), false)).toBe(12);
    expect(dragBars(6, -barsPx(4), false)).toBe(4);
    expect(dragBars(4, -barsPx(4), false)).toBe(1);
    expect(dragBars(1, barsPx(4), false)).toBe(4);
    expect(dragBars(250, barsPx(40), false)).toBe(BARS_MAX);
  });
});

describe('tap tempo (decision 4)', () => {
  const tapAll = (times: number[]): (number | null)[] => {
    let taps: readonly number[] = [];
    return times.map((now) => {
      const result = tapTempo(taps, now);
      taps = result.taps;
      return result.bpm;
    });
  };

  it('gives 120 at 500 ms intervals, from the second tap on', () => {
    expect(tapAll([0, 500, 1000, 1500, 2000])).toEqual([null, 120, 120, 120, 120]);
  });

  it('averages only the last four intervals', () => {
    const bpm = tapAll([0, 1000, 1500, 2000, 2500, 3000]).at(-1);
    expect(bpm).toBe(120);
    expect(tapTempo([0, 1000], 1500).taps).toHaveLength(3);
    expect(tapTempo([0, 1, 2, 3, 4], 5).taps).toHaveLength(TAP_TEMPO.intervals + 1);
  });

  it('starts a new average after a 2 s pause', () => {
    const bpms = tapAll([0, 500, 1000, 1000 + TAP_TEMPO.resetMs, 1000 + TAP_TEMPO.resetMs + 400]);
    expect(bpms).toEqual([null, 120, 120, null, 150]);
  });

  it('clamps and rounds to the tempo step', () => {
    expect(tapAll([0, 100]).at(-1)).toBe(BPM_MAX);
    expect(tapAll([0, 700]).at(-1)).toBe(85.71);
  });
});
