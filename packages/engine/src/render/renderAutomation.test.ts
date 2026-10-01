/**
 * Automation in an offline render (windsor#344, record
 * `2026-10-01-song-automation-lanes` decision 8): the render pumps the same
 * clock live playback does, so a level lane writes the same events to the
 * part's `gain` as it does online; its opening value is set at time 0 when
 * the system is built, before rendering starts; and a stem, taken after
 * the strip's fader, carries the lane.
 *
 * The fake params apply each event at once rather than over time, so the
 * stem check uses a lane that steps down a bar ahead of where it listens.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { lane, point } from '../__fixtures__/automationRig';
import type { FakeContext } from '../__fixtures__/fakeAudioContext';
import { FakeWorkletNode, installFakeAudioWorklet } from '../__fixtures__/fakeAudioContext';
import type { FakeNode, FakeParam } from '../__fixtures__/fakeAudioNodes';
import { FakeOfflineContext } from '../__fixtures__/fakeOfflineContext';
import { FULL_DOCUMENT, FULL_SLOT, withDocumentPart } from '../__fixtures__/fullArrangement';
import { noteToneFeed } from '../__fixtures__/noteFeeds';
import type { AutomationLane } from '../automation/automationLane';
import type { ArrangementDocument } from '../song/arrangementDocument';
import { musicPartName } from '../song/documentParts';
import { FmEngine } from '../synth/fmEngine';
import { PROCESSOR_NAME } from '../synth/workletMessages';
import { AudioSystem } from '../system/audioSystem';
import { RENDER_QUANTUM_FRAMES } from './renderConstants';
import { renderPass } from './renderPass';
import { planFor } from './renderSong';
import { renderStems } from './renderStems';
import { attachStems } from './stemTaps';

class TonePart extends FakeWorkletNode {
  constructor(context: FakeContext, name: string, options: { processorOptions?: unknown } = {}) {
    super(context, name, options);
    const probe = (context as Partial<FakeOfflineContext>).length === RENDER_QUANTUM_FRAMES;
    if (name === PROCESSOR_NAME && !probe) this.feed = noteToneFeed(this, 440, 0.3);
  }
}

let restore: () => void = () => {};
beforeAll(() => {
  restore = installFakeAudioWorklet();
  (globalThis as { AudioWorkletNode?: unknown }).AudioWorkletNode = TonePart;
});
afterAll(() => restore());

const RATE = 8000;
const { hat } = FULL_SLOT;
const TWO_BARS: ArrangementDocument = {
  ...FULL_DOCUMENT,
  transport: { ...FULL_DOCUMENT.transport, bars: 2 },
};
const FADE = lane('strip.level', [point(0, 0.25, 0.5), point(96, 1, -0.3), point(192, 0.4)]);
const withLanes = (automation: readonly AutomationLane[]): ArrangementDocument =>
  withDocumentPart(TWO_BARS, 'hat', { automation });

const gainOf = (system: AudioSystem): FakeParam =>
  system.strip(musicPartName(hat))!.part.gain as unknown as FakeParam;

type Call = FakeParam['automation'][number];

/** The hat's level events from an offline render, and what they were when rendering began. */
async function offline(document: ArrangementDocument): Promise<{ calls: Call[]; opening: Call[] }> {
  const plan = planFor(document, { sampleRate: RATE, tailSeconds: 0 });
  let gain: FakeParam | undefined;
  let opening: Call[] = [];
  await renderPass(
    document,
    plan,
    { sampleRate: RATE, createContext: (init) => new FakeOfflineContext(init) },
    {
      channels: 2,
      attach: (system) => {
        gain = gainOf(system);
        opening = gain.automation.slice();
        return () => {};
      },
    },
  );
  return { calls: gain!.automation, opening };
}

/** The same song played live on a fake context, pumped to `until`. */
async function online(document: ArrangementDocument, until: number): Promise<Call[]> {
  const context = new FakeOfflineContext({ numberOfChannels: 2, length: 128, sampleRate: RATE });
  const system = new AudioSystem(new FmEngine(context.asAudioContext()), { defer: (r) => r() });
  await system.init();
  system.initMusic(document);
  system.startMusic();
  for (let t = 0; t <= until; t += 0.05) {
    context.currentTime = t;
    system.update(0);
  }
  return gainOf(system).automation;
}

