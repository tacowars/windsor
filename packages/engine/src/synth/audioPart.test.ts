/**
 * Note-handle bookkeeping.
 *
 * `AudioPart` is the only place that tracks which handles are still sounding,
 * and it offers two ways to release: by handle, and MIDI-style by note number.
 * Mixing them is what breaks, so that is what these cover.
 */
import { describe, expect, it } from 'vitest';

import { AudioPart } from './audioPart';
import { makePatch } from '../patch/patch';

interface Sent {
  type: string;
  id?: number;
  note?: number;
}

/** Minimal stand-in for the worklet node: records what was posted. */
function makePart(): { part: AudioPart; sent: Sent[] } {
  const sent: Sent[] = [];
  const node = {
    context: { currentTime: 0, sampleRate: 48000 },
    port: { postMessage: (m: Sent) => void sent.push(m) },
    parameters: { get: () => ({ value: 0 }) },
    connect: () => {},
    disconnect: () => {},
  } as unknown as AudioWorkletNode;

  return { part: new AudioPart('test', node, makePatch()), sent };
}

const releases = (sent: Sent[]): (number | undefined)[] =>
  sent.filter((m) => m.type === 'noteOff').map((m) => m.id);

describe('AudioPart note handles', () => {
  it('releases by handle', () => {
    const { part, sent } = makePart();
    const id = part.noteOn(60);
    part.noteOff(id);
    expect(releases(sent)).toEqual([id]);
  });

  it('releases the oldest instance by note number', () => {
    const { part, sent } = makePart();
    const first = part.noteOn(60);
    const second = part.noteOn(60);
    part.noteOffByNote(60);
    expect(releases(sent)).toEqual([first]);
    part.noteOffByNote(60);
    expect(releases(sent)).toEqual([first, second]);
  });

  it('does not resurrect a handle already released by handle', () => {
    // The mixed-release sequence: releasing id1 directly must not leave it in
    // the lookup, or noteOffByNote re-releases the dead note and the live one
    // sounds forever.
    const { part, sent } = makePart();
    const first = part.noteOn(60);
    part.noteOff(first);
    const second = part.noteOn(60);
    part.noteOffByNote(60);

    expect(releases(sent)).toEqual([first, second]);
    expect(part.heldHandles(60)).toEqual([]);
  });

  it('ignores a note number that is not sounding', () => {
    const { part, sent } = makePart();
    part.noteOffByNote(64);
    expect(releases(sent)).toEqual([]);
  });

  it('forgets everything on allNotesOff', () => {
    const { part, sent } = makePart();
    part.noteOn(60);
    part.noteOn(64);
    part.allNotesOff();
    part.noteOffByNote(60);
    expect(releases(sent)).toEqual([]);
    expect(part.heldHandles(60)).toEqual([]);
  });

  it('schedules a release for a triggered one-shot and stops tracking it', () => {
    const { part, sent } = makePart();
    const id = part.trigger(72, 1, 0.2);
    expect(releases(sent)).toEqual([id]);
    expect(part.heldHandles(72)).toEqual([]);
  });
});

describe('AudioPart note extras (#602)', () => {
  it('posts a grid note’s mod and slide, and nothing extra for a plain note', () => {
    const { part, sent } = makePart();
    part.noteOn(60, 0.9, undefined, { mod: 1, slide: true });
    part.noteOn(62, 0.9, undefined, { mod: 0, slide: false });
    part.noteOn(64);
    const ons = sent.filter((m) => m.type === 'noteOn') as Array<
      Sent & { mod?: number; slide?: boolean }
    >;
    expect(ons[0]).toMatchObject({ note: 60, mod: 1, slide: true });
    expect(ons[1]).not.toHaveProperty('mod');
    expect(ons[1]).not.toHaveProperty('slide');
    expect(ons[2]).not.toHaveProperty('mod');
    expect(ons[2]).not.toHaveProperty('slide');
  });
});
