/**
 * A patch's macros on the voice (windsor#560, record
 * `2026-10-04-patch-macro-knobs` decisions 3, 4 and 6): each mapping turns
 * its macro's value into the base of the target it maps, over which the
 * step's push applies as it does over the patch's value.
 *
 * - `compileMacros` lays a normalised patch's mappings out as typed arrays
 *   on the patch itself (`MacroTables`), at the processor's construction
 *   and at each `patch` message, never in the render. A voice reads the
 *   tables of the patch it is bound to, so a held voice keeps its note-on
 *   patch's mappings through a preset swap with live retune off. A ratio
 *   row's ends are raised to the row's floor here, and `log2(max / min)` is
 *   worked out here, so the render takes no logarithm.
 * - `applyMacroBases` writes, for each mapping, the shaped macro value
 *   `src[macro]` interpolated between the mapping's ends (geometrically on
 *   a ratio row, linearly on an add row) into `dst[target]`, then the
 *   voice's step push over it in the row's curve, clamped to the row. It
 *   reads no lane offset: a target its patch maps ignores a direct lane
 *   (decision 6). `bindOwnValues` and `bindLiveValues` call it after their
 *   macro rows are resolved.
 *
 * Invariant: a patch without mappings compiles to a count of 0, and
 * `applyMacroBases` is then never called, so every render without macros
 * is bit for bit as before (`fmProcessorGolden.test.ts`). The shapes are
 * multiplications written out in the loop (no `Math.pow`), and the power of
 * two is `exp2InPlace`, so the arithmetic is the same on arm64 and x64; no
 * double crosses a call and nothing is allocated per block (windsor#233,
 * `fmProcessorAllocation.test.ts`). `voiceMacros.test.ts` pins the
 * arithmetic, `synth/fmProcessorMacro.test.ts` the voice.
 */

import type { Patch } from '../../patch/patch';
import type { WorkletPatch } from './patchNormalise';
import { MACRO_EXP, MACRO_LOG, MACRO_S } from './modeIds';
import { MACRO_MAPPINGS_MAX, MACROS_MAX } from './patchDefaults';
import { exp2InPlace, log2InPlace } from './portablePowers';
import {
  VOICE_TARGET_COUNT,
  VOICE_TARGET_FLOOR,
  VOICE_TARGET_MAX,
  VOICE_TARGET_MIN,
  VOICE_TARGET_RATIO,
  VOICE_TARGET_SPAN,
  VT_MACRO_BASE,
  voiceTargetCode,
} from './voiceTargetTables';

/**
 * A normalised patch's mappings, in the order the patch lists them, the
 * first `macroMapCount` entries used: each its target's code, its macro's
 * code, its ends (raised to a ratio row's floor), its span (`log2(max /
 * min)` on a ratio row, `max − min` on an add row), its `MACRO_CURVE` id and
 * its polarity; and `macroMapped`, by target code, 1 where a mapping sets
 * the base.
 */
interface MacroTables {
  macroMapTarget: Int32Array;
  macroMapMacro: Int32Array;
  macroMapMin: Float64Array;
  macroMapMax: Float64Array;
  macroMapSpan: Float64Array;
  macroMapCurve: Uint8Array;
  macroMapInverted: Uint8Array;
  macroMapCount: number;
  macroMapped: Uint8Array;
}

/** The most mappings a patch carries: a few per macro, one per target. */
const MACRO_MAP_CAPACITY = MACROS_MAX * MACRO_MAPPINGS_MAX;

/** One double for the portable log and power, which work in place. */
const powerSlot = new Float64Array(1);

/**
 * `patch` with its mappings compiled onto it (`MacroTables`). The
 * normalisers have already dropped a mapping onto a macro row, an unknown
 * target or a target an earlier mapping holds, and clamped each end to the
 * row; a target that still reads no code is skipped. Allocates: run where
 * the patch is normalised, never in the render.
 */
