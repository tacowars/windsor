/**
 * Bounce to Roll's caps (windsor#741, `docs/log/2026-10-11-bounce-to-roll.md`
 * decision 6): a region whose loop needs more than `ROLL_NOTES_MAX` notes,
 * or is longer than `ROLL_LOOP_TICKS_MAX`, refuses the whole bounce with
 * the region's number and the count, and changes nothing.
 */
import { describe, expect, it } from 'vitest';

import { BOUNCE_SLOT } from '../__fixtures__/bounceRig';
import { bounceDocument } from '../__fixtures__/bounceToRollRig';
import { ROLL_NOTES_MAX } from '../audioConstants';
import type { ArpSpec } from './arrangement';
import type { Harmony } from '../harmony/harmonyTimeline';
import type { ArrangementDocument } from './arrangementDocument';
import { bounceToRoll } from './bounceToRoll';
import { DEFAULT_ARP_CONFIG } from '../sequencing/arpSequencer';
import { ticksPerBar } from '../sequencing/meter';
import { ROLL_LOOP_TICKS_MAX } from '../sequencing/rollSequencer';
import { DIVISORS, TICKS_PER_BAR } from '../sequencing/scheduler';

/** An Arp at `divisor` whose step variation rests at random, so no region of it repeats. */
const randomArp = (divisor: number, probability: number): ArpSpec => ({
  kind: 'arp',
  ...DEFAULT_ARP_CONFIG,
  divisor,
  randomness: 1,
  probability,
  restsSound: true,
  seed: 7,
});

/** A whole-song chord of A minor over `ticks`. */
const aMinorOver = (ticks: number): Harmony => ({
  root: 9,
  scale: 'naturalMinor',
  events: [{ start: 0, duration: ticks, degree: 0, size: 3 }],
});

/** The bounce refused, and the document left exactly as it was. */
function refused(doc: ArrangementDocument) {
  const before = JSON.stringify(doc);
  const result = bounceToRoll(doc, BOUNCE_SLOT);
  expect(JSON.stringify(doc)).toBe(before);
  if (result.ok) throw new Error('the bounce was not refused');
  return result.refusal;
}

describe('the caps', () => {
  it('refuses a region whose unrolled loop needs more notes than a roll holds, naming it', () => {
    const bars = 80;
    const doc = bounceDocument(randomArp(DIVISORS.thirtySecond, 0.1), {
      transport: { bars },
      harmony: aMinorOver(bars * TICKS_PER_BAR),
      regions: [
        { start: 0, duration: TICKS_PER_BAR },
        { start: TICKS_PER_BAR, duration: (bars - 1) * TICKS_PER_BAR },
      ],
    });
    const refusal = refused(doc);
    expect(refusal).toMatchObject({ cap: 'notes', region: 2 });
    expect(refusal.cap === 'notes' && refusal.notes).toBeGreaterThan(ROLL_NOTES_MAX);
  });

  it('refuses a region in a long 12/8 song whose unrolled loop is past 256 bars of 4/4', () => {
    const bars = 180;
    const bar = ticksPerBar('12/8');
    const doc = bounceDocument(randomArp(DIVISORS.half, 0.5), {
      transport: { bars, meter: '12/8' },
      harmony: aMinorOver(bars * bar),
      regions: [{ start: 0, duration: bars * bar }],
    });
    expect(bars * bar).toBeGreaterThan(ROLL_LOOP_TICKS_MAX);
    expect(refused(doc)).toEqual({ cap: 'loop', region: 1, ticks: bars * bar, bars });
  });
});
