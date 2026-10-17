/**
 * Spectre's workbench keys (record `2026-10-17-spectre-drawn-cells`
 * decision 10), pure: what a keydown means while the workbench is open.
 * D P S E M pick a tool; `[` and `]` narrow and widen the brush; 1 2 3 aim the
 * Shape row at a lane; ← and → nudge that lane's cells; Enter applies a
 * previewed shape; Esc drops it, or else closes. A key with Cmd, Ctrl or Alt
 * is the app's (undo, redo), and a key typed into a field is the field's.
 */
import type { SpectreCurve } from '@windsor/engine';
import { SPECTRE_LANES, SPECTRE_TOOLS } from './spectreBenchTables';
import type { SpectreTool } from './spectreBenchTables';

export type SpectreBenchKey =
  | { readonly kind: 'tool'; readonly tool: SpectreTool }
  | { readonly kind: 'width'; readonly by: 1 | -1 }
  | { readonly kind: 'lane'; readonly curve: SpectreCurve }
  | { readonly kind: 'nudge'; readonly by: 1 | -1 }
  | { readonly kind: 'apply' }
  | { readonly kind: 'escape' };

export interface SpectreKeyFacts {
  readonly key: string;
  readonly ctrl: boolean;
  readonly meta: boolean;
  readonly alt: boolean;
  /** Focus is in a text field, a select or a contenteditable element. */
  readonly editing: boolean;
}

/** The action `facts` asks for, or null when the key isn't the workbench's. */
export function benchKeyAction(facts: SpectreKeyFacts): SpectreBenchKey | null {
  if (facts.key === 'Escape') return { kind: 'escape' };
  if (facts.editing || facts.ctrl || facts.meta || facts.alt) return null;
  const key = facts.key.toLowerCase();
  const tool = SPECTRE_TOOLS.find((t) => t.key === key);
  if (tool) return { kind: 'tool', tool: tool.id };
  const lane = SPECTRE_LANES.find((l) => l.key === key);
  if (lane) return { kind: 'lane', curve: lane.curve };
  if (key === '[') return { kind: 'width', by: -1 };
  if (key === ']') return { kind: 'width', by: 1 };
  if (key === 'arrowleft') return { kind: 'nudge', by: -1 };
  if (key === 'arrowright') return { kind: 'nudge', by: 1 };
  if (key === 'enter') return { kind: 'apply' };
  return null;
}

/** The facts of a DOM keydown. */
export function benchKeyFacts(e: KeyboardEvent): SpectreKeyFacts {
  const target = e.target as HTMLElement | null;
  const tag = target?.tagName ?? '';
  return {
    key: e.key,
    ctrl: e.ctrlKey,
    meta: e.metaKey,
    alt: e.altKey,
    editing:
      tag === 'INPUT' ||
      tag === 'TEXTAREA' ||
      tag === 'SELECT' ||
      target?.isContentEditable === true,
  };
}
