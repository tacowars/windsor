/**
 * The console's MIDI CC state (windsor#784, record `2026-10-13-midi-cc-mapping`):
 * the router over the live engine, the one learn session, the takeover
 * preference and what the panel shows of each mapping. It hears the MIDI
 * input (`midiAccess.ts`), the document (every edit, undo and open) and the
 * host (a new system, a value the engine dropped), and tells its listeners;
 * the panel draws from it. No DOM and no Web MIDI, so the tests drive it with
 * fakes.
 *
 * - **A message** drives every mapping it matches, whichever part is
 *   selected (decision 1), and, while learn listens, is learn's too.
 * - **Learn** commits once a CC moves far enough (decision 11): a new
 *   mapping over the target's full range, or a mapped target's new source,
 *   as one song edit. The row then reads "Heard CC 74 · ch 1 · <device>"
 *   until the panel clears it. Cancel, Escape, a song switch or the part's
 *   removal leave nothing behind.
 * - **The document.** A song opened gives the router its mappings fresh;
 *   any other edit hands it the new list and, through `ccDocumentEvents`,
 *   the targets edited on screen (last in wins) and the lanes let go.
 * - **The host.** A new live system holds no CC value, so every mapping
 *   re-arms; a value the engine drops on its own re-arms its mapping.
 */
import type { ArrangementDocument, CcSource, CcTargetId, DocumentPartial } from '@windsor/engine';
import { partAt } from '@windsor/engine';

import type { CcMessage } from './ccEngine';
import { CcLearn, learnedMappings } from './ccLearn';
import { DocumentCcEngine, type PerformanceHost } from './ccPanelEngine';
import { ccDocumentEvents, songCcMappings, type CcPartTarget } from './ccPanelSync';
import { CcRouter, ccSourceHears } from './ccRouter';
import type { CcStatus } from './ccStatus';
import type { CcTakeover } from './ccTakeover';

/** What the session is built over: the document, the host and the one way to edit the song. */
export interface CcSessionDeps {
  doc(): ArrangementDocument;
  host: PerformanceHost;
  /** A song edit with its undo step: `ctx.change`. True when it landed. */
  commit(partial: DocumentPartial, label: string): boolean;
  takeover?: CcTakeover;
}

/** Learn listening for one target of one part. */
export interface CcLearning extends CcPartTarget {
  /** The target has no mapping yet: the panel draws a pending row for it. */
  readonly added: boolean;
}

/** A source learn has just committed, which the row shows until the panel clears it. */
export interface CcHeard extends CcPartTarget {
  readonly source: CcSource;
}

/** The device and channel a mapping last heard. */
export interface CcHeardFrom {
  readonly device: string | null;
  readonly channel: number;
}

/** What changed: `live` for a CC value alone, `setup` for anything the rows are drawn from. */
export type CcSessionChange = 'live' | 'setup';

/** The undo step's name for every mapping edit. */
export const CC_EDIT_LABEL = 'MIDI CC mapping';

const keyOf = (part: number, target: CcTargetId): string => `${part}|${target}`;

/** The partial that sets `part`'s mappings to `list`, whole. */
export const ccMappingsChange = (part: number, list: readonly unknown[]): DocumentPartial =>
  ({ parts: { [part]: { ccMappings: list } } }) as DocumentPartial;

export class CcSession {
  readonly engine: DocumentCcEngine;
  readonly router: CcRouter;
  private learner: CcLearn | null = null;
  private learnOn: CcLearning | null = null;
  private heardNow: CcHeard | null = null;
  private readonly heardBy = new Map<string, CcHeardFrom>();
  private readonly listeners = new Set<(change: CcSessionChange) => void>();

  constructor(private readonly deps: CcSessionDeps) {
    this.engine = new DocumentCcEngine(deps.doc, deps.host);
    this.router = new CcRouter(this.engine, deps.takeover ?? 'pickup');
    this.router.songOpened(songCcMappings(deps.doc()));
  }

