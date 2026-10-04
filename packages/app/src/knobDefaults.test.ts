/**
 * Every knob default is the engine's (#618 decision 3). The tables are the
 * statement of what the console builds — the panels, bays and cards read
 * them — so walking the tables is walking every knob without a DOM. A patch
 * knob's default is read from `makePatch()` at its path and the table cannot
 * carry one (`PatchKnobEntry` has no `def`); a sequencer, harmony, mixer or
 * arrangement knob's default is asserted against the `DEFAULT_*` config or
 * normaliser constant the engine defines for that field. A schema-default
 * change in `patch.ts` or a sequencer config that leaves double-click reset
 * behind fails here, not in a playtest.
 */
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ARP_CONFIG,
  DEFAULT_BASS_CONFIG,
  DEFAULT_FIGURE_CONFIG,
  DEFAULT_CHORD_CONFIG,
  DEFAULT_EUCLIDEAN_CONFIG,
  DEFAULT_GRID_CONFIG,
  DEFAULT_ROLL_CONFIG,
  DEFAULT_STRIP,
  DENSITY_MOD_KINDS,
  HOLD_DEFAULT,
  LFO_BARS_DEFAULT,
  LFO_HZ_DEFAULT,
  LOW_CUT_MAX_HZ,
  LOW_CUT_MIN_HZ,
  MIDI_MIDDLE_C,
  REGISTER_OCTAVE_MAX,
  REGISTER_OCTAVE_MIN,
  SEQUENCER_KINDS,
  VELOCITY_DEFAULT,
  WALK_CHANCE,
  makePatch,
} from '@windsor/engine';
import { BARS_KNOB, BPM_KNOB } from './transportTables';
import { REGISTER_OCTAVE_DEFAULTS, octaveKnob } from './harmonyTables';
import { STRIP_LOW_CUT_KNOB } from './mixerTables';
import { allPatchKnobs, patchDefault, patchKnobOpts } from './patchKnobTables';
import { getPath } from './patchPath';
import {
  BASS_KNOBS,
  BASS_ROOT_BIAS_KNOB,
  FIGURE_KNOBS,
  ROLL_KNOBS,
  FIGURE_LENGTH_KNOB,
  CHORD_KNOBS,
  DENSITY_DEFAULTS,
  DENSITY_KNOBS,
  EUCLID_KNOBS,
  EUCLID_ROTATE_KNOB,
  EUCLID_STEPS_KNOB,
  GRID_KNOBS,
  GRID_LENGTH_KNOB,
  euclidPulseKnob,
  type SequencerKnobEntry,
} from './sequencerKnobTables';
import { NEW_SONG_BARS, NEW_SONG_BPM } from './songConstants';

describe('patch knobs', () => {
  it('cover every path the Parts tab builds, and each is a number the engine defines', () => {
    const knobs = allPatchKnobs();
    expect(knobs.length).toBeGreaterThan(0);
    const fresh = makePatch();
    for (const { path, entry } of knobs) {
      expect(typeof getPath(fresh, path), path).toBe('number');
      // The guard: a table entry never carries a default of its own.
      expect('def' in entry.o, `${path} carries a def`).toBe(false);
    }
  });

  it("default to makePatch()'s value at the path — the per-operator level included", () => {
    const fresh = makePatch();
    for (const { path, entry } of allPatchKnobs()) {
      expect(patchKnobOpts(entry, path).def, path).toBe(getPath(fresh, path));
    }
    // Operator A is the one carrier a fresh patch sounds; the pitch envelope holds no sustain.
    expect(patchDefault('ops.0.level')).toBe(fresh.ops[0]?.level);
    expect(patchDefault('ops.1.level')).toBe(fresh.ops[1]?.level);
    expect(patchDefault('pitchEnv.sustainLevel')).toBe(fresh.pitchEnv.sustainLevel);
  });

  it('refuse a path the engine does not define', () => {
    expect(() => patchDefault('filter.nothing')).toThrow(/no engine default/);
  });
});

/** The engine's default for one sequencer-table entry, by the kind's config or the normaliser's constant. */
function engineDefault(config: object, entry: SequencerKnobEntry): unknown {
  if (entry.kind === 'section') return { slot: undefined, velocity: VELOCITY_DEFAULT }[entry.f];
  if (entry.f === 'note') return MIDI_MIDDLE_C;
  if (entry.f === 'hold') return HOLD_DEFAULT;
  return Reflect.get(config, entry.f);
}

