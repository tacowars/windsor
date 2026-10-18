import { describe, expect, it } from 'vitest';

import { type ClickVoice, Metronome, beatAt, beatGrid } from './metronome';
import { METER_TABLE } from './meterTables';
import { METRONOME_TABLE } from './metronomeTables';
import { TickTransport } from './scheduler';
import { SWING_AMOUNT_MAX } from './swingTables';

interface Click {
  tick: number;
  note: number;
  velocity: number;
  time: number;
}

/** A transport, a metronome on it, and the clicks it played with the tick each fell on. */
function rig(bpm = 120): {
  transport: TickTransport;
  metronome: Metronome;
  clicks: Click[];
  offs: { count: number };
  run(ticks: number): void;
} {
  const transport = new TickTransport(bpm);
  let tick = 0;
  // Subscribed first, so the tick is known when the metronome's click lands on it.
  transport.subscribe(1, (event) => {
    tick = event.tick;
  });
  const clicks: Click[] = [];
  const offs = { count: 0 };
  const voice: ClickVoice = {
    trigger(note, velocity, duration, time) {
      expect(duration).toBe(METRONOME_TABLE.gateSeconds);
      clicks.push({ tick, note, velocity, time });
      return clicks.length;
    },
    allNotesOff() {
      offs.count++;
    },
  };
  const metronome = new Metronome(transport, voice);
  const run = (ticks: number): void => {
    for (let i = 0; i < ticks; i++) transport.advance(transport.transportSeconds);
  };
  return { transport, metronome, clicks, offs, run };
}

const ACCENT = METRONOME_TABLE.accent;
const BEAT = METRONOME_TABLE.beat;

describe('the metronome tables', () => {
  it('puts the beat 4 dB under the accent, A6 over E6', () => {
    expect(ACCENT).toEqual({ note: 93, velocity: 1 });
    expect(BEAT.note).toBe(88);
    expect(20 * Math.log10(BEAT.velocity / ACCENT.velocity)).toBeCloseTo(-4, 10);
  });

  it('subscribes on the 12-tick grid every shipped meter beat starts on', () => {
    expect(beatGrid(METER_TABLE)).toBe(12);
    expect(beatAt(0, METER_TABLE['7/8'])).toBe(0);
    expect(beatAt(24, METER_TABLE['7/8'])).toBe(1);
    expect(beatAt(48, METER_TABLE['7/8'])).toBe(2);
    expect(beatAt(36, METER_TABLE['7/8'])).toBe(-1);
    expect(beatAt(72, METER_TABLE['7/8'])).toBe(-1);
  });
});

describe('the metronome on the transport', () => {
  it('clicks every quarter in 4/4, the bar line accented', () => {
    const { metronome, clicks, run } = rig();
    metronome.setOn(true);
    run(2 * 96);
    expect(clicks.map((c) => c.tick)).toEqual([0, 24, 48, 72, 96, 120, 144, 168]);
    expect(clicks.map((c) => c.note)).toEqual([93, 88, 88, 88, 93, 88, 88, 88]);
    expect(clicks[0]!.velocity).toBe(ACCENT.velocity);
    expect(clicks[1]!.velocity).toBe(BEAT.velocity);
    // At the tick's stamped time: 120 BPM is half a second a beat.
    expect(clicks[1]!.time).toBeCloseTo(0.5, 12);
  });

  it('clicks two dotted quarters a bar in 6/8 and 2+2+3 in 7/8', () => {
    const six = rig();
    six.transport.meter = '6/8';
    six.metronome.setOn(true);
    six.run(2 * 72);
    expect(six.clicks.map((c) => [c.tick, c.note])).toEqual([
      [0, 93],
      [36, 88],
      [72, 93],
      [108, 88],
    ]);
    const seven = rig();
    seven.transport.meter = '7/8';
    seven.metronome.setOn(true);
    seven.run(84);
    expect(seven.clicks.map((c) => [c.tick, c.note])).toEqual([
      [0, 93],
      [24, 88],
      [48, 88],
    ]);
  });

  it('keeps the accent on the bar line after a seek mid-bar', () => {
    const { transport, metronome, clicks, run } = rig();
    metronome.setOn(true);
    transport.reset(30);
    run(96);
    expect(clicks.map((c) => [c.tick, c.note])).toEqual([
      [48, 88],
      [72, 88],
      [96, 93],
      [120, 88],
    ]);
  });

  it('keeps the accent on the bar line through a loop that starts mid-bar', () => {
    const { transport, metronome, clicks, run } = rig();
    transport.loop = { start: 48, end: 192, songTicks: 4 * 96 };
    transport.reset(48);
    metronome.setOn(true);
    run(2 * 144);
    const accents = clicks.filter((c) => c.note === ACCENT.note).map((c) => c.tick);
    expect(accents).toEqual([96, 96]);
    expect(clicks.map((c) => c.tick)).toEqual([
      48, 72, 96, 120, 144, 168, 48, 72, 96, 120, 144, 168,
    ]);
  });

  it('takes a tempo or a meter change from the next beat', () => {
    const { transport, metronome, clicks, run } = rig();
    metronome.setOn(true);
    run(24);
    transport.bpm = 60;
    run(48);
    // The first beat at 120 BPM (0.5 s), the next at 60 (one second later).
    expect(clicks[2]!.time - clicks[1]!.time).toBeCloseTo(1, 12);
    const meter = rig();
    meter.metronome.setOn(true);
    meter.run(96 + 25);
    meter.transport.meter = '7/8';
    meter.run(96);
    // Ticks 0..120 in 4/4, then 84-tick bars from tick 0: 132 is the third beat of bar 2 (84 + 48), 168 a bar line.
    expect(meter.clicks.map((c) => [c.tick, c.note]).slice(-4)).toEqual([
      [132, 88],
      [168, 93],
      [192, 88],
      [216, 88],
    ]);
  });

  it('leaves its clicks on the beats under swing', () => {
    const { transport, metronome, clicks, run } = rig();
    transport.swing = { amount: SWING_AMOUNT_MAX, grid: 8 };
    metronome.setOn(true);
    run(96);
    expect(clicks.map((c) => c.time)).toEqual([0, 0.5, 1, 1.5].map((t) => expect.closeTo(t, 9)));
  });

  it('stops on off and drops what is queued; a halt drops it too, only while on', () => {
    const { metronome, clicks, offs, run } = rig();
    metronome.halt();
    expect(offs.count).toBe(0);
    metronome.setOn(true);
    run(30);
    metronome.halt();
    expect(offs.count).toBe(1);
    metronome.setOn(false);
    expect(offs.count).toBe(2);
    expect(metronome.on).toBe(false);
    const heard = clicks.length;
    run(96);
    expect(clicks.length).toBe(heard);
    metronome.setOn(false);
    expect(offs.count).toBe(2);
  });
});
