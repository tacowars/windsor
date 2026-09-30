/** Audible output switches live without touching the post-FX detector signal. */
import { partAt } from '@windsor/engine';
import { type AppCtx, partChange } from './context';
import { el } from './dom';
import type { StripOutput } from './songMixerModel';

/**
 * What each Output reads as: the Mixer tab's words, and the Song tab's
 * compact ones for its 40 px mixer rows (windsor#158), whose header says OUT.
 */
const OUTPUT_TEXT: Readonly<Record<'full' | 'compact', Readonly<Record<StripOutput, string>>>> = {
  full: { master: 'Master', sidechain: 'Sidechain only' },
  compact: { master: 'Master', sidechain: 'Sidechain' },
};

export interface OutputSelectSpec {
  /** The select's `aria-label`. */
  readonly label: string;
  /** The Song tab's short words and narrow select (windsor#158). */
  readonly compact?: boolean;
  get(): StripOutput;
  /** Write the choice; false when refused, and the select reverts. */
  set(output: StripOutput): boolean;
}

/** The Output select alone, with a `sync` that re-reads it from `get`. */
export function outputSelect(spec: OutputSelectSpec): {
  select: HTMLSelectElement;
  sync: () => void;
} {
  const text = OUTPUT_TEXT[spec.compact === true ? 'compact' : 'full'];
  const select = document.createElement('select');
  select.className = spec.compact === true ? 'field compact' : 'field';
  select.setAttribute('aria-label', spec.label);
  select.add(new Option(text.master, 'master'));
  select.add(new Option(text.sidechain, 'sidechain'));
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

export function trackOutput(ctx: AppCtx, slot: number): HTMLElement {
  const wrap = el('label', 'field-wrap', 'Output');
  const { select } = outputSelect({
    label: `Output slot ${slot}`,
    get: () => partAt(ctx.model.doc, slot)?.strip.output ?? 'master',
    set: (output) => ctx.change(partChange(slot, { strip: { output } })).ok,
  });
  wrap.appendChild(select);
  return wrap;
}
