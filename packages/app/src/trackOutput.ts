/**
 * The Output select: Master, then the song's groups by name in list order
 * (windsor#287), then Sidechain. Audible output switches live without
 * touching the post-FX detector signal. A group's option value is its key
 * (`group:3`, `groupModel.ts`), so it never collides with `master` or
 * `sidechain`; the options are read when the select is drawn, so a rename or
 * a removal shows the next time the Song tab draws its cells.
 */
import type { GroupSpec } from '@windsor/engine';
import { groupKey, outputOfValue, outputValue } from './groupModel';
import type { StripOutput } from './songMixerModel';

/**
 * What Master and Sidechain read as in the Song tab's 40 px mixer rows
 * (windsor#158), whose header says OUT. A group reads as its name.
 */
const MASTER_TEXT = 'Master';
const SIDECHAIN_TEXT = 'Sidechain';

export interface OutputSelectSpec {
  /** The select's `aria-label`. */
  readonly label: string;
  /** The song's groups, in list order, offered between Master and Sidechain. */
  readonly groups: readonly Pick<GroupSpec, 'id' | 'name'>[];
  get(): StripOutput;
  /** Write the choice; false when refused, and the select reverts. */
  set(output: StripOutput): boolean;
}

/** The Output select alone, with a `sync` that re-reads it from `get`. */
export function outputSelect(spec: OutputSelectSpec): {
  select: HTMLSelectElement;
  sync: () => void;
} {
  const select = document.createElement('select');
  select.className = 'field compact';
  select.setAttribute('aria-label', spec.label);
  select.add(new Option(MASTER_TEXT, 'master'));
  for (const group of spec.groups) select.add(new Option(group.name, groupKey(group.id)));
  select.add(new Option(SIDECHAIN_TEXT, 'sidechain'));
  const sync = (): void => {
    select.value = outputValue(spec.get());
  };
  select.onchange = (): void => {
    if (!spec.set(outputOfValue(select.value))) sync();
  };
  sync();
  return { select, sync };
}
