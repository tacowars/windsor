/**
 * Each part's colour (windsor#641, record `2026-10-07-part-colours`
 * decisions 1–3): an index into the part palette, which the app holds. The
 * engine knows only its size, `PART_COLOURS`.
 *
 * The parts pass reads each part's raw `colour`; once the whole list is
 * known, `colourParts` keeps every valid one and assigns the rest, reporting
 * a value that was there but wrong. An absent colour is not damage — a song
 * written before the field carries none — so it is filled without a word.
 */
import { PART_COLOURS } from '../audioConstants';
import { show } from './arrangementFields';

/** True when `raw` is a palette index a part may keep: an integer from 0 to `count - 1`. */
export function isPartColour(raw: unknown, count = PART_COLOURS): raw is number {
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw < count;
}

/**
 * Every part's colour, in list order (decision 2). A valid colour is kept,
 * duplicates included. The valid ones are counted first; then each other
 * part, in list order, takes the index the song's parts use least so far,
 * ties going to the lowest. A song with no colours runs down the palette,
 * and round again past its end.
 */
export function assignPartColours(colours: readonly unknown[], count = PART_COLOURS): number[] {
  const uses = new Array<number>(count).fill(0);
  const use = (colour: number): number => {
    uses[colour] = (uses[colour] ?? 0) + 1;
    return colour;
  };
  for (const colour of colours) if (isPartColour(colour, count)) use(colour);
  return colours.map((colour) =>
    isPartColour(colour, count) ? colour : use(uses.indexOf(Math.min(...uses))),
  );
}

/** A part as the parts pass read it: everything but its colour, and the colour's raw value. */
export interface UncolouredPart<P> {
  readonly part: P;
  readonly path: string;
  readonly colour: unknown;
}

/**
 * The parts with their colours assigned. A colour that was present but not
 * a palette index is reported with the one it was given.
 */
export function colourParts<P extends object>(
  entries: readonly UncolouredPart<P>[],
  n: { correction(message: string): void },
): { part: P & { readonly colour: number }; path: string }[] {
  const colours = assignPartColours(entries.map((entry) => entry.colour));
  return entries.map(({ part, path, colour: raw }, i) => {
    const colour = colours[i] ?? 0;
    if (raw !== undefined && !isPartColour(raw)) {
      n.correction(
        `${path}.colour: ${show(raw)} is not a part colour 0–${PART_COLOURS - 1} — assigned ${colour}`,
      );
    }
    return { part: { ...part, colour }, path };
  });
}
