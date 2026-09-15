/**
 * The #562 proof that embedding changed no sound: every patch
 * `arrangements/bed-01.json` now carries renders sample-identically to the
 * library patch of the same id, through the real DSP.
 *
 * Node-only, by the harness: `arrangementEquality.test.ts` proves the
 * *arrangement* is unchanged on the graph stand-in, whose part sources are
 * tone feeds that never reach the FM processor — so it cannot see a patch at
 * all (review pass 1 and 2, P2). This is the test that can: the seeded
 * worklet renders the document's patch and the library's, and the two Float32
 * buffers are compared sample by sample with `Object.is`. The
 * `patchLeafDifferences` check beside it is the same claim on the values, and
 * the sensitivity case proves the comparison would notice.
 *
 * The "before" case is computed here, from the library, rather than pinned as
 * a literal (Pat's rule on tunables). It does couple this test to four of the
 * library's 114 patches: deliberately re-tuning `kick`, `hat`, `saw-arp` or
 * `drone-sqr` fails it, which is the intended alarm — the moment someone
 * decides whether bed-01 re-embeds the new patch or keeps the one Pat
 * approved by ear (record `2026-09-15-562-song-documents-are-self-contained`).
 */
import { describe, expect, it } from 'vitest';

import { DEFAULT_SEED, loadProcessor, render } from './__fixtures__/workletHarness';
import type { ScheduledEvent } from './__fixtures__/workletHarness';
import { makeArrangement } from './arrangementDocument';
import { MUSIC_PART_IDS } from './arrangementPlayer';
import raw from './arrangements/bed-01.json';
import type { Patch } from './patch';
import { patchLeafDifferences } from './patchLibrary';
import { PRESETS } from './presets';

const DOCUMENT = makeArrangement(raw).document;

/** The four ids the song's parts name, paired with the library patch they were embedded from. */
const EMBEDDED: Array<[string, Patch, Patch]> = MUSIC_PART_IDS.map((id) => {
  const section = DOCUMENT[id];
  if (!section) throw new Error(`bed-01 has no ${id} part`);
  const embedded = DOCUMENT.patches?.[section.preset];
  const library = PRESETS[section.preset];
  if (!embedded || !library) throw new Error(`no patch for ${id}.preset "${section.preset}"`);
  return [section.preset, embedded, library];
});

const VOICES = 4;
const BLOCKS = 120;
const NOTE = 48;
const VELOCITY = 0.9;
const NOTE_OFF_FRAME = 8000;

const events = (): ScheduledEvent[] => [
  { type: 'noteOn', id: 1, note: NOTE, velocity: VELOCITY, frame: 0 },
  { type: 'noteOff', id: 1, frame: NOTE_OFF_FRAME },
];

const dsp = loadProcessor();

/** One seeded render of a patch through the real worklet. */
function samplesOf(patch: Patch): Float32Array {
  return render(dsp, dsp.create(patch, VOICES, DEFAULT_SEED), BLOCKS, events()).samples;
}

describe('bed-01.json embeds the library patches it used to name', () => {
  it('names four parts, each with an embedded patch', () => {
    expect(EMBEDDED.map(([id]) => id)).toEqual(['kick', 'hat', 'saw-arp', 'drone-sqr']);
  });

  it.each(EMBEDDED)('%s: the embedded patch has no leaf that differs', (id, embedded, library) => {
    expect(patchLeafDifferences(embedded, library, id)).toEqual([]);
  });

  it.each(EMBEDDED)('%s: renders sample-identically to the library patch', (_id, embedded, lib) => {
    const fromDocument = samplesOf(embedded);
    const fromLibrary = samplesOf(lib);
    expect(fromDocument.length).toBe(fromLibrary.length);
    expect(fromDocument.some((sample) => sample !== 0)).toBe(true);
    let firstDifference = -1;
    for (let i = 0; i < fromDocument.length; i++) {
      if (!Object.is(fromDocument[i], fromLibrary[i])) {
        firstDifference = i;
        break;
      }
    }
    expect(firstDifference).toBe(-1);
  });

  it('would notice a changed patch: one operator ratio moves the samples', () => {
    const [, embedded] = EMBEDDED[0] ?? [];
    if (!embedded) throw new Error('no embedded patch');
    const op = embedded.ops[0];
    if (!op) throw new Error('no operator 0');
    const nudged: Patch = {
      ...embedded,
      ops: [{ ...op, ratio: op.ratio + 1 }, ...embedded.ops.slice(1)],
    };
    const before = samplesOf(embedded);
    const after = samplesOf(nudged);
    expect(after.some((sample, i) => !Object.is(sample, before[i]))).toBe(true);
  });
});
