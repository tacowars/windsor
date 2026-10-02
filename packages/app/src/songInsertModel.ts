/**
 * The Song pane's insert panel (windsor#156), the part that needs no DOM:
 * the header's count, and the context its insert chain edits through.
 *
 * The chain is the Mixer tab's own (`stripInserts.ts` and the insert cards),
 * which commit with a bare `ctx.change` — right on the Mixer tab, where the
 * strip being edited is on screen. From the Song tab that leaves the Mixer
 * tab drawn from the old document (`ctx.change` marks no tab stale), so the
 * panel hands the chain `songPaneCtx`: the same context, whose `change` also
 * calls `ctx.invalidate()` and tells the panel its own edit landed.
 */
import type { AppCtx } from './context';

/** "No inserts", "1 insert", "2 inserts". */
export function insertCountLabel(count: number): string {
  if (count === 0) return 'No inserts';
  return `${count} insert${count === 1 ? '' : 's'}`;
}

/**
 * `ctx` with a `change` that, when it takes, marks the other tabs stale and
 * calls `edited` — the Song pane's insert chain's context. Everything else is
 * `ctx`'s own, read at each call.
 */
export function songPaneCtx(ctx: AppCtx, edited: () => void): AppCtx {
  return {
    get host() {
      return ctx.host;
    },
    get model() {
      return ctx.model;
    },
    get parts() {
      return ctx.parts;
    },
    get transport() {
      return ctx.transport;
    },
    change(partial) {
      const result = ctx.change(partial);
      if (result.ok) {
        ctx.invalidate();
        edited();
      }
      return result;
    },
    get songs() {
      return ctx.songs;
    },
    importDoc: (raw, fileName) => ctx.importDoc(raw, fileName),
    render: () => ctx.render(),
    refreshTabs: () => ctx.refreshTabs(),
    invalidate: () => ctx.invalidate(),
    onTabShown: (id, listener) => ctx.onTabShown(id, listener),
    notify: (message, tone) => ctx.notify(message, tone),
  };
}
