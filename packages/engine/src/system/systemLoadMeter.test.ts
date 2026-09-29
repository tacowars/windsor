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
