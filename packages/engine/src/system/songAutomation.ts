/**
 * The song's automation on the live system (windsor#344, record
 * `2026-10-01-song-automation-lanes` decision 8): the `AutomationPlayer` on
 * the scheduler's transport, finding each lane's target through the
 * resolver over the roster's strips and the group buses, and every document
 * change that moves what it plays.
 *
 * - **Build.** `begin` subscribes the player before the arrangement player
 *   exists, so it hears every tick before any part's gate; `load`, once the
 *   arrangement player has set the loop, holds every part's and group's
 *   lanes where the transport rests. On an offline context that is time 0,
 *   before `startRendering`: the render's opening values
 *   (`render/renderSystem.ts`).
 * - **Apply.** After a partial has landed on the strips: a part removed is
 *   forgotten; a length edit (bars or meter) first refits every owner's held
 *   lanes with the document's own fit, so the engine's lanes stay the
 *   document's; a transport edit (tempo, meter, swing, loop, length) or a
 *   patch edit restarts every lane from now; a part's `automation` replaces
 *   its lanes, normalised as the document normaliser would; a part's insert
 *   list changing drops the lanes of an insert it no longer holds and
 *   restarts the rest, so an insert lane plays or goes inert as its field is
 *   read or not (windsor#345).
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
 * - **Groups** (windsor#614, record `2026-10-05-group-automation-folder-tracks`
 *   decisions 4–7). A group's lanes are keyed by its id and follow the part
 *   rules: a group added gets its lanes held; one removed is forgotten with
 *   its lanes; its `automation` replaces its lanes, normalised against the
 *   group's inserts (`GroupBus.nextInsertSpecs`) with its narrower targets;
 *   its insert list changing drops the lanes of inserts it no longer holds
 *   and restarts the rest; a re-wire restarts them once the fade lands
 *   (`groupInsertsRebuilt`); a length edit refits them. Routing a part in or
 *   out of a group touches none of them. A group has no sequencer, so its
 *   lanes never reach the gates.
 */
import { AutomationPlayer } from '../automation/automationPlayer';
import type { AutomationLane } from '../automation/automationLane';
import type { AutomationOwner } from '../automation/automationOwner';
import { groupOwner, isGroupOwner, partOwner } from '../automation/automationOwner';
import type { InsertSpec } from '../inserts/insertRegistry';
import { songTicks } from '../sequencing/meter';
import type { Scheduler } from '../sequencing/scheduler';
import { FieldNormaliser, isRecord } from '../song/arrangementFields';
import type { Arrangement, SequencerKind } from '../song/arrangement';
import type { ArrangementDocument, DocumentPartial } from '../song/arrangementDocument';
import { fitLanes, normaliseAutomation } from '../song/automationNormalise';
import type { PartStrip } from '../mixer/channelStrip';
import type { GroupBus } from '../mixer/groupBus';
import { automationResolver } from './automationResolver';

/** Where a part's lanes go for its region gate to read: the `ArrangementPlayer`. */
export interface SeqLaneSink {
  setLanes(slot: number, lanes: readonly AutomationLane[]): void;
}

/** What `apply` reads of the merged arrangement. */
export type MergedSong = Pick<Arrangement, 'transport' | 'parts'>;

/** A partial's `parts` or `groups` as its entries, each key read as a number. */
const entriesOf = (section: unknown): [number, unknown][] =>
  isRecord(section) ? Object.entries(section).map(([key, value]) => [Number(key), value]) : [];

export class SongAutomation {
  private playerValue: AutomationPlayer | null = null;
  private songTicks = 0;

