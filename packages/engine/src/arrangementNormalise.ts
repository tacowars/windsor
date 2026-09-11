/**
 * The section-level normalisers behind `makeArrangement`
 * (`arrangementDocument.ts`) — the never-throws layer above the generator
 * constructors, which throw `RangeError` on invalid config. Everything a
 * normaliser returns satisfies those constructors' asserted ranges by
 * construction: integers where integers are required, divisors that divide
 * the 96-tick bar, gates in (0, 1], weights that are not all zero.
 *
 * Field-level clamping and the report live in `arrangementFields.ts`; this
 * file knows the arrangement's shape — which keys each section owns, which
 * defaults each field takes, and which names must exist in the code. The
 * desk sections (`mix`, `returns`) are `deskNormalise.ts`'s and the `patches`
 * section is `patchNormalise.ts`'s.
 *
 * Parts are dropped, never defaulted, when they cannot play: a preset has no
 * default on purpose (a part invented by the normaliser is exactly the
 * invisible musical stand-in the record's §4 rejects).
 */
import type {
  ArpArrangement,
  ArpDriver,
  ArrangementKey,
  DroneArrangement,
  EuclideanDriver,
  PercussionArrangement,
  StepDriver,
} from './arrangement';
import {
  EUCLID_STEPS_MAX,
  GATE_MIN,
  HOLD_DEFAULT,
  HOLD_MAX,
  HOLD_MIN,
  LFO_BARS_DEFAULT,
  LFO_BARS_MAX,
  LFO_BARS_MIN,
  LFO_HZ_DEFAULT,
  LFO_HZ_MAX,
  MIDI_MIDDLE_C,
  MIDI_NOTE_MAX,
  OCTAVE_MAX,
  POOL_SIZE_MAX,
  REFRESH_BARS_MAX,
  SCALE_OFFSET_MAX,
  SPAN_MAX,
  VELOCITY_DEFAULT,
  WALK_CHANCE,
  WEIGHT_MAX,
} from './audioConstants';
import { FieldNormaliser, show } from './arrangementFields';
import { ARP_WALK_MODES, DEFAULT_ARPEGGIATOR_CONFIG } from './arpeggiator';
import {
  DEFAULT_EUCLIDEAN_CONFIG,
  DENSITY_MOD_KINDS,
  LFO_SHAPES,
  type DensityMod,
} from './euclideanSequencer';
import { MIX } from './mix';
import type { Patch } from './patch';
import { normalisePatches } from './patchNormalise';
import { PRESETS } from './presets';
import { SCALES, scaleOffsets, type ScaleName } from './scaleSampler';
import type { Register } from './scaleSampler';
import { DEFAULT_STEP_SEQUENCER_CONFIG } from './stepSequencer';

export class ArrangementNormaliser extends FieldNormaliser {
  /**
   * The names the document's own `patches` section defines: a part's
   * `preset` resolves against them before the code's `PRESETS`, so a document
   * patch named like a built-in shadows it for this document's parts.
   */
  private localPatches: ReadonlySet<string> = new Set();

  /** The `patches` section — normalised first, so the parts can name its entries. */
  patches(raw: unknown): Record<string, Patch> | undefined {
    const out = normalisePatches(raw, this);
    this.localPatches = new Set(Object.keys(out ?? {}));
    return out;
  }

  key(raw: unknown): ArrangementKey {
    const o = this.section(raw, 'key');
    this.dropUnknown(o, ['root', 'scale', 'weights'], 'key');
    const scale = this.scale(o.scale);
    return {
      root: this.int(o.root, MIDI_MIDDLE_C, 0, MIDI_NOTE_MAX, 'key.root'),
      scale,
      weights: this.weights(o.weights, scaleOffsets(scale).length),
    };
  }

  private scale(raw: unknown): ScaleName | readonly number[] {
    if (typeof raw === 'string' && Object.hasOwn(SCALES, raw)) return raw as ScaleName;
    if (Array.isArray(raw) && raw.length > 0) {
      return raw.map((offset, i) =>
        this.int(offset, 0, -SCALE_OFFSET_MAX, SCALE_OFFSET_MAX, `key.scale[${i}]`),
      );
    }
    // The default is the root alone — audibly not a scale, never secretly musical.
    if (raw !== undefined) {
      this.correction(`key.scale: ${show(raw)} names no scale — using the root alone`);
    }
    return [0];
  }

