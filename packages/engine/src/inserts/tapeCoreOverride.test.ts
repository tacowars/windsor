/**
 * The song's `core` on a Tape insert (windsor#291): the magnetic core's three
 * controls set per insert from the Tape card's Advanced section, in place of
 * the model's row.
 *
 * - The field is additive: absent, the spec carries no `core` key and the
 *   processor plays as before, to the bit; present, it round-trips exactly
 *   through a song, and a value outside `TAPE_CORE_BOUNDS` is clamped, never
 *   refused.
 * - The pure edits behave as the issue's decision 3 says: turning one control
 *   writes all three, a model change and Randomize keep `core`, a starting
 *   point clears it.
 * - The box the knobs reach (windsor#315's) holds every model row, and is
 *   above the susceptibility floor everywhere, so the core can always
 *   normalise there.
 * - The processor starts on a song's `core`, its cores tuned exactly as a
 *   core built at those controls.
 */
import { describe, expect, it } from 'vitest';
import { tapeParams } from '../__fixtures__/tapeHarness';
import { tapeRig } from '../__fixtures__/tapeDspProbe';
import { FULL_ARRANGEMENT } from '../__fixtures__/fullArrangement';
import { ARRANGEMENT_VERSION } from '../audioConstants';
import { makeArrangement } from '../song/arrangementDocument';
import { FieldNormaliser } from '../song/arrangementFields';
import { mulberry32 } from '../sequencing/mulberry32';
import { TapeMagneticCore } from '../worklet/tape/tapeMagnetic';
import { magneticRowAboveFloor } from '../worklet/tape/tapeMagneticRows';
import { TAPE_CORE_BOUNDS, TAPE_CORE_CONTROLS, TAPE_MODELS, TAPE_TYPES } from './tapeConstants';
import { clearTapeCore, setTapeCore, tapeCoreOf } from './tapeControls';
import { tapeCoreParams } from './tapeInsert';
import { applyTapePreset } from './tapePresets';
import { TAPE_PRESETS } from './tapePresetTables';
import { randomiseTape } from './tapeRandomise';
import { DEFAULT_TAPE, normaliseTape, tapeModelCore, type TapeSpec } from './tapeSpec';

const CORE = { drive: 0.8125, width: 0.4375, saturation: 0.0625 };
const VINTAGE: TapeSpec = { ...DEFAULT_TAPE, model: 'vintage' };

describe('the song format', () => {
  it('leaves an insert without `core` without the key, and adds no correction', () => {
    const n = new FieldNormaliser();
    const spec = normaliseTape({ kind: 'tape', model: 'ferric' }, 'fx', n);
    expect('core' in spec).toBe(false);
    expect(JSON.stringify(spec)).not.toContain('core');
    expect(n.corrections).toEqual([]);
  });

  it('round-trips a `core` exactly on tracks and the master', () => {
    const effect = { ...DEFAULT_TAPE, model: 'chrome' as const, core: CORE };
    const result = makeArrangement({
      ...FULL_ARRANGEMENT,
      version: ARRANGEMENT_VERSION,
      patches: { kick: {}, hat: {}, 'saw-arp': {}, 'drone-sqr': {} },
      parts: FULL_ARRANGEMENT.parts.map((part) => ({ ...part, strip: { inserts: [effect] } })),
      master: { inserts: [effect] },
    });
    expect(result.corrections).toEqual([]);
    expect(result.document.parts[0]!.strip!.inserts).toEqual([
      { ...effect, id: expect.any(String) },
    ]);
    expect(result.document.master!.inserts).toEqual([{ ...effect, id: expect.any(String) }]);
    expect(makeArrangement(JSON.parse(JSON.stringify(result.document))).document).toEqual(
      result.document,
    );
  });

  it('clamps each control into the knob box, fills a missing one from the model and drops junk', () => {
    const n = new FieldNormaliser();
    const clamped = normaliseTape(
      { model: 'vintage', core: { drive: -1, width: 0.9, saturation: 2, extra: 1 } },
      'fx',
      n,
    );
    expect(clamped.core).toEqual({
      drive: TAPE_CORE_BOUNDS.drive[0],
      width: TAPE_CORE_BOUNDS.width[1],
      saturation: 1,
    });
    expect(n.corrections).toHaveLength(4);
    const partial = normaliseTape({ model: 'metal', core: { width: 0.04 } }, 'fx', n);
    expect(partial.core).toEqual({ ...tapeModelCore('metal'), width: TAPE_CORE_BOUNDS.width[0] });
    for (const junk of ['loud', [0.5, 0.5, 0.5], null, 3]) {
      const before = n.corrections.length;
      expect('core' in normaliseTape({ core: junk }, 'fx', n)).toBe(false);
      expect(n.corrections.length).toBe(before + 1);
    }
  });
});

