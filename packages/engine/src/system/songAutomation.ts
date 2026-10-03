/**
 * The song's automation on the live system (windsor#344, record
 * `2026-10-01-song-automation-lanes` decision 8): the `AutomationPlayer` on
 * the scheduler's transport, finding each lane's target through the
 * resolver over the roster's strips, and every document change that moves
 * what it plays.
 *
 * - **Build.** `begin` subscribes the player before the arrangement player
 *   exists, so it hears every tick before any part's gate; `load`, once the
 *   arrangement player has set the loop, holds every part's lanes where the
 *   transport rests. On an offline context that is time 0, before
 *   `startRendering`: the render's opening values (`render/renderSystem.ts`).
 * - **Apply.** After a partial has landed on the strips: a part removed is
 *   forgotten; a length edit (bars or meter) first refits every part's held
 *   lanes with the document's own fit, so the engine's lanes stay the
 *   document's; a transport edit (tempo, meter, swing, loop, length) or a
 *   patch edit restarts
 *   every lane from now; a part's `automation` replaces its lanes,
 *   normalised as the document normaliser would; a part's insert list
 *   changing drops the lanes of an insert it no longer holds and restarts
 *   the rest, so an insert lane plays or goes inert as its field is read or
 *   not (windsor#345).
 * - **Which inserts.** A part's lanes are normalised against its inserts as
 *   this partial leaves them (`PartStrip.nextInsertSpecs`), never against
 *   the chain still waiting out its fade: an undo that restores an insert and
 *   its lane together keeps the lane. Until its stage exists the lane finds
 *   no target and is inert (`automationResolver.ts`).
 * - **Sequencer lanes** (windsor#488). The automation player passes `seq.`
 *   lanes by; after every partial each part's lanes go to the arrangement
 *   player too (`SeqLaneSink`), whose gates read them on the tick. A part
 *   whose kind changes drops the `seq.` lanes the new kind does not offer,
 *   by the normaliser's own rule, as its document does.
 * - **Rebuild.** A structural insert edit re-wires the chain only once its
 *   fade has landed; the strip's `insertsRebuilt` hook then restarts that
 *   part's lanes from now, on the stages as they now stand (windsor#345).
 */
import { AutomationPlayer } from '../automation/automationPlayer';
import type { AutomationLane } from '../automation/automationLane';
import { songTicks } from '../sequencing/meter';
import type { Scheduler } from '../sequencing/scheduler';
import { FieldNormaliser, isRecord } from '../song/arrangementFields';
import type { Arrangement, MusicPart, SequencerKind } from '../song/arrangement';
import type {
  ArrangementDocument,
  DocumentPart,
  DocumentPartial,
} from '../song/arrangementDocument';
import { normaliseAutomation, withFittedAutomation } from '../song/automationNormalise';
import type { PartStrip } from '../mixer/channelStrip';
import { automationResolver } from './automationResolver';

/** Where a part's lanes go for its region gate to read: the `ArrangementPlayer`. */
export interface SeqLaneSink {
  setLanes(slot: number, lanes: readonly AutomationLane[]): void;
}

/** What `apply` reads of the merged arrangement. */
export type MergedSong = Pick<Arrangement, 'transport' | 'parts'>;

export class SongAutomation {
  private playerValue: AutomationPlayer | null = null;
  private songTicks = 0;

  constructor(
    private readonly scheduler: Scheduler,
    private readonly clock: { readonly currentTime: number },
    private readonly stripOf: (slot: number) => PartStrip | undefined,
  ) {}

  /**
   * Build the player on the transport, and hand it back as what hears the
   * transport stop and seek. Call before the arrangement player subscribes.
   */
  begin(document: ArrangementDocument): AutomationPlayer {
    const { transport } = this.scheduler;
    this.songTicks = songTicks(document.transport.bars, document.transport.meter);
    this.playerValue = new AutomationPlayer({
      transport,
      now: () => this.clock.currentTime,
      resolve: automationResolver(this.stripOf),
      songTicks: this.songTicks,
      restTick: transport.currentTick,
    });
    return this.playerValue;
  }

  /** Hold every part's lanes where the transport rests, now the loop is set. */
  load(document: ArrangementDocument): void {
    const player = this.playerValue;
    if (!player) return;
    player.seek(this.scheduler.transport.currentTick);
    for (const part of document.parts) player.setLanes(part.slot, part.automation ?? []);
  }

