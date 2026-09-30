/** Audible output switches live without touching the post-FX detector signal. */
import type { StripOutput } from './songMixerModel';

/**
 * What each Output reads as in the Song tab's 40 px mixer rows
 * (windsor#158), whose header says OUT.
 */
const OUTPUT_TEXT: Readonly<Record<StripOutput, string>> = {
  master: 'Master',
  sidechain: 'Sidechain',
};

export interface OutputSelectSpec {
  /** The select's `aria-label`. */
  readonly label: string;
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
  select.add(new Option(OUTPUT_TEXT.master, 'master'));
  select.add(new Option(OUTPUT_TEXT.sidechain, 'sidechain'));
  const sync = (): void => {
    select.value = spec.get();
  };
  select.onchange = (): void => {
    const output = select.value === 'sidechain' ? 'sidechain' : 'master';
    if (!spec.set(output)) sync();
  };
  sync();
  return { select, sync };
}