describe('sequencer knobs', () => {
  const tables: [string, readonly SequencerKnobEntry[], object][] = [
    ['euclidean', EUCLID_KNOBS, DEFAULT_EUCLIDEAN_CONFIG],
    ['grid', GRID_KNOBS, DEFAULT_GRID_CONFIG],
    ['chord', CHORD_KNOBS, DEFAULT_CHORD_CONFIG],
    ['bass', [...BASS_KNOBS, BASS_ROOT_BIAS_KNOB], DEFAULT_BASS_CONFIG],
    ['figure', FIGURE_KNOBS, DEFAULT_FIGURE_CONFIG],
    ['roll', ROLL_KNOBS, DEFAULT_ROLL_CONFIG],
  ];

  it.each(tables)(
    '%s: every entry defaults to the engine field it writes',
    (_kind, table, config) => {
      expect(table.length).toBeGreaterThan(0);
      for (const entry of table) {
        const expected = engineDefault(config, entry);
        expect(typeof expected, `${entry.f} is not an engine field`).toBe('number');
        expect(entry.o.def, entry.f).toBe(expected);
      }
    },
  );

  it('the Euclidean card knobs it binds itself read the engine config', () => {
    expect(EUCLID_STEPS_KNOB.def).toBe(DEFAULT_EUCLIDEAN_CONFIG.steps);
    expect(EUCLID_ROTATE_KNOB.def).toBe(DEFAULT_EUCLIDEAN_CONFIG.rotate);
    for (const field of ['min', 'max', 'start'] as const) {
      expect(euclidPulseKnob(field).def, field).toBe(DEFAULT_EUCLIDEAN_CONFIG.pulses[field]);
    }
  });

  it('the grid and Figure Length knobs read the engine config', () => {
    expect(GRID_LENGTH_KNOB.def).toBe(DEFAULT_GRID_CONFIG.length);
    expect(FIGURE_LENGTH_KNOB.def).toBe(DEFAULT_FIGURE_CONFIG.length);
  });

  it('the density modulator writes and defaults to the engine modulator of each kind', () => {
    const engine = { lfoBars: LFO_BARS_DEFAULT, lfoHz: LFO_HZ_DEFAULT, walk: WALK_CHANCE };
    for (const kind of DENSITY_MOD_KINDS) {
      expect(DENSITY_KNOBS[kind].o.def, kind).toBe(engine[kind]);
      expect(Reflect.get(DENSITY_DEFAULTS[kind], DENSITY_KNOBS[kind].f), kind).toBe(engine[kind]);
    }
    expect(DENSITY_DEFAULTS.lfoBars).toEqual(DEFAULT_EUCLIDEAN_CONFIG.density);
  });
});

describe('harmony, mixer and arrangement knobs', () => {
  it("each kind's register octave knob reads that kind's engine config and range", () => {
    const configs = {
      grid: DEFAULT_GRID_CONFIG,
      chord: DEFAULT_CHORD_CONFIG,
      arp: DEFAULT_ARP_CONFIG,
      bass: DEFAULT_BASS_CONFIG,
      figure: DEFAULT_FIGURE_CONFIG,
    };
    expect(octaveKnob('grid').min).toBe(REGISTER_OCTAVE_MIN);
    expect(octaveKnob('grid').max).toBe(REGISTER_OCTAVE_MAX);
    for (const kind of SEQUENCER_KINDS) {
      if (!(kind in configs)) continue;
      const config = configs[kind as keyof typeof configs];
      expect(REGISTER_OCTAVE_DEFAULTS[kind], kind).toBe(config.register.octave);
      expect(octaveKnob(kind).def, kind).toBe(config.register.octave);
    }
  });

  it("a strip's low cut spans the engine's range and rests at DEFAULT_STRIP's (#640)", () => {
    expect(STRIP_LOW_CUT_KNOB.def).toBe(DEFAULT_STRIP.lowCut);
    expect(STRIP_LOW_CUT_KNOB.min).toBe(LOW_CUT_MIN_HZ);
    expect(STRIP_LOW_CUT_KNOB.max).toBe(LOW_CUT_MAX_HZ);
  });

  it('BPM resets to what a new song starts at', () => {
    expect(BPM_KNOB.def).toBe(NEW_SONG_BPM);
    expect(BARS_KNOB.def).toBe(NEW_SONG_BARS);
  });
});
