/**
 * The metronome through the whole system (windsor#906): `setMetronome`
 * builds one aux part, `metronome`, on the aux fader and outside the song's
 * master, clicks while the transport runs, and ‖, ■ and off drop the clicks
 * the look-ahead queued.
 */
import { afterAll, describe, expect, it } from 'vitest';

import { nodesBetween } from '../__fixtures__/audioAnalysis';
import { FakeContext, installFakeAudioWorklet, sourceOf } from '../__fixtures__/fakeAudioContext';
import type { FakeNode } from '../__fixtures__/fakeAudioNodes';
import { FULL_DOCUMENT } from '../__fixtures__/fullArrangement';
import { PRESETS } from '../patch/presets';
import { METRONOME_PART_NAME, METRONOME_TABLE } from '../sequencing/metronomeTables';
import type { AudioPart } from '../synth/audioPart';
import { FmEngine } from '../synth/fmEngine';
import { AudioSystem } from './audioSystem';

const restore = installFakeAudioWorklet();
afterAll(() => restore());

const CLICK = PRESETS['metronome-click']!;
const fake = (node: AudioNode): FakeNode => node as unknown as FakeNode;

interface Message {
  type?: string;
  note?: number;
  velocity?: number;
}

async function rig(): Promise<{ context: FakeContext; engine: FmEngine; system: AudioSystem }> {
  const context = new FakeContext();
  const engine = new FmEngine(context.asAudioContext());
  const system = new AudioSystem(engine);
  await system.init();
  system.initMusic(FULL_DOCUMENT);
  return { context, engine, system };
}

const part = (engine: FmEngine): AudioPart => {
  const found = engine.getPart(METRONOME_PART_NAME);
  if (!found) throw new Error('no metronome part');
  return found;
};
const posted = (engine: FmEngine): Message[] => sourceOf(part(engine)).posted as Message[];
const noteOns = (messages: Message[]): Message[] => messages.filter((m) => m.type === 'noteOn');

describe('AudioSystem.setMetronome', () => {
  it('clicks on the aux path while the transport runs, the bar line accented', async () => {
    const { context, engine, system } = await rig();
    system.setMetronome(CLICK);
    // Dry into the aux fader and on to the engine master: the song master is not on its way.
    const strip = system.strip(METRONOME_PART_NAME)!;
    const dry = nodesBetween(fake(strip.rotation.output), fake(engine.master));
    expect(dry.map((node) => node.kind)).toEqual(['gain']);
    system.startMusic();
    context.currentTime = 1;
    system.update(0);
    const clicks = noteOns(posted(engine));
    expect(clicks.length).toBeGreaterThan(1);
    expect(clicks[0]).toMatchObject(METRONOME_TABLE.accent);
    expect(clicks[1]).toMatchObject(METRONOME_TABLE.beat);
  });

  it('builds the part once, and off, ‖ and ■ each drop what is queued', async () => {
    const { context, engine, system } = await rig();
    system.setMetronome(CLICK);
    const first = part(engine);
    system.setMetronome(null);
    expect(posted(engine).at(-1)?.type).toBe('allNotesOff');
    system.setMetronome(CLICK);
    expect(part(engine)).toBe(first);

    system.startMusic();
    context.currentTime = 1;
    system.update(0);
    system.setMuted(true);
    expect(posted(engine).at(-1)?.type).toBe('allNotesOff');
    system.setMuted(false);
    context.currentTime = 2;
    system.update(0);
    system.stopMusic();
    expect(posted(engine).at(-1)?.type).toBe('allNotesOff');
    const heard = posted(engine).length;
    context.currentTime = 3;
    system.update(0);
    expect(posted(engine).length).toBe(heard);
  });

  it('clicks nowhere while off, the part never built', async () => {
    const { context, engine, system } = await rig();
    system.setMetronome(null);
    system.startMusic();
    context.currentTime = 1;
    system.update(0);
    expect(engine.getPart(METRONOME_PART_NAME)).toBeUndefined();
    system.stopMusic();
  });
});
