/**
 * The MIDI CC wiring (windsor#784, record `2026-10-13-midi-cc-mapping`): one
 * `CcSession` over the document and the engine host, heard by the MIDI
 * connection, the document and the host, and the one `CcPanel` over it, set
 * as the panel's ways in (`ccPanelEntry.ts`). `main.ts` calls it once.
 *
 * - **MIDI.** `midiAccess.ts` hands each `cc` event, with its input's name
 *   and channel, to the session, and tells it of each input it listens to
 *   again.
 * - **The document.** Every open, edit, undo and redo, after it landed:
 *   a different song (the model's `openings` moved) or an edit from the
 *   document before it.
 * - **The host.** A value the live system dropped on its own, and each new
 *   system, which holds none.
 */
import { CcPanel } from './ccPanel';
import { setCcPanelEntry } from './ccPanelEntry';
import { CcSession, watchDocument } from './ccPanelSession';
import { readTakeover } from './ccTakeover';
import type { AppCtx } from './context';
import type { MidiAccessor } from './midiAccess';

/** Build the console's CC session and panel, and wire them in. */
export function mountCcPanel(ctx: AppCtx, midi: MidiAccessor): CcPanel {
  const session = new CcSession({
    doc: () => ctx.model.doc,
    host: ctx.host,
    commit: (partial, label) => ctx.change(partial, label).ok,
    takeover: readTakeover(),
  });
  midi.cc = session;
  ctx.host.performanceDropped = (slot, target): void => session.dropped(slot, target);
  ctx.host.systemBuilt = (): void => session.systemBuilt();
  watchDocument(ctx.model, session);
  const panel = new CcPanel(ctx, session, midi);
  setCcPanelEntry(panel);
  return panel;
}
