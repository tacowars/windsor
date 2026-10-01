/**
 * The lane cells' click gates (windsor#31), one per card: the gate that
 * pairs two presses into a double-click must outlive a repaint between
 * them. The grid card hands the same `LaneHost` for its life, so its gate
 * is keyed by the host; a card that builds a new host on every repaint (the
 * Euclid card's sound lanes) names a stable `gateKey` instead, and the
 * gate's writes go through the newest host it was asked for with.
 */
import { LaneClickGate, type LaneClock } from './stepModLaneClicks';
import { withParamValues } from './stepModLaneModel';
import type { LaneHost } from './stepModLane';

/** What a gate needs of its host: the lanes, the write, the repaint, and the key it lives under. */
export type GateHost = Pick<LaneHost, 'lanes' | 'write' | 'repaint' | 'gateKey'>;

interface Entry {
  readonly gate: LaneClickGate;
  /** The host the gate's next write goes through: the newest one under its key. */
  host: GateHost;
}

const pageClock: LaneClock = { now: () => performance.now() };

/** One gate per key: the host's `gateKey`, else the host itself. */
const gates = new WeakMap<object, Entry>();

/** The click gate for `host`'s card, its writes through `host`. */
export function gateOf(host: GateHost, clock: LaneClock = pageClock): LaneClickGate {
  const key = host.gateKey ?? host;
  const found = gates.get(key);
  if (found) {
    found.host = host;
    return found.gate;
  }
  const gate = new LaneClickGate((param, values) => {
    const now = gates.get(key)?.host ?? host;
    const lanes = now.lanes();
    // The lane is named by its parameter: gone means no write.
    const next = lanes && withParamValues(lanes, param, values);
    if (next && !now.write(next)) now.repaint();
  }, clock);
  gates.set(key, { gate, host });
  return gate;
}
