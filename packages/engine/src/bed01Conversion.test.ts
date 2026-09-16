/**
 * One-time proof for #597 (retired with the conversion script in the PR's
 * final commit, per the #583 rule): the version-2 `bed-01.json` renders
 * sample-identically to the four-slot document it was converted from.
 * `__fixtures__/bed01Conversion/baseline.json` was captured on the four-slot
 * code before any #597 change (its own commit): hashes of 8 bars of master,
 * plate and delay output on the graph stand-in, the per-part onset counters,
 * and every message posted to each part.
 */
import { createHash } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';

import baseline from './__fixtures__/bed01Conversion/baseline.json';
import {
  FakeContext,
  installFakeAudioWorklet,
  renderGraph,
  sourceOf,
} from './__fixtures__/fakeAudioContext';
import type { FakeNode } from './__fixtures__/fakeAudioNodes';
import { noteToneFeed } from './__fixtures__/noteFeeds';
import { makeArrangement } from './arrangementDocument';
import raw from './arrangements/bed-01.json';
import { AudioSystem } from './audioSystem';
import { musicPartName } from './documentParts';
import { FmEngine } from './fmEngine';

const restore = installFakeAudioWorklet();
afterAll(() => restore());

/** The retired slot ids by the slot the conversion gave each, and the tone the baseline fed it. */
const RETIRED = [
  ['kick', 233],
  ['hat', 977],
  ['arp', 1447],
  ['drone', 421],
] as const;

const hash = (a: Float32Array): string =>
  createHash('sha256')
    .update(Buffer.from(a.buffer, a.byteOffset, a.byteLength))
    .digest('hex');

describe('bed-01 version 2 renders exactly as the four-slot document did', () => {
  it('matches the pre-conversion baseline, sample for sample', async () => {
    const result = makeArrangement(raw);
    expect(result.corrections).toEqual([]);
    const doc = result.document;
    const context = new FakeContext();
    const engine = new FmEngine(context.asAudioContext());
    const system = new AudioSystem(engine);
    await system.init();
    system.initMusic(doc);
    const posted: Record<string, unknown[]> = {};
    RETIRED.forEach(([id, hz], slot) => {
      const part = engine.getPart(musicPartName(slot));
      if (!part) throw new Error(`no part on slot ${slot}`);
      const node = sourceOf(part);
      node.feed = noteToneFeed(node, hz);
      posted[id] = node.posted;
    });
    system.startMusic();
    const tap = (name: string): FakeNode => system.returnBus(name)?.output as unknown as FakeNode;
    const [master, room, echo] = renderGraph(
      context,
      baseline.bars * (60 / doc.bpm) * 4,
      [engine.master as unknown as FakeNode, tap('room'), tap('echo')],
      () => system.update(0),
    );
    if (!master || !room || !echo) throw new Error('render produced no capture');
    const counters = system.readout().counters;
    expect(Object.fromEntries(RETIRED.map(([id], slot) => [id, counters[slot]]))).toEqual(
      baseline.counters,
    );
    expect([hash(master.left), hash(master.right)]).toEqual(baseline.master);
    expect([hash(room.left), hash(room.right)]).toEqual(baseline.room);
    expect([hash(echo.left), hash(echo.right)]).toEqual(baseline.echo);
    for (const [id] of RETIRED) {
      expect(posted[id]?.length, id).toBe(baseline.postedCount[id]);
      expect(createHash('sha256').update(JSON.stringify(posted[id])).digest('hex'), id).toBe(
        baseline.posted[id],
      );
    }
  });
});
