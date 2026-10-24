/**
 * Step variation's controls on the Grid and Arp devices (windsor#936; record
 * `2026-10-24-step-variation-controls`, the approved mockup
 * `docs/design/step-variation-controls-mockup.html`): the names the console
 * gives the engine's four fields (windsor#935), each control's tooltip, and
 * the two toggles' glyphs, as data. The knobs are `sequencerKnobTables.ts`'s
 * entries under these names, the toggles `stepVariationToggles.ts`, and the
 * Song tab names the two lanes and reads their values from here too.
 */
import type { SeqField, StepVariationConfig } from '@windsor/engine';

/** A step variation amount: what a knob and a lane move. */
export type VariationAmount = 'randomness' | 'probability';
/** A step variation switch: what a glyph button toggles. */
export type VariationSwitch = Exclude<keyof StepVariationConfig, VariationAmount>;

/**
 * The names (decision 1): Vary and Chance on the knobs and their lanes, so
 * neither reads as the Randomize button's amount; the switches' accessible
 * names.
 */
export const STEP_VARIATION_NAMES: Readonly<Record<keyof StepVariationConfig, string>> = {
  randomness: 'Vary',
  probability: 'Chance',
  restsSound: 'Rests sound',
  octaveMode: 'Octave',
};

/** Each control's tooltip, after its name (decision 3 for the switches; the mockup's for the knobs). */
export const STEP_VARIATION_TITLES: Readonly<Record<keyof StepVariationConfig, string>> = {
  randomness:
    'How far a step that varies strays: its velocity, its pitch and, on the Arp, its gate',
  probability: 'How often a step varies; the others play as written',
  restsSound: 'Rests sound: a varied step may also go silent or sound where a rest was written',
  octaveMode:
    "Octave: pitch strays by whole octaves of the step's own note instead of borrowing another step's",
};

/**
 * The switches' glyphs on the app's 12 px icon grid, the mockup's
 * recommended pair: Rests sound is an eighth-rest sign, Octave an 8 with an
 * arrow up and an arrow down.
 */
export const STEP_VARIATION_GLYPHS: Readonly<Record<VariationSwitch, string>> = {
  restsSound:
    '<circle cx="4.6" cy="3.4" r="1.3" fill="currentColor" stroke="none"/><path d="M4.6 4.7c1.7.6 3.1.1 3.9-1.5L5.4 10.5"/>',
  octaveMode:
    '<circle cx="4" cy="3.4" r="1.6"/><circle cx="4" cy="8.3" r="1.9"/><path d="M9.5 1.8v8.4M8 3.3l1.5-1.5L11 3.3M8 8.7l1.5 1.5L11 8.7"/>',
};

/** The switches in the order the devices draw them: Rests sound, then Octave. */
export const VARIATION_SWITCHES: readonly VariationSwitch[] = ['restsSound', 'octaveMode'];

/**
 * The console's name for a sequencer lane's field where it differs from the
 * catalog's (Vary and Chance), so a lane reads as its knob; undefined keeps
 * the catalog's.
 */
export const seqLaneName = (field: SeqField): string | undefined =>
  field === 'randomness' || field === 'probability' ? STEP_VARIATION_NAMES[field] : undefined;

/** The sequencer lanes whose value reads as a percent, as their knob does (the mockup's lane row: 30%). */
export const PERCENT_SEQ_TARGETS: ReadonlySet<string> = new Set([
  'seq.randomness',
  'seq.probability',
]);