  private weights(raw: unknown, degrees: number): readonly number[] {
    const uniform = (): number[] => new Array<number>(degrees).fill(1);
    if (!Array.isArray(raw)) {
      if (raw !== undefined) {
        this.correction('key.weights: not an array — weighting every degree equally');
      }
      return uniform();
    }
    const out: number[] = [];
    for (let i = 0; i < degrees; i++) {
      out.push(this.num(raw[i], 1, 0, WEIGHT_MAX, `key.weights[${i}]`));
    }
    if (raw.length !== degrees) {
      this.correction(`key.weights: ${raw.length} weights for ${degrees} degrees — resized`);
    }
    if (!out.some((w) => w > 0)) {
      this.correction('key.weights: all zero — weighting every degree equally');
      return uniform();
    }
    return out;
  }

  percussion(raw: unknown, id: 'kick' | 'hat'): PercussionArrangement | null {
    if (raw === undefined) return null;
    const o = this.section(raw, id);
    this.dropUnknown(o, ['part', 'preset', 'note', 'velocity', 'hold', 'driver'], id);
    const identity = this.identity(o, id);
    if (!identity) return null;
    return {
      ...identity,
      note: this.int(o.note, MIDI_MIDDLE_C, 0, MIDI_NOTE_MAX, `${id}.note`),
      velocity: this.num(o.velocity, VELOCITY_DEFAULT, 0, 1, `${id}.velocity`),
      hold: this.num(o.hold, HOLD_DEFAULT, HOLD_MIN, HOLD_MAX, `${id}.hold`),
      driver: this.euclideanDriver(o.driver, `${id}.driver`),
    };
  }

  arp(raw: unknown): ArpArrangement | null {
    if (raw === undefined) return null;
    const o = this.section(raw, 'arp');
    this.dropUnknown(o, ['part', 'preset', 'velocity', 'driver'], 'arp');
    const identity = this.identity(o, 'arp');
    if (!identity) return null;
    return {
      ...identity,
      velocity: this.num(o.velocity, VELOCITY_DEFAULT, 0, 1, 'arp.velocity'),
      driver: this.arpDriver(o.driver),
    };
  }

  drone(raw: unknown): DroneArrangement | null {
    if (raw === undefined) return null;
    const o = this.section(raw, 'drone');
    this.dropUnknown(o, ['part', 'preset', 'velocity', 'driver'], 'drone');
    const identity = this.identity(o, 'drone');
    if (!identity) return null;
    return {
      ...identity,
      velocity: this.num(o.velocity, VELOCITY_DEFAULT, 0, 1, 'drone.velocity'),
      driver: this.stepDriver(o.driver),
    };
  }

  /**
   * The two names a part cannot play without. A preset is looked up in the
   * document's `patches` first, then the code's `PRESETS`; unknown in both,
   * it drops the part (and is dangling — the gate's business). A part name
   * with no strip still plays, through `DEFAULT_STRIP`, but is dangling too.
   */
  private identity(
    o: Record<string, unknown>,
    id: string,
  ): { part: string; preset: string } | null {
    const part = typeof o.part === 'string' && o.part !== '' ? o.part : id;
    if (o.part !== undefined && o.part !== part) {
      this.correction(`${id}.part: ${show(o.part)} is not a name — using "${id}"`);
    }
    if (typeof o.preset !== 'string') {
      this.correction(`${id}: a part needs a preset, and a preset has no default — part dropped`);
      return null;
    }
    if (!this.localPatches.has(o.preset) && !Object.hasOwn(PRESETS, o.preset)) {
      this.dangling.push(`${id}.preset: no preset "${o.preset}" is defined`);
      this.correction(`${id}: unknown preset "${o.preset}" — part dropped`);
      return null;
    }
    if (!Object.hasOwn(MIX, part))
      this.dangling.push(`${id}.part: the MIX defines no strip "${part}"`);
    return { part, preset: o.preset };
  }

  private euclideanDriver(raw: unknown, path: string): EuclideanDriver {
    const d = DEFAULT_EUCLIDEAN_CONFIG;
    const o = this.section(raw, path);
    this.dropUnknown(o, ['steps', 'divisor', 'pulses', 'rotate', 'density', 'pattern'], path);
    const steps = this.int(o.steps, d.steps, 1, EUCLID_STEPS_MAX, `${path}.steps`);
    return {
      steps,
      divisor: this.divisor(o.divisor, d.divisor, `${path}.divisor`),
      pulses: this.pulses(o.pulses, steps, `${path}.pulses`),
      rotate: this.int(o.rotate, 0, -steps, steps, `${path}.rotate`),
      density: this.density(o.density, `${path}.density`),
      // Always present, `null` when generative, so a live capture or release
      // merges through `AudioSystem.apply` (a merge only reaches keys the
      // current arrangement has).
      pattern: this.stepPattern(o.pattern, steps, `${path}.pattern`),
    };
  }

