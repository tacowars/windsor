/**
 * Sync on over an engaged Time lane (windsor#816, fix round 2 for PR #817,
 * Codex P1): the lane goes inert and gives the line back, and the line slews
 * from the lane's value there to the synced time instead of jumping. Played
 * on the live engine, so the insert resync in `SongAutomation.apply` and
 * the handle's release run as they do in the app.
 */
import { afterAll, describe, expect, it } from 'vitest';

import { lane, point } from '../__fixtures__/automationRig';
import { FakeContext } from '../__fixtures__/fakeAudioContext';
import type { FakeNode, FakeParam } from '../__fixtures__/fakeAudioNodes';
import { FakeDelay } from '../__fixtures__/fakeAudioNodes';
import {
  FULL_DOCUMENT,
  FULL_SLOT,
  FULL_STRIPS,
  withDocumentPart,
} from '../__fixtures__/fullArrangement';
import { ENGINE_WORKLETS, installParamWorklet } from '../__fixtures__/insertParamRig';
import { fake } from '../__fixtures__/stripRig';
import { TICKS_PER_BAR } from '../sequencing/scheduler';
import { musicPartName } from '../song/documentParts';
import { FmEngine } from '../synth/fmEngine';
import { AudioSystem } from '../system/audioSystem';
import type { EchoSpec } from './echoInsert';
import { DEFAULT_ECHO } from './echoInsert';
import { ECHO_TIME_SLEW_S } from './echoConstants';
import { echoSeconds } from './echoTempo';
import type { InsertSpec } from './insertRegistry';

const restore = installParamWorklet(ENGINE_WORKLETS);
afterAll(() => restore());

const { hat } = FULL_SLOT;
const S = ECHO_TIME_SLEW_S;
const FREE = { ...DEFAULT_ECHO, id: 'echo1', sync: false } as InsertSpec;
/** Time rising from 0.1 s to 1 s over the song. */
const TIME = lane('insert.echo1.delayTime', [point(0, 0.1), point(4 * TICKS_PER_BAR, 1)]);

/** The first delay line downstream of `node`: the Echo's loop. */
function lineAfter(node: AudioNode): FakeDelay {
  const queue: FakeNode[] = [fake(node)];
  for (let next = queue.shift(); next; next = queue.shift()) {
    if (next instanceof FakeDelay) return next;
    queue.push(...next.outbound.map((c) => c.to));
  }
  throw new Error('no delay line after the node');
}

describe('Sync on over an engaged Time lane', () => {
  it('slews from the lane’s value to the synced time, with no jump', async () => {
    const context = new FakeContext();
    const sys = new AudioSystem(new FmEngine(context.asAudioContext()), { defer: () => {} });
    await sys.init();
    const strip = { ...FULL_STRIPS.hat, inserts: [FREE] };
    sys.initMusic(withDocumentPart(FULL_DOCUMENT, 'hat', { strip, automation: [TIME] }));
    sys.startMusic();
    for (let t = 0; t <= 1; t += 0.025) {
      context.currentTime = t;
      sys.update(0);
    }
    const at = 1;
    context.currentTime = at;
    const echo = sys.strip(musicPartName(hat))!.inserts.find((s) => s.kind === 'echo')!;
    const time = lineAfter(echo.input).delayTime as unknown as FakeParam;
    // A browser reports `value` from the timeline at the audio clock.
    time.readsTimelineAt = () => context.currentTime;
    const played = time.valueAt(at);
    expect(played).toBeGreaterThan(0.1);

    const synced = { ...FREE, sync: true } as InsertSpec;
    expect(sys.apply({ parts: { [hat]: { strip: { inserts: [synced] } } } }).ok).toBe(true);
    const target = echoSeconds(synced as EchoSpec, FULL_DOCUMENT.transport.bpm);
    expect(time.valueAt(at)).toBeCloseTo(played, 9);
    expect(time.valueAt(at + S / 2)).toBeCloseTo((played + target) / 2, 9);
    expect(time.valueAt(at + S)).toBeCloseTo(target, 9);
    // The lane is inert from the Sync on: nothing it played afterwards reaches the line.
    for (let t = at; t <= at + 1; t += 0.025) {
      context.currentTime = t;
      sys.update(0);
    }
    expect(time.valueAt(at + 1)).toBeCloseTo(target, 9);
  });
});
