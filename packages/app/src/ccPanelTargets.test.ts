/**
 * "+ Add mapping"'s target list (windsor#784, record `2026-10-13-midi-cc-mapping`
 * decisions 1, 8 and 12): the lane picker's groups less what a CC cannot
 * move, the tags, and the voice count's cap.
 */
import {
  type CcMapping,
  type CcTargetId,
  type DocumentPart,
  FM_LANES_MAX,
  VOICE_AUTOMATION_ROWS,
  makeArrangement,
  partAt,
} from '@windsor/engine';
import { describe, expect, it } from 'vitest';

import { ccTargetList } from './ccPanelTargets';
import { newSong } from './songParts';

const mapping = (target: CcTargetId, cc = 74): CcMapping => ({
  source: { device: 'Keys', channel: 1, cc },
  target,
  min: 0,
  max: 1,
  inverted: false,
});

/** The new song's part, with `extra` over it. */
function part(extra: Partial<DocumentPart> = {}): DocumentPart {
  const doc = makeArrangement(newSong()).document;
  const first = partAt(doc, 0);
  if (!first) throw new Error('no part');
  return { ...first, ...extra };
}

const options = (p: DocumentPart) => ccTargetList(p, undefined).groups.flatMap((g) => g.options);

describe('ccTargetList', () => {
  it("offers the Mixer and the voice in the lane picker's groups, and no sequencer row", () => {
    const list = ccTargetList(part(), undefined);
    expect(list.groups[0]?.label).toBe('Mixer');
    expect(list.groups.some((g) => g.label.startsWith('Voice'))).toBe(true);
    expect(options(part()).some((o) => o.target.startsWith('seq.'))).toBe(false);
  });

  it('tags a mapped target to replace, and a lane on it, which stays open', () => {
    const p = part({
      ccMappings: [mapping('strip.pan', 91), mapping('strip.level', 7)],
      automation: [{ target: 'strip.level', on: true, points: [{ tick: 0, value: 1, bend: 0 }] }],
    });
    const byTarget = new Map(options(p).map((o) => [o.target, o]));
    expect(byTarget.get('strip.pan')).toMatchObject({ tag: 'CC 91 · replace', refused: null });
    expect(byTarget.get('strip.level')).toMatchObject({ tag: 'lane · CC 7', refused: null });
  });

  it('disables a voice target outside the full eight, and keeps the mapped ones open', () => {
    const voice = VOICE_AUTOMATION_ROWS.slice(0, FM_LANES_MAX).map((row) => mapping(row.target));
    const list = ccTargetList(part({ ccMappings: voice }), undefined);
    expect([list.used, list.full]).toEqual([FM_LANES_MAX, true]);
    const all = list.groups.flatMap((g) => g.options);
    const held = all.find((o) => o.target === voice[0]?.target);
    const other = all.find((o) => o.target === VOICE_AUTOMATION_ROWS[FM_LANES_MAX]?.target);
    expect(held?.refused).toBeNull();
    expect(other?.refused).toBe(`Voice slots full (${FM_LANES_MAX}/${FM_LANES_MAX})`);
    expect(all.find((o) => o.target === 'strip.level')?.refused).toBeNull();
  });
});