describe("the Advanced section's edits (decision 3)", () => {
  it('shows the model row until a knob turns, then writes all three', () => {
    expect(tapeCoreOf(VINTAGE)).toEqual(tapeModelCore('vintage'));
    // Vintage's row is inside the box (windsor#315): turning Bend leaves its Width as it was.
    const turned = setTapeCore(VINTAGE, 'drive', 0.25);
    expect(turned.core).toEqual({ ...tapeModelCore('vintage'), drive: 0.25 });
    for (const model of TAPE_TYPES) {
      const row = tapeModelCore(model);
      expect(setTapeCore({ ...DEFAULT_TAPE, model }, 'drive', 0.25).core, model).toEqual({
        ...row,
        drive: 0.25,
      });
    }
    const ferric = setTapeCore({ ...DEFAULT_TAPE, model: 'ferric' }, 'saturation', 1);
    expect(ferric.core).toEqual({ ...tapeModelCore('ferric'), saturation: 1 });
    expect(setTapeCore(ferric, 'width', 0.9).core!.width).toBe(TAPE_CORE_BOUNDS.width[1]);
    expect(setTapeCore(turned, 'width', 0.1).core).toEqual({ ...turned.core, width: 0.1 });
    expect(VINTAGE).toEqual({ ...DEFAULT_TAPE, model: 'vintage' });
  });

  it('keeps `core` through a model change and Randomize, and clears it for a starting point', () => {
    const custom: TapeSpec = { ...DEFAULT_TAPE, core: CORE };
    expect({ ...custom, model: 'vhs' }.core).toBe(CORE);
    const random = mulberry32(291);
    for (let roll = 0; roll < 20; roll++) expect(randomiseTape(custom, random).core).toBe(CORE);
    for (const preset of TAPE_PRESETS) {
      const applied = applyTapePreset(custom, preset.id);
      expect('core' in applied).toBe(false);
      expect(applied).toEqual(applyTapePreset(DEFAULT_TAPE, preset.id));
    }
    expect(applyTapePreset(custom, 'no-such-preset')).toBe(custom);
  });

  it('clears `core` with Use model, and leaves a spec without one as it is', () => {
    const cleared = clearTapeCore({ ...VINTAGE, core: CORE });
    expect(cleared).toEqual(VINTAGE);
    expect('core' in cleared).toBe(false);
    expect(clearTapeCore(VINTAGE)).toBe(VINTAGE);
  });
});

describe('the processor', () => {
  it("writes the flag and the controls, and the model's row while unset", () => {
    expect(tapeCoreParams({ ...DEFAULT_TAPE, core: CORE })).toEqual({
      core: 1,
      coreDrive: CORE.drive,
      coreWidth: CORE.width,
      coreSaturation: CORE.saturation,
    });
    for (const model of TAPE_TYPES) {
      const row = tapeModelCore(model);
      expect(tapeCoreParams({ ...DEFAULT_TAPE, model }), model).toEqual({
        core: 0,
        coreDrive: row.drive,
        coreWidth: row.width,
        coreSaturation: row.saturation,
      });
    }
  });

  it("holds every model's row inside the knob box (windsor#315)", () => {
    expect(TAPE_CORE_BOUNDS).toEqual({ drive: [0.05, 1], width: [0.05, 0.85], saturation: [0, 1] });
    for (const [i, { magnetic }] of TAPE_MODELS.entries())
      for (const [c, control] of TAPE_CORE_CONTROLS.entries()) {
        const [min, max] = TAPE_CORE_BOUNDS[control];
        const label = `${TAPE_TYPES[i]} ${control}`;
        expect(magnetic[c], label).toBeGreaterThanOrEqual(min);
        expect(magnetic[c], label).toBeLessThanOrEqual(max);
      }
  });

  it('keeps the susceptibility above the floor across the whole knob box', () => {
    const steps = 12;
    const scratch = { drive: NaN, width: NaN, saturation: NaN };
    const span = (bounds: readonly [number, number], i: number): number =>
      bounds[0] + ((bounds[1] - bounds[0]) * i) / steps;
    for (let d = 0; d <= steps; d++)
      for (let w = 0; w <= steps; w++)
        for (let s = 0; s <= steps; s++) {
          const row = [
            span(TAPE_CORE_BOUNDS.drive, d),
            span(TAPE_CORE_BOUNDS.width, w),
            span(TAPE_CORE_BOUNDS.saturation, s),
          ] as const;
          expect(magneticRowAboveFloor(row, scratch), String(row)).toBe(true);
        }
  });

  it('ignores the controls while the flag is unset: the render is the model’s, to the bit', () => {
    const plain = tapeRig({ model: 'ferric', drive: 9 });
    const ignored = tapeRig({ model: 'ferric', drive: 9 });
    for (const [name, value] of Object.entries({
      coreDrive: 0.05,
      coreWidth: 0.85,
      coreSaturation: 1,
    }))
      ignored.params[name]![0] = value;
    for (let n = 0; n < 4096; n++) {
      if (n % 128 === 0) {
        plain.dsp.configure(plain.params, 128);
        ignored.dsp.configure(ignored.params, 128);
      }
      const x = Math.sin(n * 0.05) * 0.9;
      plain.dsp.tick(x, -x);
      ignored.dsp.tick(x, -x);
      expect(ignored.dsp.left).toBe(plain.dsp.left);
      expect(ignored.dsp.right).toBe(plain.dsp.right);
    }
    expect(ignored.dsp.magnetic.gliding).toBe(false);
  });

  it("starts every core on a song's `core`, tuned as a core built there", () => {
    for (const model of TAPE_TYPES) {
      const rig = tapeRig({ model, core: CORE });
      const params = tapeParams({ model, core: CORE });
      const at = {
        drive: params.coreDrive![0]!,
        width: params.coreWidth![0]!,
        saturation: params.coreSaturation![0]!,
      };
      const magnetic = rig.dsp.magnetic;
      expect(magnetic.controls).toEqual(at);
      expect(magnetic.gliding).toBe(false);
      rig.dsp.configure(rig.params, 128);
      expect(magnetic.gliding).toBe(false);
      for (const { factor, core } of magnetic.oversamplers) {
        const fresh = new TapeMagneticCore(48000, factor, at);
        expect(core.susceptibility).toBe(fresh.susceptibility);
        expect(core.gain).toBe(fresh.gain);
      }
    }
  });
});