describe('a level lane in an offline render', () => {
  it('sets its opening value at time 0 before rendering, and schedules what playback does', async () => {
    const document = withLanes([FADE]);
    const { calls, opening } = await offline(document);
    expect(opening).toEqual([
      { call: 'cancelScheduledValues', value: TWO_BARS.parts[1]!.strip.level, time: 0 },
      { call: 'setValueAtTime', value: 0.25, time: 0 },
    ]);
    const plan = planFor(document, { sampleRate: RATE, tailSeconds: 0 });
    const end = plan.endSeconds;
    const live = await online(document, end);
    const before = (list: Call[]): Call[] => list.filter((c) => c.time! < end - 1e-9);
    expect(before(calls).length).toBeGreaterThan(150);
    expect(before(calls)).toEqual(before(live));
  });

  it('leaves a song with no lanes unscheduled', async () => {
    const { calls } = await offline(TWO_BARS);
    expect(calls).toEqual([]);
  });

  it("carries the lane into the part's stem", async () => {
    // Full level for the first bar, silent from the second.
    const cut = lane('strip.level', [point(0, 1), point(96, 1), point(96, 0)]);
    const stems = new Map<string, Float32Array>();
    await renderStems(
      withLanes([cut]),
      { sampleRate: RATE, tailSeconds: 0, createContext: (init) => new FakeOfflineContext(init) },
      async ({ stem, channels }) => {
        if (stem.kind === 'part') stems.set(String(stem.slot), channels[0]!.slice());
      },
    );
    const bar = Math.round((RATE * 60 * 4) / TWO_BARS.transport.bpm);
    const peak = (from: number, to: number): number =>
      stems
        .get(String(hat))!
        .subarray(from, to)
        .reduce((m, s) => Math.max(m, Math.abs(s)), 0);
    expect(peak(0, Math.round(bar * 0.7))).toBeGreaterThan(1e-3);
    expect(peak(Math.round(bar * 1.3), 2 * bar)).toBeLessThan(1e-9);
  });
});

describe('a pan lane on a "Sidechain only" part exported as a stem', () => {
  const SWEEP = lane('strip.pan', [point(0, -1, 0.4), point(192, 1)]);
  const KEYS = ['ll', 'lr', 'rl', 'rr'] as const;
  // A fake cancel records the value the param held, which is no event: compare the events.
  const events = (calls: Call[]): object[] =>
    calls.map(({ call, value, time }) =>
      call === 'cancelScheduledValues' ? { call, time } : { call, value, time },
    );

  it("schedules the stem's rotation exactly as the strip's", async () => {
    const document = withDocumentPart(TWO_BARS, 'hat', {
      automation: [SWEEP],
      strip: { ...TWO_BARS.parts[1]!.strip, output: 'sidechain' },
    });
    const plan = planFor(document, { sampleRate: RATE, tailSeconds: 0 });
    let strip: FakeParam[] = [];
    let stem: FakeParam[] = [];
    let opening = 0;
    await renderPass(
      document,
      plan,
      { sampleRate: RATE, createContext: (init) => new FakeOfflineContext(init) },
      {
        channels: 4,
        attach: (system) => {
          const live = system.strip(musicPartName(hat))!;
          strip = KEYS.map((k) => live.rotation.gains[k].gain as unknown as FakeParam);
          opening = strip[0]!.automation.length;
          const detach = attachStems(system, [
            { kind: 'part', slot: hat, name: 'hat', muted: true },
          ]);
          // The stem's rotation: the splitter `head` was last connected to, and its four gains.
          const head = live.head as unknown as FakeNode;
          const input = head.outbound.at(-1)!.to as FakeNode;
          stem = input.outbound.map(
            (c) => (c.to as FakeNode as unknown as GainNode).gain as unknown as FakeParam,
          );
          return detach;
        },
      },
    );
    expect(stem).toHaveLength(4);
    expect(stem[0]!.automation.length).toBeGreaterThan(150);
    // From the resync the stem's tap asked for, both rotations got the same events.
    stem.forEach((param, i) => {
      expect(events(param.automation)).toEqual(events(strip[i]!.automation.slice(opening)));
    });
    // And the resync held where the strip's opening hold did.
    expect(events(stem[0]!.automation.slice(0, 2))).toEqual(
      events(strip[0]!.automation.slice(0, 2)),
    );
  });
});
