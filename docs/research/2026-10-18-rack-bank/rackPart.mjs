/**
 * A rack in a song as the console puts it there (windsor#878): the song
 * opened in the app's `DocumentModel`, the rack added as a new part by the
 * app's own `addPartFromRackChange` (record `2026-10-17-racks` decision 12),
 * an external key re-picked as the user would after the load (decision 3:
 * the listen song's muted kick on slot 0), and the part's velocity set to 1.
 */
import { isKeyedSpec, partAt } from '../../../packages/engine/src/index.ts';
import { RACK_BANK } from '../../../packages/engine/src/rack/rackBank.ts';
import { AutoCopies } from '../../../packages/app/src/autoCopies.ts';
import { DocumentModel } from '../../../packages/app/src/documentModel.ts';
import { pageLibrary } from '../../../packages/app/src/libraryModel.ts';
import { addPartFromRackChange } from '../../../packages/app/src/rackActions.ts';

/** The listen song's muted kick: the key a rack's external sidechain is re-picked to. */
const KEY_SLOT = 0;

/** A disconnected external key on `spec` (or its slot child) re-picked to the key slot. */
function rekeyed(spec) {
  const own =
    isKeyedSpec(spec) && typeof spec.sidechain === 'object' && spec.sidechain.track === null
      ? { ...spec, sidechain: { track: KEY_SLOT } }
      : spec;
  return own.slot ? { ...own, slot: rekeyed(own.slot) } : own;
}

/**
 * `song` with rack `id` added as a part, its key re-picked and its velocity
 * 1; `bare` empties its chain after the load (the economy's baseline).
 */
export function withRack(song, id, bare = false) {
  const model = new DocumentModel(song);
  const ref = { id, file: RACK_BANK[id] };
  const added = addPartFromRackChange(
    model.doc,
    (raw) => model.preview(raw),
    ref,
    pageLibrary(),
    new AutoCopies(),
  );
  if (!added) throw Error(`${id}: the song is full`);
  model.merge(added.partial);
  const { slot } = added;
  const inserts = bare ? [] : partAt(model.doc, slot).strip.inserts.map(rekeyed);
  model.merge({ parts: { [slot]: { velocity: 1, strip: { inserts } } } });
  return { doc: model.doc, slot };
}
