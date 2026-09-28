/**
 * Feeds driven by the note messages a part was actually sent, so a headless
 * render can attribute energy per part: the fake `fm-part` node plays a
 * fixed-frequency tone whenever one of its scheduled notes is sounding.
 * Envelopes are not modelled — presence is what the routing assertions need —
 * and the tone starts and stops sample-exactly on the scheduled frames, the
 * same frames the real worklet splits its render blocks at. Node-only, like
 * the rest of this directory.
 */
import type { FakeWorkletNode } from './fakeAudioContext';
import { SAMPLE_RATE } from './fakeAudioContext';
import { BLOCK } from './fakeAudioNodes';
import type { Feed } from './reverbHarness';

interface Interval {
  on: number;
  off: number;
}

/**
 * Sounding intervals in absolute frames, from the notes the node was built
 * holding and the messages posted to it so far.
 */
function intervals(node: FakeWorkletNode): Interval[] {
  const ons = new Map<number, number>();
  const offs = new Map<number, number>();
  for (const message of [...node.events, ...node.posted]) {
    const m = message as { type?: string; id?: number; frame?: number };
    if (m.id === undefined || m.frame === undefined) continue;
    if (m.type === 'noteOn') ons.set(m.id, m.frame);
    else if (m.type === 'noteOff') offs.set(m.id, m.frame);
  }
  return [...ons.entries()].map(([id, on]) => ({ on, off: offs.get(id) ?? Infinity }));
}

/** A sine at `hz` while any of the node's scheduled notes is sounding. */
export function noteToneFeed(node: FakeWorkletNode, hz: number, amplitude = 0.4): Feed {
  return (block, left, right) => {
    const start = block * BLOCK;
    const sounding = intervals(node).filter((iv) => iv.on < start + BLOCK && iv.off > start);
    if (sounding.length === 0) return;
    for (let i = 0; i < BLOCK; i++) {
      const frame = start + i;
      if (!sounding.some((iv) => frame >= iv.on && frame < iv.off)) continue;
      const sample = amplitude * Math.sin((2 * Math.PI * hz * frame) / SAMPLE_RATE);
      left[i] = sample;
      right[i] = sample;
    }
  };
}
