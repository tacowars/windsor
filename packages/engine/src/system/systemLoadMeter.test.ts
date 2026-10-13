/**
 * `SystemLoadMeter` on its own: which nodes it turns the sampler on in, the
 * insert registry it hands the strips, and the one switch (windsor#51
 * decision 6) that turns all of it off for the offline render.
 */
import { describe, expect, it } from 'vitest';

import { AUDIO_LOAD_REPORT_SECONDS, RENDER_QUANTUM_FRAMES } from '../audioConstants';
import { SAMPLE_RATE } from '../__fixtures__/fakeAudioContext';
import { INSERT_KINDS } from '../inserts/insertRegistry';
import { SystemLoadMeter } from './systemLoadMeter';

interface FakePort {
  posted: unknown[];
  postMessage(message: unknown): void;
  onmessage: ((event: { data: unknown }) => void) | null;
}

const context = { sampleRate: SAMPLE_RATE } as BaseAudioContext;

/** A node with a processor behind it: a port that records what it is sent. */
function processorNode(): { node: AudioNode; port: FakePort } {
  const port: FakePort = {
    posted: [],
    postMessage(message) {
      this.posted.push(message);
    },
    onmessage: null,
  };
  return { node: { port } as unknown as AudioNode, port };
}

const REPORT = { type: 'load', busyMs: 5, wallMs: 1000, quanta: 375, peakMs: 1, underruns: 0 };

describe('SystemLoadMeter', () => {
  it('asks a processor to report once per AUDIO_LOAD_REPORT_SECONDS, and counts it', () => {
    const meter = new SystemLoadMeter(context, true);
    const { node, port } = processorNode();
    meter.attach('part:a', node);
    const quanta = Math.round((AUDIO_LOAD_REPORT_SECONDS * SAMPLE_RATE) / RENDER_QUANTUM_FRAMES);
    expect(port.posted).toEqual([{ type: 'reportLoad', quanta }]);
    expect(meter.processorCount).toBe(1);
  });

  it('sums what an attached processor reports into the readout', () => {
    const meter = new SystemLoadMeter(context, true);
    const { node, port } = processorNode();
    meter.attach('return:room', node);
    expect(meter.readout().processors).toBe(0);
    port.onmessage?.({ data: REPORT });
    expect(meter.readout().processors).toBe(1);
  });

  it('skips a missing node and a node with no processor', () => {
    const meter = new SystemLoadMeter(context, true);
    meter.attach('outputStage', undefined);
    meter.attach('return:echo', {} as AudioNode);
    expect(meter.processorCount).toBe(0);
  });

  it('stops counting a detached processor and silences its port', () => {
    const meter = new SystemLoadMeter(context, true);
    const { node, port } = processorNode();
    meter.attach('part:a', node);
    meter.detach('part:a');
    expect(meter.processorCount).toBe(0);
    expect(port.onmessage).toBeNull();
  });

  it('meters the inserts the registry builds, keeping every kind', () => {
    const registry = new SystemLoadMeter(context, true).registry(INSERT_KINDS);
    expect(registry).not.toBe(INSERT_KINDS);
    expect(Object.keys(registry)).toEqual(Object.keys(INSERT_KINDS));
  });

  it('turns nothing on when disabled: no attach, and the registry passed through', () => {
    const meter = new SystemLoadMeter(context, false);
    const { node, port } = processorNode();
    meter.attach('part:a', node);
    expect(port.posted).toEqual([]);
    expect(meter.processorCount).toBe(0);
    expect(meter.registry(INSERT_KINDS)).toBe(INSERT_KINDS);
  });

  it('lets go of every port on dispose', () => {
    const meter = new SystemLoadMeter(context, true);
    const { node, port } = processorNode();
    meter.attach('part:a', node);
    meter.dispose();
    expect(port.onmessage).toBeNull();
  });
});

/** A context whose audio clock and wall clock the test moves by hand. */
function clockedContext(stats?: { underrunEvents: number }) {
  const clock = { wallMs: 0 };
  const context = {
    sampleRate: SAMPLE_RATE,
    currentTime: 0,
    state: 'running' as AudioContextState,
    playbackStats: stats,
  };
  const meter = new SystemLoadMeter(
    context as unknown as BaseAudioContext,
    true,
    () => clock.wallMs,
  );
  /** Let `seconds` of wall time pass, the audio clock advancing at `rate`. */
  const advance = (seconds: number, rate: number): void => {
    clock.wallMs += seconds * 1000;
    context.currentTime += seconds * rate;
  };
  return { context, meter, advance };
}

describe('SystemLoadMeter: the audio clock and the device (windsor#794)', () => {
  it('reads a clock that advances 0.9 s per wall second as 0.9', () => {
    const { meter, advance } = clockedContext();
    meter.readout();
    advance(AUDIO_LOAD_REPORT_SECONDS, 0.9);
    expect(meter.readout().clockRate).toBeCloseTo(0.9, 6);
  });

  it('reads a clock that keeps up as 1.0', () => {
    const { meter, advance } = clockedContext();
    meter.readout();
    advance(AUDIO_LOAD_REPORT_SECONDS, 1.003);
    expect(Math.abs((meter.readout().clockRate ?? 0) - 1)).toBeLessThan(0.005);
  });

  it('is null before a whole interval has passed, and while suspended', () => {
    const { context, meter, advance } = clockedContext();
    expect(meter.readout().clockRate).toBeNull();
    advance(AUDIO_LOAD_REPORT_SECONDS / 2, 1);
    expect(meter.readout().clockRate).toBeNull();
    advance(AUDIO_LOAD_REPORT_SECONDS / 2, 1);
    expect(meter.readout().clockRate).toBe(1);
    context.state = 'suspended';
    advance(AUDIO_LOAD_REPORT_SECONDS, 0);
    expect(meter.readout().clockRate).toBeNull();
    // Resumed, it starts a fresh interval rather than averaging over the pause.
    context.state = 'running';
    expect(meter.readout().clockRate).toBeNull();
  });

  it('reads no device figure where the context has no playbackStats', () => {
    const { meter } = clockedContext();
    expect(meter.readout().deviceUnderruns).toBeNull();
  });

  it('holds the device count monotone where playbackStats is present', () => {
    const stats = { underrunEvents: 2 };
    const { meter } = clockedContext(stats);
    expect(meter.readout().deviceUnderruns).toBe(2);
    stats.underrunEvents = 5;
    expect(meter.readout().deviceUnderruns).toBe(5);
    stats.underrunEvents = 1;
    expect(meter.readout().deviceUnderruns).toBe(5);
  });

  it('reads neither on a system that does not meter', () => {
    const disabled = new SystemLoadMeter(
      {
        ...context,
        currentTime: 0,
        state: 'running',
        playbackStats: { underrunEvents: 3 },
      } as unknown as BaseAudioContext,
      false,
    );
    expect(disabled.readout().clockRate).toBeNull();
    expect(disabled.readout().deviceUnderruns).toBeNull();
  });
});