  /**
   * A partial that has landed; `merged` reads the merged arrangement: its
   * bars and meter when either changed, the song's length (windsor#429), and
   * a part's sequencer kind when its sequencer or lanes changed. Every part's
   * lanes then go to `gates`, so its sequencer lanes play as these do.
   */
  apply(partial: DocumentPartial, merged: () => MergedSong, gates?: SeqLaneSink): void {
    const player = this.playerValue;
    if (!player) return;
    let song: MergedSong | undefined;
    const read = (): MergedSong => (song ??= merged());
    const kind = (slot: number): SequencerKind | undefined =>
      read().parts.find((p) => p.slot === slot)?.sequencer.kind;
    const parts = isRecord(partial.parts) ? Object.entries(partial.parts) : [];
    for (const [slot, part] of parts) if (part === null) player.removePart(Number(slot));
    const { transport } = partial;
    if (isRecord(transport) && (transport.bars !== undefined || transport.meter !== undefined)) {
      const { bars, meter } = read().transport;
      this.songTicks = songTicks(bars, meter);
      player.setSongTicks(this.songTicks);
      this.refit(player);
    }
    if (partial.transport !== undefined || partial.patches !== undefined) player.resync();
    for (const [key, part] of parts) {
      if (!isRecord(part)) continue;
      const slot = Number(key);
      if ('automation' in part) {
        player.setLanes(slot, this.lanes(slot, part.automation, kind(slot)));
      } else if (
        (isRecord(part.sequencer) && part.sequencer.kind !== undefined) ||
        (isRecord(part.strip) && part.strip.inserts !== undefined)
      ) {
        // A kind change drops the sequencer lanes the new kind does not offer, as the document does.
        this.reinsert(player, slot, kind(slot));
      }
    }
    for (const slot of player.slots()) gates?.setLanes(slot, player.lanesOf(slot));
  }

  /** Restart one part's lanes from now: their targets' params changed. */
  resync(slot: number): void {
    this.playerValue?.resync(slot);
  }

  /**
   * `strip`'s insert chain was re-wired inside its fade (windsor#345): its
   * part's lanes find their inserts' stages again and restart from now, so
   * a reorder, an add or a remove re-attaches the lanes that remain.
   */
  insertsRebuilt(strip: PartStrip): void {
    const player = this.playerValue;
    if (!player) return;
    for (const slot of player.slots()) if (this.stripOf(slot) === strip) player.resync(slot);
  }

  /** The lanes `slot` plays now; none before `begin` or for a part without lanes. */
  lanesOf(slot: number): readonly AutomationLane[] {
    return this.playerValue?.lanesOf(slot) ?? [];
  }

  dispose(): void {
    this.playerValue?.dispose();
    this.playerValue = null;
  }

  /**
   * Every part's held lanes fitted to the new length by the document's own
   * fit (`withFittedAutomation`, as `fitTimelines` runs it), so a song
   * shortened then lengthened plays the cut lanes its document now holds.
   * The read is the fit's own: it takes only `automation` and `strip.inserts`.
   */
  private refit(player: AutomationPlayer): void {
    for (const slot of player.slots()) {
      const lanes = player.lanesOf(slot);
      const inserts = this.stripOf(slot)?.nextInsertSpecs ?? [];
      const part = { automation: lanes, strip: { inserts } } as unknown as MusicPart;
      const fitted = (withFittedAutomation(part, this.songTicks) as Partial<DocumentPart>)
        .automation;
      if (fitted !== undefined && fitted !== lanes) player.setLanes(slot, fitted);
    }
  }

  /**
   * `slot`'s insert list or sequencer changed and its lanes did not come
   * with it: a lane on an insert the list no longer holds, or on a sequencer
   * field its kind does not offer, goes, as the document normaliser deletes
   * it (decision 14, windsor#488), and the rest restart from now.
   */
  private reinsert(player: AutomationPlayer, slot: number, kind: SequencerKind | undefined): void {
    const held = player.lanesOf(slot);
    const kept = this.lanes(slot, held, kind);
    if (kept.length < held.length) player.setLanes(slot, kept);
    else player.resync(slot);
  }

  /**
   * A part's lanes, normalised against its inserts as this partial leaves
   * them, not the chain still fading out, and its sequencer kind; none for
   * null or junk.
   */
  private lanes(
    slot: number,
    raw: unknown,
    kind: SequencerKind | undefined,
  ): readonly AutomationLane[] {
    const strip = this.stripOf(slot);
    if (raw === null || !strip) return [];
    const context = {
      songTicks: this.songTicks,
      inserts: strip.nextInsertSpecs,
      ...(kind === undefined ? {} : { kind }),
      path: `parts.${slot}.automation`,
      n: new FieldNormaliser(),
    };
    return normaliseAutomation(raw, context) ?? [];
  }
}
