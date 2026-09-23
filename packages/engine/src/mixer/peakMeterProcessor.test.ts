/** The actual generated meter, exercised without a browser (#666). */
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import type { PeakReport } from './peakMeterConstants';
interface Processor {
  port: { postMessage(data: PeakReport): void; onmessage(event: { data: { type: string } }): void };
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
}
function rig(rate = 48000) {
  const reports: PeakReport[] = [];
  let ctor!: new () => Processor;
  class Base {
    port = {
      onmessage: null,
      postMessage: (data: PeakReport) => reports.push(structuredClone(data)),
    };
  }
  const script = readFileSync(
    new URL('../worklet/generated/peak-meter-processor.js', import.meta.url),
    'utf8',
  );
  new Function('AudioWorkletProcessor', 'sampleRate', 'registerProcessor', script)(
    Base,
    rate,
    (_name: string, value: typeof ctor) => {
      ctor = value;
    },
  );
  const processor = new ctor();
  const block = (left?: Float32Array, right?: Float32Array): void => {
    const output = [new Float32Array(128), new Float32Array(128)];
    processor.process([left ? (right ? [left, right] : [left]) : []], [output]);
    expect(output[0]!.every((x) => x === 0)).toBe(true);
    expect(output[1]!.every((x) => x === 0)).toBe(true);
  };
  return { processor, reports, block };
}
it.each([44100, 48000, 96000])(
  'captures brief stereo transients and silence at %i Hz without audible output',
  (rate) => {
    const { block, reports } = rig(rate);
    const left = new Float32Array(128);
    left[12] = 0.5;
    const right = new Float32Array(128);
    right[12] = -0.75;
    block(left, right);
    for (let i = 0; i < Math.ceil(rate / 30 / 128); i++) block();
    expect(reports[0]).toMatchObject({
      left: 0.5,
      right: 0.75,
      holdLeft: 0.5,
      holdRight: 0.75,
      overload: false,
    });
    for (let i = 0; i < Math.ceil(rate / 128) + 30; i++) block();
    expect(reports.at(-1)).toMatchObject({ left: 0, right: 0, holdLeft: 0, holdRight: 0 });
  },
);
it('latches overload, handles mono, resets, and stops on disposal', () => {
  const { processor, reports, block } = rig();
  const mono = new Float32Array(128);
  mono[0] = -1.25;
  block(mono);
  for (let i = 0; i < 30; i++) block();
  expect(reports[0]).toMatchObject({ left: 1.25, right: 1.25, overload: true });
  expect(reports.at(-1)!.overload).toBe(true);
  processor.port.onmessage({ data: { type: 'reset' } });
  for (let i = 0; i < 30; i++) block();
  expect(reports.at(-1)).toMatchObject({ overload: false, holdLeft: 0, holdRight: 0 });
  processor.port.onmessage({ data: { type: 'stop' } });
  expect(processor.process([], [])).toBe(false);
});
