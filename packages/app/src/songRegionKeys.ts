/**
 * The Song view's region keys on the page (record
 * `2026-10-06-song-region-move-copy-paste`): `regionKeys.ts` decides which
 * key it is, `regionClipboard.ts` what it does to the part's regions, and
 * this file reads the selection, commits through `view.commit` (one
 * `ctx.change`, so one undo takes it back) and selects what the edit left.
 * The clip is the view's, kept for the session in `SongViewState`. A paste
 * lands on the selected part's lane at the playhead's bar, and a stopped or
 * paused playhead then moves to its end, so the next paste follows it the
 * way a DAW's insert marker does. A held Delete or Cut acts once.
 */
import type { MusicPart, PartRegion } from '@windsor/engine';
import { partAt } from '@windsor/engine';
import type { RegionKeyAction } from './regionKeys';
import { regionKeyAction, regionKeyFacts } from './regionKeys';
import { copyRegion, cutRegion, duplicateRegion, pasteRegion, pasteTick } from './regionClipboard';
import { deleteRegion } from './regionModel';
import type { SongView } from './songTab';

/** The part the view has selected, and its selected region (null with none). */
interface Target {
  readonly part: MusicPart;
  readonly region: number | null;
}

function targetOf(view: SongView): Target | null {
  const selection = view.state.selection;
  if (selection?.kind !== 'part') return null;
  const part = partAt(view.ctx.model.doc, selection.slot);
  if (!part) return null;
  const region =
    selection.region !== null && part.regions[selection.region] ? selection.region : null;
  return { part, region };
}

/** Commit `regions` to the part on `slot` and select `index` in them; false when refused. */
function write(
  view: SongView,
  slot: number,
  regions: readonly PartRegion[],
  index: number | null,
): boolean {
  if (!view.commit({ parts: { [slot]: { regions: [...regions] } } })) return false;
  view.select({ kind: 'part', slot, region: index });
  return true;
}

/** Paste the view's clip on the target's lane at the playhead's bar; true when the key was ours. */
function paste(view: SongView, target: Target): boolean {
  const { ctx, state } = view;
  const clip = state.clipboard;
  if (!clip) {
    ctx.notify('nothing to paste — copy a region first (Cmd/Ctrl+C)', 'info');
    return true;
  }
  const songTicks = view.songTicks();
  const start = pasteTick(ctx.transport.position(), songTicks, view.ticksPerBar());
  const placed = pasteRegion(target.part, clip, start, songTicks);
  if ('refused' in placed) {
    ctx.notify(placed.refused, 'warning');
    return true;
  }
  if (!write(view, target.part.slot, placed.regions, placed.index)) return true;
  const region = placed.regions[placed.index];
  const end = region ? region.start + region.duration : songTicks;
  if (end < songTicks && ctx.transport.state !== 'playing') ctx.transport.seek(end);
  return true;
}

/** Act on `action` for the view's selection; true when the key was ours. */
function act(view: SongView, action: Exclude<RegionKeyAction, null>, repeat: boolean): boolean {
  const target = targetOf(view);
  if (!target) return false;
  if (action === 'paste') return paste(view, target);
  const { part, region } = target;
  if (region === null) return false;
  if ((action === 'delete' || action === 'cut') && repeat) return true;
  const { slot } = part;
  switch (action) {
    case 'copy': {
      const clip = copyRegion(part, region);
      if (clip) view.state.clipboard = clip;
      return true;
    }
    case 'cut': {
      const cut = cutRegion(part, region);
      if (cut && write(view, slot, cut.regions, null)) view.state.clipboard = cut.clip;
      return true;
    }
    case 'duplicate': {
      const placed = duplicateRegion(part, region, view.songTicks());
      if (placed) write(view, slot, placed.regions, placed.index);
      return true;
    }
    case 'delete':
      write(view, slot, deleteRegion(part.regions, region), null);
      return true;
  }
}

/**
 * Listen on the document while `body`, the Song tab's, is shown: the keys
 * act on `current()`, the view of the latest render. Wired once per tab,
 * since the tab's body outlives its renders. A key that acts is swallowed,
 * so the browser neither copies nor bookmarks and the audition keyboard
 * (on `window`, after `document`) never hears it.
 */
export function wireRegionKeys(body: HTMLElement, current: () => SongView | null): void {
  document.addEventListener('keydown', (e) => {
    const view = current();
    if (!view || !body.isConnected || body.closest('[hidden]') !== null) return;
    const action = regionKeyAction(regionKeyFacts(e));
    if (action === null || !act(view, action, e.repeat)) return;
    e.preventDefault();
    e.stopPropagation();
  });
}
