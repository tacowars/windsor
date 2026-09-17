/**
 * The section-level normalisers behind `makeArrangement`
 * (`arrangementDocument.ts`) — the never-throws layer above the generator
 * constructors, which throw `RangeError` on invalid config.
 *
 * Field-level clamping and the report live in `arrangementFields.ts`; this
 * file knows the arrangement's shape — the key, and each part's identity,
 * patch and strip. A part's sequencer is `sequencerNormalise.ts`'s, the strip
 * and returns are `deskNormalise.ts`'s and the `patches` section is
 * `patchNormalise.ts`'s.
 *
 * Parts are dropped, never defaulted, when they cannot play: a slot and a
 * preset have no default on purpose (a part invented by the normaliser is
 * exactly the invisible musical stand-in the record's §4 rejects). An absent
 * sequencer, by contrast, is `none` — inert, never a musical guess (#597).
 */
import type { ArrangementKey } from './arrangement';
import type { DocumentPart } from './arrangementDocument';
import { FieldNormaliser, show } from './arrangementFields';
import {
  MIDI_MIDDLE_C,
  MIDI_NOTE_MAX,
  MUSIC_SLOT_MAX,
  SCALE_OFFSET_MAX,
  VELOCITY_DEFAULT,
  WEIGHT_MAX,
} from './audioConstants';
import { normaliseStrip } from './deskNormalise';
import type { Patch } from './patch';
import { clonePatch } from './patch';
import { normalisePatches } from './patchNormalise';
import { PatchResolver, type ResolveOptions } from './arrangementValidate';
import { SCALES, scaleOffsets, type ScaleName } from './scaleSampler';
import { normaliseSequencer } from './sequencerNormalise';

export class ArrangementNormaliser extends FieldNormaliser {
  /**
   * The one resolver (#562): the document's `patches` section, plus the
   * library only when the caller asked for the fill. Replaced by `patches()`
   * once that section is normalised; until then nothing resolves.
   */
  private resolver: PatchResolver;

  constructor(private readonly resolve: ResolveOptions = {}) {
    super();
    this.resolver = new PatchResolver({}, resolve);
  }

  /** The `patches` section — normalised first, so the parts can name its entries. */
  patches(raw: unknown): Record<string, Patch> | undefined {
    const out = normalisePatches(raw, this);
    this.resolver = new PatchResolver(out ?? {}, this.resolve);
    return out;
  }

  /**
   * Library patches the parts resolved through the fill, by id — what the
   * editor's open path embeds into the document so the next export carries
   * them. Empty on the game path, where there is no fill.
   */
  filledPatches(): Record<string, Patch> {
    const out: Record<string, Patch> = {};
    for (const id of this.resolver.filled) {
      const patch = this.resolver.lookup(id);
      // Cloned: the embedded snapshot must not alias the library table, or a
      // later document edit would reach back into `patches/<id>.json`'s value.
      if (patch) out[id] = clonePatch(patch);
    }
    return out;
  }

  /** Ids the fill supplied, for the editor's report. */
  get filled(): readonly string[] {
    return this.resolver.filled;
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

  /** One part of the list (#597): identity, patch, strip and sequencer. Null drops it, reported. */
  part(raw: unknown, path: string): DocumentPart | null {
    const o = this.section(raw, path);
    this.dropUnknown(o, ['slot', 'name', 'preset', 'velocity', 'strip', 'sequencer'], path);
    const slot = this.slot(o.slot, path);
    if (slot === null) return null;
    const preset = this.preset(o.preset, path);
    if (preset === null) return null;
    const fallbackName = `Part ${slot + 1}`;
    if (o.name !== undefined && typeof o.name !== 'string') {
      this.correction(`${path}.name: ${show(o.name)} is not a name — using "${fallbackName}"`);
    }
    return {
      slot,
      name: typeof o.name === 'string' ? o.name : fallbackName,
      preset,
      velocity: this.num(o.velocity, VELOCITY_DEFAULT, 0, 1, `${path}.velocity`),
      strip: normaliseStrip(o.strip, `${path}.strip`, this),
      sequencer: normaliseSequencer(o.sequencer, `${path}.sequencer`, this),
    };
  }

  /** A part's identity has no default: a missing or out-of-range slot drops the part. */
  private slot(raw: unknown, path: string): number | null {
    if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0 || raw > MUSIC_SLOT_MAX) {
      this.correction(
        `${path}.slot: ${show(raw)} is not a slot 0–${MUSIC_SLOT_MAX} — part dropped`,
      );
      return null;
    }
    return raw;
  }

  /**
   * A part cannot play without a preset, and a preset has no default. It is
   * looked up through the resolver — the document's `patches`, and the
   * library only on the editor's fill path (#562); unresolved, it drops the
   * part and is dangling — the gate's business.
   */
  private preset(raw: unknown, path: string): string | null {
    if (typeof raw !== 'string') {
      this.correction(`${path}: a part needs a preset, and a preset has no default — part dropped`);
      return null;
    }
    if (!this.resolver.lookup(raw)) {
      this.dangling.push(`${path}.preset: no preset "${raw}" is defined`);
      this.correction(`${path}: unknown preset "${raw}" — part dropped`);
      return null;
    }
    return raw;
  }
}
