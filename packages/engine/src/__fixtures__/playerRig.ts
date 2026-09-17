/**
 * The player tests' rig: a `TickTransport` on one side, four recording parts
 * on the other, and `run(bars)` to drive the transport. Shared by the binding
 * tests and the live-reconfigure cases (#603 grid, #610 Euclidean).
 */
import type { Arrangement } from '../arrangement';
import { ArrangementPlayer } from '../arrangementPlayer';
import { PRESETS } from '../presets';
import { TICKS_PER_BAR, TickTransport } from '../scheduler';
import { FULL_ARRANGEMENT, slotMap, type FullPartId } from './fullArrangement';
import { recordingPart, type RecordingPart } from './recordingPart';

export const fourParts = (): Record<FullPartId, RecordingPart> => ({
  kick: recordingPart(),
  hat: recordingPart(),
  arp: recordingPart(),
  drone: recordingPart(),
});

export interface Rig {
  transport: TickTransport;
  parts: Record<FullPartId, RecordingPart>;
  player: ArrangementPlayer;
  events: Array<{ slot: number; tick: number }>;
  run(bars: number): void;
}

export function rig(arrangement: Arrangement = FULL_ARRANGEMENT): Rig {
  const transport = new TickTransport(120);
  const parts = fourParts();
  const events: Rig['events'] = [];
  const player = new ArrangementPlayer(
    transport,
    slotMap(parts),
    arrangement,
    PRESETS,
    (part, tick) => events.push({ slot: part.slot, tick }),
  );
  const run = (bars: number): void => {
    for (let i = 0; i < bars * TICKS_PER_BAR; i++) transport.advance(transport.transportSeconds);
  };
  return { transport, parts, player, events, run };
}