  constructor(
    private readonly scheduler: Scheduler,
    private readonly clock: { readonly currentTime: number },
    private readonly stripOf: (slot: number) => PartStrip | undefined,
    private readonly groupOf: (id: number) => GroupBus | undefined = () => undefined,
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
      resolve: automationResolver(this.stripOf, this.groupOf),
      songTicks: this.songTicks,
      restTick: transport.currentTick,
    });
    return this.playerValue;
  }

  /** Hold every part's and every group's lanes where the transport rests, now the loop is set. */
  load(document: ArrangementDocument): void {
    const player = this.playerValue;
    if (!player) return;
    player.seek(this.scheduler.transport.currentTick);
    for (const part of document.parts) player.setLanes(partOwner(part.slot), part.automation ?? []);
    for (const group of document.groups ?? []) {
      player.setLanes(groupOwner(group.id), group.automation ?? []);
    }
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
    const parts = entriesOf(partial.parts);
    const groups = entriesOf(partial.groups);
    for (const [slot, part] of parts) if (part === null) player.remove(partOwner(slot));
    for (const [id, group] of groups) if (group === null) player.remove(groupOwner(id));
    const { transport } = partial;
    if (isRecord(transport) && (transport.bars !== undefined || transport.meter !== undefined)) {
      const { bars, meter } = read().transport;
      this.songTicks = songTicks(bars, meter);
      player.setSongTicks(this.songTicks);
      this.refit(player);
    }
    if (partial.transport !== undefined || partial.patches !== undefined) player.resync();
    for (const [slot, part] of parts) {
      if (!isRecord(part)) continue;
      const owner = partOwner(slot);
      if ('automation' in part) {
        player.setLanes(owner, this.lanes(owner, part.automation, kind(slot)));
      } else if (
        (isRecord(part.sequencer) && part.sequencer.kind !== undefined) ||
        (isRecord(part.strip) && part.strip.inserts !== undefined)
      ) {
        // A kind change drops the sequencer lanes the new kind does not offer, as the document does.
        this.reinsert(player, owner, kind(slot));
      }
    }
    for (const [id, group] of groups) if (isRecord(group)) this.applyGroup(player, id, group);
    for (const owner of player.owners()) {
      if (!isGroupOwner(owner)) gates?.setLanes(owner.part, player.lanesOf(owner));
    }
  }

  /** Restart one owner's lanes from now: their targets' params changed. */
  resync(owner: AutomationOwner): void {
    this.playerValue?.resync(owner);
  }

  /**
   * `strip`'s insert chain was re-wired inside its fade (windsor#345): its
   * part's lanes find their inserts' stages again and restart from now, so
   * a reorder, an add or a remove re-attaches the lanes that remain.
   */
  insertsRebuilt(strip: PartStrip): void {
    const player = this.playerValue;
    if (!player) return;
    for (const owner of player.owners()) {
      if (!isGroupOwner(owner) && this.stripOf(owner.part) === strip) player.resync(owner);
    }
  }

  /** `bus`'s insert chain was re-wired inside its fade: the group's lanes re-attach, as a part's do. */
  groupInsertsRebuilt(bus: GroupBus): void {
    // A bus still fading out after its group was removed is no longer the group's.
    if (this.groupOf(bus.id) === bus) this.playerValue?.resync(groupOwner(bus.id));
  }

  /** The lanes `owner` plays now; none before `begin` or for an owner without lanes. */
  lanesOf(owner: AutomationOwner): readonly AutomationLane[] {
    return this.playerValue?.lanesOf(owner) ?? [];
  }

  dispose(): void {
    this.playerValue?.dispose();
    this.playerValue = null;
  }

  /**
   * A group's entry in a partial, once the groups have landed: its lanes, or
   * its insert list without them. An entry the desk did not land on a live
   * group (one it ignored) is passed by.
   */
  private applyGroup(player: AutomationPlayer, id: number, group: Record<string, unknown>): void {
    if (!this.groupOf(id)) return;
    const owner = groupOwner(id);
    if ('automation' in group) player.setLanes(owner, this.lanes(owner, group.automation));
    else if (group.inserts !== undefined) this.reinsert(player, owner);
  }

  /**
   * Every owner's held lanes fitted to the new length by the document's own
   * fit (`fitLanes`, as `fitTimelines` runs it over a part), so a song
   * shortened then lengthened plays the cut lanes its document now holds.
   */
  private refit(player: AutomationPlayer): void {
    for (const owner of player.owners()) {
      const lanes = player.lanesOf(owner);
      const fitted = fitLanes(lanes, this.insertsOf(owner) ?? [], this.songTicks);
      if (fitted !== lanes) player.setLanes(owner, fitted);
    }
  }

  /**
   * An owner's insert list or a part's sequencer changed and its lanes did
   * not come with it: a lane on an insert the list no longer holds, or on a
   * sequencer field its kind does not offer, goes, as the document
   * normaliser deletes it (decision 14, windsor#488), and the rest restart
   * from now.
   */
  private reinsert(player: AutomationPlayer, owner: AutomationOwner, kind?: SequencerKind): void {
    const held = player.lanesOf(owner);
    const kept = this.lanes(owner, held, kind);
    if (kept.length < held.length) player.setLanes(owner, kept);
    else player.resync(owner);
  }

  /** The inserts an owner's lanes are kept against: the list its chain holds once a fade lands. */
  private insertsOf(owner: AutomationOwner): readonly InsertSpec[] | undefined {
    return isGroupOwner(owner)
      ? this.groupOf(owner.group)?.nextInsertSpecs
      : this.stripOf(owner.part)?.nextInsertSpecs;
  }

  /**
   * An owner's lanes, normalised against its inserts as this partial leaves
   * them, not the chain still fading out, and a part's sequencer kind; none
   * for null or junk, or for an owner the song lacks.
   */
  private lanes(
    owner: AutomationOwner,
    raw: unknown,
    kind?: SequencerKind,
  ): readonly AutomationLane[] {
    const inserts = this.insertsOf(owner);
    if (raw === null || !inserts) return [];
    const group = isGroupOwner(owner);
    const context = {
      songTicks: this.songTicks,
      inserts,
      ...(kind === undefined ? {} : { kind }),
      ...(group ? { owner: 'group' as const } : {}),
      path: group ? `groups.${owner.group}.automation` : `parts.${owner.part}.automation`,
      n: new FieldNormaliser(),
    };
    return normaliseAutomation(raw, context) ?? [];
  }
}
