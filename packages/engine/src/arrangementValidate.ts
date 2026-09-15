/**
 * What a merged arrangement must satisfy before `ArrangementPlayer` commits
 * it: a positive tempo, a preset every part can resolve, no part renamed
 * live, and finite notes and holds. Throws — the player turns the throw into
 * `ApplyResult.error`, and a merged arrangement that fails here changes
 * nothing. The normaliser (`arrangementDocument.ts`) is what makes a
 * *committed* document satisfy this by construction; this is the guard for
 * what a live partial produces.
 */
import type { Arrangement, MusicPartId } from './arrangement';
import { MUSIC_PART_IDS } from './arrangement';
import type { Patch } from './patch';

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

export function presetFor(presets: PresetTable, id: MusicPartId, name: string): Patch {
  const preset = lookupPreset(presets, name);
  if (!preset) throw new Error(`${id}: unknown audio preset "${name}"`);
  return preset;
}

export function validateArrangement(
  next: Arrangement,
  previous: Arrangement | null,
  presets: PresetTable,
): void {
  if (!Number.isFinite(next.bpm) || next.bpm <= 0) {
    throw new RangeError(`bpm must be a positive number, got ${next.bpm}`);
  }
  for (const id of MUSIC_PART_IDS) {
    const section = next[id];
    if (!section) continue;
    presetFor(presets, id, section.preset);
    const before = previous?.[id];
    if (previous && before && section.part !== before.part) {
      throw new Error(`${id}: a part cannot be renamed live ("${before.part}")`);
    }
    if (!Number.isFinite(section.velocity) || section.velocity < 0) {
      throw new RangeError(`${id}: velocity must be >= 0, got ${section.velocity}`);
    }
  }
  for (const id of ['kick', 'hat'] as const) {
    const section = next[id];
    if (!section) continue;
    const { note, hold } = section;
    if (!Number.isFinite(note)) throw new RangeError(`${id}: note must be finite, got ${note}`);
    if (!Number.isFinite(hold) || hold <= 0) {
      throw new RangeError(`${id}: hold must be > 0 seconds, got ${hold}`);
    }
  }
}
