import { describe, expect, it } from 'vitest';

import { FULL_ARRANGEMENT } from '../__fixtures__/fullArrangement';
import { SPACE_ROWS } from '../__fixtures__/reverbSpaceFixtures';
import { ARRANGEMENT_VERSION, REVERB_SPACE_RANGES } from '../audioConstants';
import { RETURNS } from '../mixer/mix';
import { PLATE_VOICINGS } from '../mixer/reverbSpace';
import { makeArrangement } from '../song/arrangementDocument';
import { FieldNormaliser } from '../song/arrangementFields';
import { DEFAULT_REVERB, PLATE_SPACE_FIELDS, REVERB_INSERT, plateSpace } from './reverbInsert';
import { REVERB_PRESET_DEFAULT } from './reverbInsertConstants';
import {
  REVERB_PRESETS,
  REVERB_PRESET_GROUPS,
  applyReverbPreset,
  matchingReverbPreset,
  reverbPreset,
} from './reverbPresets';

/** The upgrades note's §8 table: each preset's name, group and voicing, in its order. */
const NOTE: readonly [string, string, string][] = [
  ['Resident', 'Everyday', 'plate'],
  ['House Plate', 'Everyday', 'plate'],
  ['Main Room', 'Everyday', 'room'],
  ['Back Room', 'Everyday', 'room'],
  ['Warm-up', 'Everyday', 'plate'],
  ['Booth', 'Everyday', 'room'],
  ['Mic Check', 'Everyday', 'plate'],
  ['Long Set', 'Everyday', 'plate'],
  ['Dubplate', 'Drums', 'plate'],
  ['Rewind', 'Drums', 'plate'],
  ['Club Toilets', 'Drums', 'room'],
  ['Railway Arch', 'Drums', 'room'],
  ['Cloakroom', 'Drums', 'room'],
  ['Stairwell', 'Drums', 'room'],
  ['Sound Clash', 'Drums', 'plate'],
  ['Acetate', 'Pads & leads', 'plate'],
  ['White Label', 'Pads & leads', 'plate'],
  ['Euphoria', 'Pads & leads', 'plate'],
  ['Hands in the Air', 'Pads & leads', 'plate'],
  ['Breakdown', 'Pads & leads', 'plate'],
  ['Sunrise Set', 'Pads & leads', 'plate'],
  ['Afters', 'Ambient', 'plate'],
  ['Last Train', 'Ambient', 'plate'],
  ['Comedown', 'Ambient', 'plate'],
  ['Old Mill', 'Ambient', 'room'],
  ['Lights Up', 'Ambient', 'plate'],
  ['Sound System', 'Ambient', 'plate'],
];

const byLabel = (label: string) => REVERB_PRESETS.find((p) => p.label === label)!;

describe('the Reverb preset bank (windsor#774)', () => {
  it("holds the note's 27 presets, numbered 1–27, with its names, groups and voicings in order", () => {
    expect(REVERB_PRESETS.map((p) => [p.label, p.group, p.settings.voicing])).toEqual(NOTE);
    expect(REVERB_PRESETS.map((p) => p.number)).toEqual(NOTE.map((_, i) => i + 1));
    expect(new Set(REVERB_PRESETS.map((p) => p.label)).size).toBe(NOTE.length);
    expect([...new Set(REVERB_PRESETS.map((p) => p.group))]).toEqual(REVERB_PRESET_GROUPS);
  });

  it('writes all 17 space fields in every preset, each inside its range', () => {
    for (const { label, settings } of REVERB_PRESETS) {
      expect(Object.keys(settings).sort(), label).toEqual([...PLATE_SPACE_FIELDS].sort());
      expect(PLATE_VOICINGS, label).toContain(settings.voicing);
      for (const [field, [min, max]] of Object.entries(REVERB_SPACE_RANGES)) {
        const value = settings[field as keyof typeof REVERB_SPACE_RANGES];
        expect(value, `${label}.${field}`).toBeGreaterThanOrEqual(min);
        expect(value, `${label}.${field}`).toBeLessThanOrEqual(max);
      }
    }
  });

  it('puts Old Mill at full Size', () => {
    expect(byLabel('Old Mill').settings.size).toBe(REVERB_SPACE_RANGES.size[1]);
  });

  it("starts a new Reverb and Send A on Resident, today's hall field for field", () => {
    const resident = reverbPreset(REVERB_PRESET_DEFAULT)!;
    expect(resident.label).toBe('Resident');
    expect(resident.settings).toEqual(SPACE_ROWS.hall);
    expect(plateSpace(DEFAULT_REVERB)).toEqual(resident.settings);
    expect(RETURNS.a.inserts[0]).toMatchObject(resident.settings);
  });

  it('applies each preset as a whole space that normalises to itself, keeping Mix and the switch', () => {
    const moved = {
      ...DEFAULT_REVERB,
      size: 2.2,
      voicing: 'room' as const,
      mix: 0.17,
      enabled: false,
    };
    for (const preset of REVERB_PRESETS) {
      const spec = applyReverbPreset(moved, preset.number);
      expect(spec).toEqual({ ...preset.settings, kind: 'reverb', mix: 0.17, enabled: false });
      const n = new FieldNormaliser();
      expect(REVERB_INSERT.normalise({ ...spec }, 'fx', n)).toEqual(spec);
      expect(n.corrections).toEqual([]);
    }
  });

  it('matches each preset back from its own numbers, in any field order, and none once a knob moves', () => {
    for (const preset of REVERB_PRESETS) {
      const reversed = Object.fromEntries(Object.entries(preset.settings).reverse());
      expect(matchingReverbPreset(reversed as typeof preset.settings)).toBe(preset.number);
      expect(matchingReverbPreset({ ...preset.settings, preDelay: 0.123 })).toBeUndefined();
    }
    expect(matchingReverbPreset(plateSpace(DEFAULT_REVERB))).toBe(REVERB_PRESET_DEFAULT);
    expect(matchingReverbPreset(undefined)).toBeUndefined();
  });

  it('round trips a Reverb set from a room-voiced preset, then edited, with its values unchanged', () => {
    const backRoom = byLabel('Back Room');
    const edited = { ...applyReverbPreset(DEFAULT_REVERB, backRoom.number), size: 0.55, mix: 0.4 };
    expect(matchingReverbPreset(edited)).toBeUndefined();
    const raw = {
      ...FULL_ARRANGEMENT,
      version: ARRANGEMENT_VERSION,
      patches: { kick: {}, hat: {}, 'saw-arp': {}, 'drone-sqr': {} },
      parts: FULL_ARRANGEMENT.parts.map((part) => ({ ...part, strip: { inserts: [edited] } })),
    };
    const result = makeArrangement(raw);
    expect(result.corrections).toEqual([]);
    expect(result.document.parts[0]!.strip!.inserts).toEqual([
      { ...edited, id: expect.any(String) },
    ]);
    expect(makeArrangement(JSON.parse(JSON.stringify(result.document))).document).toEqual(
      result.document,
    );
  });
});
