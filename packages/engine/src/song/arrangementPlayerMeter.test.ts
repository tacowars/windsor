/**
 * The song's meter on the player's clock (windsor#429): the player hands it
 * to the transport and every part's gate at build and on a live partial, so
 * the clock's bars, Euclid's re-cut on the bar line and swing's beats all
 * follow the song's meter.
 */
import { describe, expect, it } from 'vitest';

import { PATCHES, patchesOf, silentPart } from '../__fixtures__/documentCases';
import { recordingPart, type RecordingPart } from '../__fixtures__/recordingPart';
import { ARRANGEMENT_VERSION } from '../audioConstants';
import { songTicks } from '../sequencing/meter';
import { TickTransport, type TickEvent } from '../sequencing/scheduler';
import { makeArrangement } from './arrangementDocument';
import { ArrangementPlayer } from './arrangementPlayer';
import { songTicksOf } from './songClock';

const BPM = 120;

/** A one-part song in `meter`, live for its whole length, with `transport` fields added. */
function play(meter: string, sequencer: unknown, transport: Record<string, unknown> = {}) {
  const bars = 2;
  const { document, corrections } = makeArrangement({
    version: ARRANGEMENT_VERSION,
    patches: PATCHES,
    transport: { bpm: BPM, bars, meter, ...transport },
    parts: [
      {
        slot: 0,
        preset: 'kick',
        regions: [{ start: 0, duration: songTicks(bars, meter as '4/4') }],
        sequencer,
      },
    ],
  });
  expect(corrections).toEqual([]);
  const transportClock = new TickTransport(BPM);
  const part = recordingPart();
  const player = new ArrangementPlayer(
    transportClock,
    new Map([[0, part]]),
    document,
    patchesOf(document),
  );
  const run = (ticks: number): void => {
    for (let i = 0; i < ticks; i++) transportClock.advance(transportClock.transportSeconds);
  };
  return { transport: transportClock, player, part, run };
}

/** Each call's tick, read back from its straight time at the song's tempo. */
const ticksOf = (part: RecordingPart, transport: TickTransport): number[] =>
  part.calls
    .filter((call) => call.kind === 'trigger' || call.kind === 'noteOn')
    .map((call) => call.time! / transport.secondsPerTick);

describe("the player's clock follows the song's meter", () => {
  it('in 6/8 reports bar 1 at tick 72, and Euclid re-cuts its figure there', () => {
    // A tri LFO over two bars: every step of bar 0 fires, one of bar 1.
    const euclid = {
      kind: 'euclidean',
      seed: 0,
      steps: 12,
      divisor: 6,
      pulses: { min: 1, max: 12, start: 12 },
      density: { kind: 'lfoBars', bars: 2, shape: 'tri' },
    };
    const { transport, part, run } = play('6/8', euclid);
    expect(transport.meter).toBe('6/8');
    const bars: TickEvent[] = [];
    transport.subscribe(72, (event) => bars.push(event));
    run(144);
    expect(bars.map(({ bar, tickInBar }) => [bar, tickInBar])).toEqual([
      [0, 0],
      [1, 0],
    ]);
    const hits = ticksOf(part, transport).map(Math.round);
    expect(hits.filter((tick) => tick < 72)).toHaveLength(12);
    expect(hits.filter((tick) => tick >= 72)).toHaveLength(1);
  });

  it("swings a 7/8 bar of 8ths at 66% on beats 1 and 2, and plays beat 3's last 8th straight", () => {
    const note = { kind: 'note', degree: 0, octave: 0, accent: false, slide: false };
    const grid = { kind: 'grid', seed: 0, divisor: 12, steps: Array(7).fill(note) };
    const { transport, part, run } = play('7/8', grid, { swing: { amount: 66, grid: 8 } });
    run(84);
    const off = 0.66 * 24;
    const expected = [0, off, 24, 24 + off, 48, 48 + off, 72];
    const heard = ticksOf(part, transport);
    expect(heard).toHaveLength(expected.length);
    heard.forEach((tick, i) => expect(tick).toBeCloseTo(expected[i]!, 9));
  });

  it('takes a live meter change: the clock, the song length and the cut', () => {
    const { transport, player } = play('4/4', { kind: 'euclidean', seed: 0 });
    expect(player.apply({ transport: { meter: '3/4' } })).toEqual({ ok: true, ignored: [] });
    expect(transport.meter).toBe('3/4');
    expect(songTicksOf(player.arrangement)).toBe(144);
    expect(player.arrangement.parts[0]!.regions).toEqual([{ start: 0, duration: 144 }]);
  });

  it('plays a song without a meter in 4/4', () => {
    const { document } = makeArrangement({
      version: ARRANGEMENT_VERSION,
      patches: PATCHES,
      transport: { bpm: BPM, bars: 1 },
      parts: [{ slot: 0, preset: 'kick', regions: [], sequencer: { kind: 'none' } }],
    });
    const transport = new TickTransport(BPM);
    transport.meter = '7/8';
    new ArrangementPlayer(transport, new Map([[0, silentPart()]]), document, patchesOf(document));
    expect(transport.meter).toBe('4/4');
  });
});
