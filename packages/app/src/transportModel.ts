/**
 * The transport strip's pure rules (#708): the `bar.beat.sixteenth` position
 * a tick reads as, the ▶ ■ ‖ state machine, and the partials the strip's
 * controls write. No DOM, no engine — `transportModel.test.ts` pins them.
 *
 * Epic #703 decision 8: ▶ runs from the current position; ■ halts, releases
 * every voice and rewinds to tick 0; ‖ pauses keeping the position (the
 * game's mute). The pressed state is ▶ or ‖; ■ is momentary.
 */
import type {
  DocumentPartial,
  ScaleName,
} from '../../../packages/client/src/audio/index-for-editor';
import { SCALE_NAMES } from '../../../packages/client/src/audio/index-for-editor';
import { POSITION_GRID, type PositionGrid } from './transportTables';

export type TransportState = 'idle' | 'playing' | 'paused';
export type TransportAction = 'play' | 'pause' | 'stop';

/**
 * The song position of a transport tick, 1-based: tick 0 → `1.1.1`, tick 95
 * → `1.4.4`, tick 96 → `2.1.1`. The transport's tick never wraps; the song
 * does (`tick mod songTicks`, epic #703 decision 5), so the readout does too.
 */
export function formatPosition(
  tick: number,
  songTicks: number,
  grid: PositionGrid = POSITION_GRID,
): string {
  const t = songTicks > 0 ? ((tick % songTicks) + songTicks) % songTicks : Math.max(0, tick);
  const bar = Math.floor(t / grid.bar) + 1;
  const beat = Math.floor((t % grid.bar) / grid.beat) + 1;
  const sixteenth = Math.floor((t % grid.beat) / grid.sixteenth) + 1;
  return `${bar}.${beat}.${sixteenth}`;
}

/**
 * The next state: ▶ plays from anywhere; ‖ pauses only what is playing (an
 * idle or paused transport stays put); ■ is idle at tick 0 from anywhere.
 */
export function nextTransportState(state: TransportState, action: TransportAction): TransportState {
  switch (action) {
    case 'play':
      return 'playing';
    case 'pause':
      return state === 'playing' ? 'paused' : state;
    case 'stop':
      return 'idle';
  }
}

/** Which of ▶ / ‖ shows pressed; ■ never does. */
export const pressedButtons = (state: TransportState): { play: boolean; pause: boolean } => ({
  play: state === 'playing',
  pause: state === 'paused',
});

/** The strip's writes, each a live partial for `ctx.change` (issue decision 1). */
export const bpmChange = (bpm: number): DocumentPartial => ({ transport: { bpm } });
export const barsChange = (bars: number): DocumentPartial => ({ transport: { bars } });
export const keyChange = (root: number): DocumentPartial => ({ harmony: { root } });

/** A scale pick as a partial, or null for a value that names no scale (the custom row). */
export function scaleChange(name: string): DocumentPartial | null {
  const picked: ScaleName | undefined = SCALE_NAMES.find((known) => known === name);
  return picked ? { harmony: { scale: picked } } : null;
}
