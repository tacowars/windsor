/** The whole song's inserts and output level: the document's `master` section (#666). */
import { DEFAULT_MASTER } from '@windsor/engine';
import type { AppCtx } from './context';
import { section } from './dom';
import { makeKnob } from './knob';
import { masterMeter } from './masterMeter';
import { MASTER_LEVEL_KNOB } from './masterTables';
import { stripInserts } from './stripInserts';
export function renderMasterStrip(ctx: AppCtx): HTMLElement {
  const view = section(
    'Master',
    'Tracks and returns → inserts → output level. Stereo sample peaks before the Music fader.',
  );
  view.root.classList.add('master-strip');
  view.body.append(
    stripInserts(ctx, 'master'),
    makeKnob({
      ...MASTER_LEVEL_KNOB,
      get: () => ctx.model.doc.master?.level ?? DEFAULT_MASTER.level,
      set: (level) => void ctx.change({ master: { level } }),
    }),
    masterMeter(ctx),
  );
  return view.root;
}
