/**
 * The console's ■ (#708, epic #703 decision 8) through the whole system:
 * `stopMusic()` halts the transport, releases every part, and rewinds to
 * tick 0 with the region state cleared, so the next `startMusic()` plays the
 * same notes a fresh system does. The mute path (`setMuted`, the game's) is
 * pinned unmodified in `musicRender.test.ts`; here it is the contrast — a
 * mute keeps the tick, a stop does not.
 */
import { afterAll, describe, expect, it } from 'vitest';

import { FakeContext, installFakeAudioWorklet, sourceOf } from '../__fixtures__/fakeAudioContext';
import { FULL_DOCUMENT, FULL_PART_IDS, FULL_SLOT } from '../__fixtures__/fullArrangement';
import { AudioSystem } from './audioSystem';
import { musicPartName } from '../song/documentParts';
import { TICKS_PER_BAR } from '../sequencing/scheduler';
import { FmEngine } from '../synth/fmEngine';

const restore = installFakeAudioWorklet();
afterAll(() => restore());

interface Message {
  type?: string;
  id?: number;
  note?: number;
  frame?: number;
}

async function musicRig(): Promise<{
  context: FakeContext;
  system: AudioSystem;
  posted(id: (typeof FULL_PART_IDS)[number]): Message[];
}> {
  const context = new FakeContext();
  const engine = new FmEngine(context.asAudioContext());
  const system = new AudioSystem(engine);
  await system.init();
  system.initMusic(FULL_DOCUMENT);
  const posted = (id: (typeof FULL_PART_IDS)[number]): Message[] => {
    const part = engine.getPart(musicPartName(FULL_SLOT[id]));
    if (!part) throw new Error(`no part "${id}"`);
    return sourceOf(part).posted as Message[];
  };
  return { context, system, posted };
}

/** Each part's note numbers from `from` on, in the order they were scheduled. */
const notesFrom = (messages: Message[], from: number): number[] =>
  messages
    .slice(from)
    .filter((m) => m.type === 'noteOn')
    .map((m) => m.note ?? -1);

describe('stopMusic (■)', () => {
  it('releases every part, rewinds to tick 0 and keeps the mute flag', async () => {
    const { context, system, posted } = await musicRig();
    system.startMusic();
    context.currentTime = 2.5;
    system.update(0);
    const marks = FULL_PART_IDS.map((id) => posted(id).length);
    expect(FULL_PART_IDS.some((id) => notesFrom(posted(id), 0).length > 0)).toBe(true);

    system.stopMusic();
    expect(system.musicRunning).toBe(false);
    expect(system.isMuted).toBe(false);
    expect(system.scheduler.transport.currentTick).toBe(0);
    expect(system.scheduler.audibleTick(context.currentTime)).toBe(0);
    FULL_PART_IDS.forEach((id, i) => {
      const after = posted(id).slice(marks[i]);
      expect(after.some((m) => m.type === 'allNotesOff')).toBe(true);
      // Every note that was started has its note-off: nothing is left hanging.
      const ons = posted(id)
        .filter((m) => m.type === 'noteOn')
        .map((m) => m.id);
      const offs = new Set(
        posted(id)
          .filter((m) => m.type === 'noteOff')
          .map((m) => m.id),
      );
      expect(ons.filter((on) => !offs.has(on))).toEqual([]);
    });
  });

  it('▶ after ■ plays the same notes as the first run from tick 0', async () => {
    const { context, system, posted } = await musicRig();
    const fresh = await musicRig();
    system.startMusic();
    fresh.system.startMusic();
    context.currentTime = 3.1;
    fresh.context.currentTime = 3.1;
    system.update(0);
    fresh.system.update(0);
    const firstRun = FULL_PART_IDS.map((id) => notesFrom(posted(id), 0));

    system.stopMusic();
    const marks = FULL_PART_IDS.map((id) => posted(id).length);
    system.startMusic();
    context.currentTime += 3.1;
    system.update(0);
    FULL_PART_IDS.forEach((id, i) => {
      expect(notesFrom(posted(id), marks[i] ?? 0)).toEqual(firstRun[i]);
      expect(notesFrom(fresh.posted(id), 0)).toEqual(firstRun[i]);
    });
  });

  it('a mute keeps the tick where a stop rewinds it', async () => {
    const { context, system } = await musicRig();
    system.startMusic();
    context.currentTime = 2;
    system.update(0);
    system.setMuted(true);
    const halted = system.scheduler.transport.currentTick;
    expect(halted).toBeGreaterThan(0);
    system.setMuted(false);
    expect(system.scheduler.transport.currentTick).toBe(halted);
    system.stopMusic();
    expect(system.scheduler.transport.currentTick).toBe(0);
  });

  it('seekMusic (windsor#102) moves a halted transport, and ▶ plays the parts from there', async () => {
    const { context, system, posted } = await musicRig();
    const bar = 2 * TICKS_PER_BAR;
    const issued: number[] = [];
    system.scheduler.subscribe(1, (e) => issued.push(e.tick));
    expect(system.seekMusic(bar)).toBe(true);
    expect(system.scheduler.audibleTick(context.currentTime)).toBe(bar);
    const marks = FULL_PART_IDS.map((id) => posted(id).length);
    system.startMusic();
    context.currentTime = 2;
    system.update(0);
    expect(issued[0]).toBe(bar);
    expect(FULL_PART_IDS.some((id, i) => notesFrom(posted(id), marks[i] ?? 0).length > 0)).toBe(
      true,
    );

    // Playing: refused, and the transport runs on where it was.
    const running = system.scheduler.transport.currentTick;
    expect(system.seekMusic(0)).toBe(false);
    expect(system.scheduler.transport.currentTick).toBe(running);
    expect(system.musicRunning).toBe(true);

    // Paused: moved, and the resume starts from the new tick.
    system.setMuted(true);
    issued.length = 0;
    expect(system.seekMusic(TICKS_PER_BAR)).toBe(true);
    system.setMuted(false);
    context.currentTime += 1;
    system.update(0);
    expect(issued[0]).toBe(TICKS_PER_BAR);
  });

  it("the strip's live partials reach the engine without a rebuild (#708)", async () => {
    const { system } = await musicRig();
    system.startMusic();
    const running = system.musicRunning;
    expect(system.apply({ transport: { bpm: 133 } }).ok).toBe(true);
    expect(system.apply({ harmony: { root: 9 } }).ok).toBe(true);
    expect(system.apply({ harmony: { scale: 'dorian' } }).ok).toBe(true);
    expect(system.apply({ transport: { bars: 8 } }).ok).toBe(true);
    const readout = system.readout();
    expect([readout.bpm, readout.root, readout.scale]).toEqual([133, 9, 'dorian']);
    expect(system.scheduler.bpm).toBe(133);
    expect(system.musicRunning).toBe(running);
  });
});
