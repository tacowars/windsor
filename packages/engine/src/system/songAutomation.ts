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
 *   forgotten; a transport edit (tempo, swing, loop, length) or a patch edit
 *   restarts every lane from now; a part's `automation` replaces its lanes,
 *   normalised against its live inserts as the document normaliser would; a
 *   part's insert list changing restarts its lanes, so an insert lane finds
 *   its rebuilt stage.
 */
import { AutomationPlayer } from '../automation/automationPlayer';
import type { AutomationLane } from '../automation/automationLane';
import { TICKS_PER_BAR, type Scheduler } from '../sequencing/scheduler';
import { FieldNormaliser, isRecord } from '../song/arrangementFields';
import type { ArrangementDocument, DocumentPartial } from '../song/arrangementDocument';
import { normaliseAutomation } from '../song/automationNormalise';
import type { PartStrip } from '../mixer/channelStrip';
import { automationResolver } from './automationResolver';

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
    this.songTicks = document.transport.bars * TICKS_PER_BAR;
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

  /** A partial that has landed; `bars` reads the merged song length when it changed. */
  apply(partial: DocumentPartial, bars: () => number): void {
    const player = this.playerValue;
    if (!player) return;
    const parts = isRecord(partial.parts) ? Object.entries(partial.parts) : [];
    for (const [slot, part] of parts) if (part === null) player.removePart(Number(slot));
    if (isRecord(partial.transport) && partial.transport.bars !== undefined) {
      this.songTicks = bars() * TICKS_PER_BAR;
      player.setSongTicks(this.songTicks);
    }
    if (partial.transport !== undefined || partial.patches !== undefined) player.resync();
    for (const [key, part] of parts) {
      if (!isRecord(part)) continue;
      const slot = Number(key);
      if ('automation' in part) player.setLanes(slot, this.lanes(slot, part.automation));
      else if (isRecord(part.strip) && part.strip.inserts !== undefined) player.resync(slot);
    }
  }

  dispose(): void {
    this.playerValue?.dispose();
    this.playerValue = null;
  }

  /** A part's lanes from a partial, normalised against its live inserts; none for null or junk. */
  private lanes(slot: number, raw: unknown): readonly AutomationLane[] {
    const strip = this.stripOf(slot);
    if (raw === null || !strip) return [];
    const context = {
      songTicks: this.songTicks,
      inserts: strip.insertSpecs,
      path: `parts.${slot}.automation`,
      n: new FieldNormaliser(),
    };
    return normaliseAutomation(raw, context) ?? [];
  }
}
