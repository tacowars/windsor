/**
 * What a merged arrangement must satisfy before `ArrangementPlayer` commits
 * it: a positive tempo, 1–8 parts on unique slots 0–7, the same slots in the
 * same order as before (a live partial cannot add, remove or move a part —
 * #597), a preset every part can resolve, and finite velocities, notes and
 * holds. Throws — the player turns the throw into
 * `ApplyResult.error`, and a merged arrangement that fails here changes
 * nothing. The normaliser (`arrangementDocument.ts`) is what makes a
 * *committed* document satisfy this by construction; this is the guard for
 * what a live partial produces.
 */
import type { Arrangement, ArrangementPartial, MusicPart } from './arrangement';
import { SEQUENCER_KINDS } from './arrangement';
import { MUSIC_PARTS_MAX, MUSIC_SLOT_MAX } from '../audioConstants';
import type { Patch } from '../patch/patch';

/** The preset table a part name resolves against: since #562, the document's patches. */
export type PresetTable = Readonly<Record<string, Patch>>;

/** An own entry of the table, or undefined — never an inherited `constructor`. */
export function lookupPreset(presets: PresetTable, name: string): Patch | undefined {
  return Object.hasOwn(presets, name) ? presets[name] : undefined;
}

/** The one resolver's only variation: whether a name the document omits may come from the library. */
export interface ResolveOptions {
  /**
   * The editor's open path (#562): a part naming a library id the document
   * does not embed resolves here once, and the fill is recorded so the caller
   * can embed it and tell the user. Absent on the game path — there, a name
   * the document does not define is an error, never the library's business.
   */
  readonly libraryFill?: PresetTable;
}

/**
 * How a song document's part presets resolve (#562, epic #564 decision 2).
 *
 * A song is self-contained: its `patches` section is the table, and the
 * game path hands no `libraryFill`, so improving `patches/<id>.json` cannot
 * silently change what a shipped song plays. The editor hands the library in,
 * which is how a document written before #562 still opens — resolved once,
 * recorded in `filled`, and embedded by the normaliser so the next export
 * carries it.
 *
 * One resolver, one option: the game rule and the editor rule differ by this
 * object and nothing else.
 */
export class PatchResolver {
  private readonly filledIds = new Set<string>();

  constructor(
    private readonly documentPatches: PresetTable = {},
    private readonly options: ResolveOptions = {},
  ) {}

  /** The patch a part's `preset` names, or undefined. Records a library fill. */
  lookup(name: string): Patch | undefined {
    const own = lookupPreset(this.documentPatches, name);
    if (own) return own;
    const { libraryFill } = this.options;
    if (!libraryFill) return undefined;
    const filled = lookupPreset(libraryFill, name);
    if (filled) this.filledIds.add(name);
    return filled;
  }

  /** The game's load error: names the part and the id, and never falls back. */
  require(id: string, name: string): Patch {
    const patch = this.lookup(name);
    if (!patch) {
      throw new Error(
        `${id}: the song document defines no patch "${name}" — a song carries every patch it plays (#562)`,
      );
    }
    return patch;
  }

  /** Ids that came from the library fill, in first-use order; empty on the game path. */
  get filled(): readonly string[] {
    return [...this.filledIds];
  }

  /** The document's patches plus the fills actually used — what the player validates against. */
  table(): Record<string, Patch> {
    const out: Record<string, Patch> = { ...this.documentPatches };
    const { libraryFill } = this.options;
    for (const id of this.filledIds) {
      const patch = libraryFill && lookupPreset(libraryFill, id);
      if (patch) out[id] = patch;
    }
    return out;
  }
}

/** Where a validation message says a part is: its slot and label. */
export const partLabel = (part: Pick<MusicPart, 'slot' | 'name'>): string =>
  `part ${part.slot} ("${part.name}")`;

export function presetFor(presets: PresetTable, where: string, name: string): Patch {
  const preset = lookupPreset(presets, name);
  if (!preset) throw new Error(`${where}: unknown audio preset "${name}"`);
  return preset;
}

export function validateArrangement(next: Arrangement, presets: PresetTable): void {
  const { bpm, bars } = next.transport;
  if (!Number.isFinite(bpm) || bpm <= 0) {
    throw new RangeError(`transport.bpm must be a positive number, got ${bpm}`);
  }
  if (!Number.isInteger(bars) || bars < 1) {
    throw new RangeError(`transport.bars must be a positive integer, got ${bars}`);
  }
  validateSlots(next);
  for (const part of next.parts) validatePart(part, presets);
}

/**
 * A live partial may add a part on a free slot or remove one (#629), but a
 * slot is a part's identity: an edit addressed to slot 2 that carries
 * `slot: 6` is refused before the merge, never applied as "remove 2, add 6".
 */
export function validatePartialSlots(partial: ArrangementPartial): void {
  for (const [key, value] of Object.entries(partial.parts ?? {})) {
    if (typeof value !== 'object' || value === null || !('slot' in value)) continue;
    if (value.slot !== Number(key)) {
      throw new Error(
        `parts.${key}: a part cannot be re-slotted live (slot ${String(value.slot)})`,
      );
    }
  }
}

function validateSlots(next: Arrangement): void {
  const count = next.parts.length;
  if (count < 1 || count > MUSIC_PARTS_MAX) {
    throw new RangeError(`a song has 1–${MUSIC_PARTS_MAX} parts, got ${count}`);
  }
  const seen = new Set<number>();
  for (const { slot } of next.parts) {
    if (!Number.isInteger(slot) || slot < 0 || slot > MUSIC_SLOT_MAX) {
      throw new RangeError(`slot must be an integer 0–${MUSIC_SLOT_MAX}, got ${slot}`);
    }
    if (seen.has(slot)) throw new Error(`slot ${slot} is used by two parts`);
    seen.add(slot);
  }
}

function validatePart(part: MusicPart, presets: PresetTable): void {
  // A part arriving whole through a live add (#629) is checked field by field
  // here: the merge is structural and appends whatever names the slot.
  if (typeof part.name !== 'string') {
    throw new Error(`part ${part.slot}: a part needs a name, got ${String(part.name)}`);
  }
  const where = partLabel(part);
  presetFor(presets, where, part.preset);
  if (!Number.isFinite(part.velocity) || part.velocity < 0) {
    throw new RangeError(`${where}: velocity must be >= 0, got ${part.velocity}`);
  }
  const { sequencer } = part;
  if (typeof sequencer !== 'object' || sequencer === null) {
    throw new Error(`${where}: a part needs a sequencer, got ${String(sequencer)}`);
  }
  if (!(SEQUENCER_KINDS as readonly string[]).includes(sequencer.kind)) {
    throw new Error(`${where}: no sequencer kind "${String(sequencer.kind)}"`);
  }
  if (sequencer.kind !== 'euclidean') return;
  const { note, hold } = sequencer;
  if (!Number.isFinite(note)) throw new RangeError(`${where}: note must be finite, got ${note}`);
  if (!Number.isFinite(hold) || hold <= 0) {
    throw new RangeError(`${where}: hold must be > 0 seconds, got ${hold}`);
  }
}
