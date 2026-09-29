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
import type { Harmony, Swing, Transport } from './arrangement';
import type { DocumentPart } from './arrangementDocument';
import { FieldNormaliser, show } from './arrangementFields';
import {
  BARS_MAX,
  BARS_MIN,
  BPM_MAX,
  BPM_MIN,
  DEFAULT_BARS,
  DEFAULT_BPM,
  MUSIC_SLOT_MAX,
  PITCH_CLASS_MAX,
  SCALE_OFFSET_MAX,
  VELOCITY_DEFAULT,
} from '../audioConstants';
import { TICKS_PER_BAR } from '../sequencing/scheduler';
import {
  STRAIGHT_SWING,
  SWING_AMOUNT_MAX,
  SWING_AMOUNT_MIN,
  SWING_GRIDS,
  type SwingGrid,
} from '../sequencing/swingTables';
import { normaliseHarmonyEvents, normaliseRegions } from './timelineNormalise';
import { normaliseLoop } from './songLoop';
import { normaliseStrip } from './deskNormalise';
import type { Patch } from '../patch/patch';
import { clonePatch } from '../patch/patch';
import { normalisePatches } from '../patch/patchNormalise';
import { PatchResolver, type ResolveOptions } from './arrangementValidate';
import { SCALES, type ScaleName } from '../sequencing/scaleSampler';
import { normaliseSequencer, sequencerKindOf } from './sequencerNormalise';

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
   * them. Empty on the playback path, where there is no fill.
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

  /** The clock (#705): tempo, the song's explicit length in bars (decision 5), its swing and loop. */
  transport(raw: unknown): Transport {
    const o = this.section(raw, 'transport');
    this.dropUnknown(o, ['bpm', 'bars', 'swing', 'loop'], 'transport');
    const transport = {
      bpm: this.num(o.bpm, DEFAULT_BPM, BPM_MIN, BPM_MAX, 'transport.bpm'),
      bars: this.int(o.bars, DEFAULT_BARS, BARS_MIN, BARS_MAX, 'transport.bars'),
    };
    // Absent stays absent: a song from before swing or the loop plays as it
    // did and exports byte for byte as it came (records
    // `2026-09-28-song-swing-in-the-transport`, `2026-09-28-song-loop-in-the-transport`).
    const swung = o.swing === undefined ? transport : { ...transport, swing: this.swing(o.swing) };
    const loop = normaliseLoop(o.loop, transport.bars * TICKS_PER_BAR, this);
    return loop === undefined ? swung : { ...swung, loop };
  }

  /**
   * The song's swing (windsor#14): an amount clamped to 50–75 and a grid of 8
   * or 16, each defaulting to straight 16ths; junk is straight, reported.
   */
  private swing(raw: unknown): Swing {
    const path = 'transport.swing';
    const o = this.section(raw, path);
    this.dropUnknown(o, ['amount', 'grid'], path);
    const amount = this.num(
      o.amount,
      STRAIGHT_SWING.amount,
      SWING_AMOUNT_MIN,
      SWING_AMOUNT_MAX,
      `${path}.amount`,
    );
    return { amount, grid: this.swingGrid(o.grid, `${path}.grid`) };
  }

  private swingGrid(raw: unknown, path: string): SwingGrid {
    if ((SWING_GRIDS as readonly unknown[]).includes(raw)) return raw as SwingGrid;
    if (raw !== undefined) {
      this.correction(
        `${path}: ${show(raw)} is not one of ${SWING_GRIDS.join('|')} — using ${STRAIGHT_SWING.grid}`,
      );
    }
    return STRAIGHT_SWING.grid;
  }

  /** The key — a pitch-class root (decision 11) and a scale — and the chord timeline over it. */
  harmony(raw: unknown, songTicks: number): Harmony {
    const o = this.section(raw, 'harmony');
    this.dropUnknown(o, ['root', 'scale', 'events'], 'harmony');
    return {
      root: this.int(o.root, 0, 0, PITCH_CLASS_MAX, 'harmony.root'),
      scale: this.scale(o.scale),
      events: normaliseHarmonyEvents(o.events, songTicks, 'harmony.events', this),
    };
  }

  private scale(raw: unknown): ScaleName | readonly number[] {
    if (typeof raw === 'string' && Object.hasOwn(SCALES, raw)) return raw as ScaleName;
    if (Array.isArray(raw) && raw.length > 0) {
      return raw.map((offset, i) =>
        this.int(offset, 0, -SCALE_OFFSET_MAX, SCALE_OFFSET_MAX, `harmony.scale[${i}]`),
      );
    }
    // The default is the root alone — audibly not a scale, never secretly musical.
    if (raw !== undefined) {
      this.correction(`harmony.scale: ${show(raw)} names no scale — using the root alone`);
    }
    return [0];
  }

  /** One part of the list (#597): identity, patch, strip, regions and sequencer. Null drops it, reported. */
  part(raw: unknown, path: string, transport: Transport): DocumentPart | null {
    const o = this.section(raw, path);
    this.dropUnknown(
      o,
      ['slot', 'name', 'preset', 'velocity', 'strip', 'regions', 'sequencer'],
      path,
    );
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
      regions: normaliseRegions(o.regions, {
        songTicks: transport.bars * TICKS_PER_BAR,
        kind: sequencerKindOf(o.sequencer),
        path: `${path}.regions`,
        n: this,
      }),
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
