/**
 * The Roll's Audition (windsor#603 decision 5): with the switch on, a note
 * sounds briefly through the part's patch when it is added and each time a
 * drag moves it to a new pitch, by the keyboard's path (`part.noteOn` on
 * the live part, `host.part`). Never while the transport plays.
 *
 * The switch is one for the console, kept in `localStorage` as the MIDI
 * input is (`midiAccess.ts`), and on until turned off. A storage that
 * throws reads as on and keeps the choice for the session.
 */
import type { AppCtx } from './context';
import { ROLL_AUDITION } from './rollTables';

const OFF = 'off';
const ON = 'on';

/** The switch from what storage holds: on unless it holds `off`. */
export const auditionFrom = (stored: string | null): boolean => stored !== OFF;

/** The session's own copy, for a storage that refuses the write. */
let session: boolean | null = null;

/** Whether Audition is on. */
export function auditionOn(): boolean {
  if (session !== null) return session;
  try {
    return auditionFrom(localStorage.getItem(ROLL_AUDITION.storageKey));
  } catch {
    return true;
  }
}

/** Turn Audition on or off, and keep the choice. */
export function setAudition(on: boolean): void {
  session = on;
  try {
    localStorage.setItem(ROLL_AUDITION.storageKey, on ? ON : OFF);
    session = null;
  } catch {
    // Storage blocked (private window, file:// policy): the choice lasts this session.
  }
}

/** Sound `pitch` briefly on the part on `slot`, when Audition is on and the transport is not playing. */
export function auditionNote(ctx: AppCtx, slot: number, pitch: number, velocity: number): void {
  if (ctx.transport.running || !auditionOn()) return;
  const part = ctx.host.part(slot);
  if (!part) return;
  const id = part.noteOn(pitch, velocity);
  setTimeout(() => part.noteOff(id), ROLL_AUDITION.ms);
}
