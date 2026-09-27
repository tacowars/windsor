/**
 * The audible acceptance criteria of issue #69, asserted on a headless render
 * of the full stack: `AudioSystem` builds the four parts on the graph
 * stand-in, the transport drives the real generators, and each fake `fm-part`
 * plays a distinct tone while its scheduled notes sound — so energy on each
 * return can be attributed to a part by frequency. The hall hears the arp and
 * the drone, the delay hears the hat only, and the kick stays dry.
 *
 * These are the agent's half of the listening gate (refinement decision 6);
 * whether the defaults are musical is the maintainer's ear, not a test.
 */
import { afterAll, describe, expect, it } from 'vitest';

import { rms, toneLevel } from '../__fixtures__/audioAnalysis';
import {
  FakeContext,
  installFakeAudioWorklet,
  renderGraph,
  sourceOf,
} from '../__fixtures__/fakeAudioContext';
import type { FakeNode } from '../__fixtures__/fakeAudioNodes';
import { noteToneFeed } from '../__fixtures__/noteFeeds';
import {
  FULL_ARRANGEMENT,
  FULL_DOCUMENT,
  FULL_PART_IDS,
  FULL_SLOT,
  type FullPartId,
} from '../__fixtures__/fullArrangement';
import { AudioSystem } from './audioSystem';
import { musicPartName } from '../song/documentParts';
import { FmEngine } from '../synth/fmEngine';

const restore = installFakeAudioWorklet();
afterAll(() => restore());

/** One tone per part, far enough apart that Goertzel attribution is unambiguous. */
const HZ: Record<FullPartId, number> = { kick: 233, hat: 977, arp: 1447, drone: 421 };

const BAR_SECONDS = (60 / FULL_ARRANGEMENT.transport.bpm) * 4;

interface Rig {
  context: FakeContext;
  engine: FmEngine;
  system: AudioSystem;
  noteOns(): number;
}

async function musicRig(): Promise<Rig> {
  const context = new FakeContext();
  const engine = new FmEngine(context.asAudioContext());
  const system = new AudioSystem(engine);
  await system.init();
  system.initMusic(FULL_DOCUMENT);
  for (const id of FULL_PART_IDS) {
    const part = engine.getPart(musicPartName(FULL_SLOT[id]));
    if (!part) throw new Error(`no part "${id}"`);
    const node = sourceOf(part);
    node.feed = noteToneFeed(node, HZ[id]);
  }
  const noteOns = (): number =>
    FULL_PART_IDS.reduce((total, id) => {
      const part = engine.getPart(musicPartName(FULL_SLOT[id]));
      if (!part) return total;
      return (
        total +
        sourceOf(part).posted.filter((m) => (m as { type?: string }).type === 'noteOn').length
      );
    }, 0);
  return { context, engine, system, noteOns };
}

function tap(system: AudioSystem, name: string): FakeNode {
  const bus = system.returnBus(name);
  if (!bus) throw new Error(`no return "${name}"`);
  return bus.output as unknown as FakeNode;
}

describe('the audible arrangement', () => {
  it('renders 8 bars with every part sounding and each return fed as tabled', async () => {
    const { context, engine, system } = await musicRig();
    system.startMusic();
    const [room, echo, master] = renderGraph(
      context,
      8 * BAR_SECONDS,
      [tap(system, 'room'), tap(system, 'echo'), engine.master as unknown as FakeNode],
      () => system.update(0),
    );
    if (!room || !echo || !master) throw new Error('render produced no captures');

    const counters = system.readout().counters;
    for (const id of FULL_PART_IDS) expect(counters[FULL_SLOT[id]], id).toBeGreaterThan(0);

    // Orderings per return, not absolute levels (acceptance criterion).
    const inRoom = (id: FullPartId): number => toneLevel(room.left, HZ[id]);
    const inEcho = (id: FullPartId): number => toneLevel(echo.left, HZ[id]);
    expect(rms(room.left)).toBeGreaterThan(1e-4);
    expect(rms(echo.left)).toBeGreaterThan(1e-4);

    // Hall: arp and drone, far above anything the hat or kick leaks.
    expect(inRoom('arp')).toBeGreaterThan(10 * inRoom('hat'));
    expect(inRoom('arp')).toBeGreaterThan(10 * inRoom('kick'));
    expect(inRoom('drone')).toBeGreaterThan(10 * inRoom('hat'));
    expect(inRoom('drone')).toBeGreaterThan(10 * inRoom('kick'));

    // Delay: the hat only.
    expect(inEcho('hat')).toBeGreaterThan(10 * inEcho('kick'));
    expect(inEcho('hat')).toBeGreaterThan(10 * inEcho('arp'));
    expect(inEcho('hat')).toBeGreaterThan(10 * inEcho('drone'));

    // The kick is audible dry and reaches neither return: its sends are zero,
    // so what little sits at its frequency in a return is gating splatter from
    // the other parts' note edges, orders of magnitude below the dry kick.
    const dryKick = toneLevel(master.left, HZ.kick);
    expect(dryKick).toBeGreaterThan(1e-3);
    expect(inRoom('kick')).toBeLessThan(dryKick / 100);
    expect(inEcho('kick')).toBeLessThan(dryKick / 100);
  });

  it('builds the whole graph but stays silent until startMusic', async () => {
    const { context, system, noteOns } = await musicRig();
    expect(system.strip(musicPartName(FULL_SLOT.kick))).toBeDefined();
    expect(system.strip(musicPartName(FULL_SLOT.drone))).toBeDefined();
    context.currentTime = 5;
    system.update(0);
    expect(system.musicRunning).toBe(false);
    expect(noteOns()).toBe(0);
  });

  it('mutes by stopping the transport and resumes on unmute', async () => {
    const { context, system, noteOns } = await musicRig();
    system.startMusic();
    context.currentTime = 2.5;
    system.update(0);
    const before = noteOns();
    expect(before).toBeGreaterThan(0);

    system.setMuted(true);
    expect(system.readout().muted).toBe(true);
    expect(system.musicRunning).toBe(false);
    context.currentTime = 5;
    system.update(0);
    expect(noteOns()).toBe(before);

    system.setMuted(false);
    expect(system.musicRunning).toBe(true);
    context.currentTime = 7.5;
    system.update(0);
    expect(noteOns()).toBeGreaterThan(before);
  });

  it('keeps a suppressed system silent even through the debug mute toggle', async () => {
    const { context, system, noteOns } = await musicRig();
    system.suppressMusic();
    system.startMusic();
    expect(system.musicRunning).toBe(false);
    // Two toggles land back on unmuted; unmute must not start a suppressed page.
    system.toggleMute();
    system.toggleMute();
    expect(system.musicRunning).toBe(false);
    context.currentTime = 3;
    system.update(0);
    expect(noteOns()).toBe(0);
  });

  it('applies bpm live through the system without a reload', async () => {
    const { system } = await musicRig();
    system.startMusic();
    expect(system.apply({ transport: { bpm: 90 } })).toEqual({ ok: true, ignored: [] });
    expect(system.scheduler.bpm).toBe(90);
    expect(system.readout().bpm).toBe(90);
    expect(system.musicRunning).toBe(true);
    const junk = system.apply({ wat: 1 } as never);
    expect(junk.ok).toBe(true);
    expect(junk.ignored).toEqual(['wat']);
  });
});