  /** Hear every change, until the returned call stops it. */
  onChange(listener: (change: CcSessionChange) => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  get takeover(): CcTakeover {
    return this.router.takeover;
  }

  set takeover(takeover: CcTakeover) {
    this.router.takeover = takeover;
    this.changed('setup');
  }

  /** The target learn listens for, or null. */
  get learning(): CcLearning | null {
    return this.learnOn;
  }

  /** The source learn just committed, until `clearHeard`. */
  get heard(): CcHeard | null {
    return this.heardNow;
  }

  /** The device and channel the mapping on `target` of `part` last heard, since the song opened. */
  heardFrom(part: number, target: CcTargetId): CcHeardFrom | undefined {
    return this.heardBy.get(keyOf(part, target));
  }

  /** The row's status (`ccStatus.ts`), or undefined for a target with no mapping. */
  status(part: number, target: CcTargetId): CcStatus | undefined {
    return this.router.status(part, target);
  }

  /** The target's value now: the CC's base where one is held, else its own. */
  current(part: number, target: CcTargetId): number | undefined {
    return this.engine.heldValue(part, target) ?? this.engine.target(part, target)?.own;
  }

  /** One controller message from an input the MIDI selector listens to. */
  hear(message: CcMessage): void {
    const source = this.learner?.hear(message) ?? null;
    if (source && this.learnOn) this.commitLearned(this.learnOn, source);
    for (const { part, mapping } of songCcMappings(this.deps.doc())) {
      if (ccSourceHears(mapping.source, message)) {
        this.heardBy.set(keyOf(part, mapping.target), {
          device: message.device,
          channel: message.channel,
        });
      }
    }
    this.router.handle(message);
    this.changed(source ? 'setup' : 'live');
  }

  /** The console listens to `device` again (plugged back in, or selected again). */
  listened(device: string | null): void {
    this.router.inputListened(device);
    this.changed('live');
  }

  /** Learn listens for `target` of `part`; any learn before it is cancelled. */
  learn(part: number, target: CcTargetId): void {
    const mapped = partAt(this.deps.doc(), part)?.ccMappings?.some((m) => m.target === target);
    this.learner?.cancel();
    this.learner = new CcLearn();
    this.learnOn = { part, target, added: mapped !== true };
    this.heardNow = null;
    this.changed('setup');
  }

  /** Stop listening, learning nothing. */
  cancelLearn(): void {
    if (!this.learner) return;
    this.learner.cancel();
    this.learner = null;
    this.learnOn = null;
    this.changed('setup');
  }

  /** The panel has shown the heard source long enough. */
  clearHeard(): void {
    if (!this.heardNow) return;
    this.heardNow = null;
    this.changed('setup');
  }

  /** Reset performance: every CC value dropped, every mapping re-armed. */
  resetPerformance(): void {
    this.router.resetPerformance();
    this.changed('live');
  }

  /**
   * The document changed from `before`: `opened` for another song (Import,
   * New song, a restore), anything else an edit, an undo or a redo.
   */
  documentChanged(before: ArrangementDocument, opened: boolean): void {
    const doc = this.deps.doc();
    if (opened) {
      this.learner?.cancel();
      this.learner = null;
      this.learnOn = null;
      this.heardNow = null;
      this.heardBy.clear();
      this.router.songOpened(songCcMappings(doc));
    } else {
      this.router.mappingsChanged(songCcMappings(doc));
      const { edited, released } = ccDocumentEvents(before, doc);
      for (const { part, target } of edited) this.router.targetEdited(part, target);
      for (const { part, target } of released) this.router.laneReleased(part, target);
      // A part deleted while learn listens: as Cancel (the record's boundary case).
      if (this.learnOn && !partAt(doc, this.learnOn.part)) this.cancelLearn();
    }
    this.changed('setup');
  }

  /** A new live system stands, holding no CC value: every mapping re-arms. */
  systemBuilt(): void {
    this.router.resetPerformance();
    this.changed('live');
  }

  /** The engine dropped a value on its own (a lane on, a target a new preset lacks, a target gone). */
  dropped(part: number, target: CcTargetId): void {
    this.router.laneReleased(part, target);
    this.changed('live');
  }

  /** Commit `source` onto the target learn listened for, as one song edit. */
  private commitLearned(learning: CcLearning, source: CcSource): void {
    const { part, target } = learning;
    this.learner = null;
    this.learnOn = null;
    const doc = this.deps.doc();
    const row = this.engine.target(part, target)?.row;
    const owner = partAt(doc, part);
    if (!row || !owner) return;
    const list = learnedMappings(owner.ccMappings ?? [], target, source, row);
    if (!this.deps.commit(ccMappingsChange(part, list), CC_EDIT_LABEL)) return;
    this.heardNow = { part, target, source };
  }

  private changed(change: CcSessionChange): void {
    for (const listener of this.listeners) listener(change);
  }
}

/** What `watchDocument` follows: the model's document, its openings and its changes. */
export interface WatchedDocument {
  readonly doc: ArrangementDocument;
  readonly openings: number;
  onChange(listener: () => void): () => void;
}

/**
 * Tell `session` of every change to `model` once it has landed: a song
 * opened (the model's `openings` moved), or an edit, undo or redo from the
 * document before it. Returns the unsubscribe.
 */
export function watchDocument(model: WatchedDocument, session: CcSession): () => void {
  let before = model.doc;
  let openings = model.openings;
  return model.onChange(() => {
    const opened = model.openings !== openings;
    openings = model.openings;
    const was = before;
    before = model.doc;
    session.documentChanged(was, opened);
  });
}