  private pulses(
    raw: unknown,
    steps: number,
    path: string,
  ): { min: number; max: number; start: number } {
    const d = DEFAULT_EUCLIDEAN_CONFIG.pulses;
    const o = this.section(raw, path);
    this.dropUnknown(o, ['min', 'max', 'start'], path);
    const min = this.int(o.min, Math.min(d.min, steps), 0, steps, `${path}.min`);
    let max = this.int(o.max, Math.min(d.max, steps), 0, steps, `${path}.max`);
    if (max < min) {
      this.correction(`${path}: max ${max} below min ${min} — raised to ${min}`);
      max = min;
    }
    const start = this.int(
      o.start,
      Math.min(Math.max(d.start, min), max),
      min,
      max,
      `${path}.start`,
    );
    return { min, max, start };
  }

  private density(raw: unknown, path: string): DensityMod {
    const o = this.section(raw, path);
    const kind = this.pick(o.kind, DENSITY_MOD_KINDS, 'lfoBars', `${path}.kind`);
    if (kind === 'walk') {
      this.dropUnknown(o, ['kind', 'stepChance'], path);
      return {
        kind,
        stepChance: this.num(o.stepChance, WALK_CHANCE, 0, 1, `${path}.stepChance`),
      };
    }
    if (kind === 'lfoHz') {
      this.dropUnknown(o, ['kind', 'hz', 'shape'], path);
      return {
        kind,
        hz: this.num(o.hz, LFO_HZ_DEFAULT, 0, LFO_HZ_MAX, `${path}.hz`),
        shape: this.pick(o.shape, LFO_SHAPES, 'tri', `${path}.shape`),
      };
    }
    this.dropUnknown(o, ['kind', 'bars', 'shape'], path);
    return {
      kind: 'lfoBars',
      bars: this.num(o.bars, LFO_BARS_DEFAULT, LFO_BARS_MIN, LFO_BARS_MAX, `${path}.bars`),
      shape: this.pick(o.shape, LFO_SHAPES, 'tri', `${path}.shape`),
    };
  }

  private arpDriver(raw: unknown): ArpDriver {
    const d = DEFAULT_ARPEGGIATOR_CONFIG;
    const o = this.section(raw, 'arp.driver');
    const known = ['divisor', 'poolSize', 'refreshBars', 'walk', 'skipChance', 'register', 'gate'];
    this.dropUnknown(o, [...known, 'pattern'], 'arp.driver');
    return {
      divisor: this.divisor(o.divisor, d.divisor, 'arp.driver.divisor'),
      poolSize: this.int(o.poolSize, d.poolSize, 1, POOL_SIZE_MAX, 'arp.driver.poolSize'),
      refreshBars: this.int(
        o.refreshBars,
        d.refreshBars,
        1,
        REFRESH_BARS_MAX,
        'arp.driver.refreshBars',
      ),
      walk: this.pick(o.walk, ARP_WALK_MODES, d.walk, 'arp.driver.walk'),
      skipChance: this.num(o.skipChance, d.skipChance, 0, 1, 'arp.driver.skipChance'),
      register: this.register(o.register, d.register, 'arp.driver.register'),
      gate: this.num(o.gate, d.gate, GATE_MIN, 1, 'arp.driver.gate'),
      pattern: this.notePattern(o.pattern, 'arp.driver.pattern'),
    };
  }

  private stepDriver(raw: unknown): StepDriver {
    const d = DEFAULT_STEP_SEQUENCER_CONFIG;
    const o = this.section(raw, 'drone.driver');
    this.dropUnknown(o, ['divisor', 'gate', 'register', 'pattern'], 'drone.driver');
    return {
      divisor: this.divisor(o.divisor, d.divisor, 'drone.driver.divisor'),
      gate: this.num(o.gate, d.gate, GATE_MIN, 1, 'drone.driver.gate'),
      register: this.register(o.register, d.register, 'drone.driver.register'),
      pattern: this.notePattern(o.pattern, 'drone.driver.pattern'),
    };
  }

  private register(raw: unknown, fallback: Register, path: string): Register {
    const o = this.section(raw, path);
    this.dropUnknown(o, ['octave', 'span'], path);
    return {
      octave: this.int(o.octave, fallback.octave, -OCTAVE_MAX, OCTAVE_MAX, `${path}.octave`),
      span: this.int(o.span, fallback.span, 1, SPAN_MAX, `${path}.span`),
    };
  }
}