function compileMacros(patch: Patch): WorkletPatch {
  const tables: MacroTables = {
    macroMapTarget: new Int32Array(MACRO_MAP_CAPACITY),
    macroMapMacro: new Int32Array(MACRO_MAP_CAPACITY),
    macroMapMin: new Float64Array(MACRO_MAP_CAPACITY),
    macroMapMax: new Float64Array(MACRO_MAP_CAPACITY),
    macroMapSpan: new Float64Array(MACRO_MAP_CAPACITY),
    macroMapCurve: new Uint8Array(MACRO_MAP_CAPACITY),
    macroMapInverted: new Uint8Array(MACRO_MAP_CAPACITY),
    macroMapCount: 0,
    macroMapped: new Uint8Array(VOICE_TARGET_COUNT),
  };
  const macros = patch.macros;
  let n = 0;
  for (let i = 0; i < macros.length && i < MACROS_MAX; i++) {
    const mappings = macros[i].mappings;
    for (let j = 0; j < mappings.length && n < MACRO_MAP_CAPACITY; j++) {
      const m = mappings[j];
      const code = voiceTargetCode(m.target);
      if (code < 0 || code >= VT_MACRO_BASE || tables.macroMapped[code] !== 0) continue;
      writeMapping(tables, n, code, m);
      tables.macroMapMacro[n] = VT_MACRO_BASE + i;
      tables.macroMapped[code] = 1;
      n++;
    }
  }
  tables.macroMapCount = n;
  return Object.assign(patch, tables);
}

/** Entry `n`: mapping `m` onto the target at `code`, its ends raised to a ratio row's floor. */
function writeMapping(
  tables: MacroTables,
  n: number,
  code: number,
  m: Patch['macros'][number]['mappings'][number],
): void {
  let lo = m.min;
  let hi = m.max;
  tables.macroMapTarget[n] = code;
  tables.macroMapCurve[n] = m.curve;
  tables.macroMapInverted[n] = m.inverted ? 1 : 0;
  if (VOICE_TARGET_RATIO[code] === 0) {
    tables.macroMapMin[n] = lo;
    tables.macroMapMax[n] = hi;
    tables.macroMapSpan[n] = hi - lo;
    return;
  }
  const floor = VOICE_TARGET_FLOOR[code] > 0 ? VOICE_TARGET_FLOOR[code] : VOICE_TARGET_MIN[code];
  if (lo < floor) lo = floor;
  if (hi < floor) hi = floor;
  tables.macroMapMin[n] = lo;
  tables.macroMapMax[n] = hi;
  powerSlot[0] = hi / lo;
  log2InPlace(powerSlot, 0);
  tables.macroMapSpan[n] = powerSlot[0];
}

/**
 * Each mapping of `patch` into `dst`: the target's base from the shaped
 * value of `src` at the mapping's macro, then `pushes` (the voice's step
 * offsets) over it in the row's curve, clamped to the row's bounds. `src`
 * and `dst` may be one array; the macro rows are never targets, so no
 * mapping reads what another wrote. Allocates nothing.
 */
function applyMacroBases(
  patch: WorkletPatch,
  src: Float64Array,
  dst: Float64Array,
  pushes: Float64Array,
): void {
  const count = patch.macroMapCount;
  const targets = patch.macroMapTarget;
  for (let j = 0; j < count; j++) {
    const k = targets[j];
    let x = src[patch.macroMapMacro[j]];
    if (patch.macroMapInverted[j] !== 0) x = 1 - x;
    const curve = patch.macroMapCurve[j];
    let s = x;
    if (curve === MACRO_EXP) s = x * x * x;
    else if (curve === MACRO_LOG) s = 1 - (1 - x) * (1 - x) * (1 - x);
    // eslint-disable-next-line no-magic-numbers -- smoothstep x²(3 − 2x), the curve's own arithmetic (record decision 4)
    else if (curve === MACRO_S) s = x * x * (3 - 2 * x);
    const ratio = VOICE_TARGET_RATIO[k] !== 0;
    let y: number;
    if (ratio) {
      powerSlot[0] = patch.macroMapSpan[j] * s;
      exp2InPlace(powerSlot, 0);
      y = patch.macroMapMin[j] * powerSlot[0];
    } else {
      y = patch.macroMapMin[j] + patch.macroMapSpan[j] * s;
    }
    const push = pushes[k];
    if (push !== 0) {
      const d = push * VOICE_TARGET_SPAN[k];
      if (ratio) {
        powerSlot[0] = d;
        exp2InPlace(powerSlot, 0);
        y *= powerSlot[0];
      } else {
        y += d;
      }
    }
    const min = VOICE_TARGET_MIN[k];
    const max = VOICE_TARGET_MAX[k];
    dst[k] = y < min ? min : y > max ? max : y;
  }
}

export type { MacroTables };
export { MACRO_MAP_CAPACITY, applyMacroBases, compileMacros };
