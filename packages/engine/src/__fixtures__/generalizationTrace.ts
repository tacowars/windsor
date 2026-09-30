/**
 * Reads V8's `--trace-generalization` output for the representation changes
 * one script caused (windsor#198, windsor#214). V8 prints each generalisation as
 *
 *   `[generalizing]fade:s{Any;mutable}->d{Any;mutable} (reason) [~step+39 at eq-processor.js:559]`
 *
 * but a record is written in several pieces, and on Linux CI two records have
 * arrived interleaved in one line (`[generalizing]type:s{ at eq-processor.js:446[generalizing]freq:d{…`),
 * so nothing here trusts a line to hold one whole record:
 *
 * - The output is cut into records at each `[generalizing]` marker, wherever
 *   it falls, not at line starts.
 * - A representation pair is `x{…}->y{`, with no brace, bracket or line break
 *   inside the braces, so a pair cut by a foreign piece never reads as one
 *   (the cut record's own pieces fail to match rather than borrow a side).
 * - A change is a pair whose sides differ (`s`, `d`, `h`, `t`) and whose old
 *   side is not `v`, which is a field's first write, its birth. Constness
 *   (`const` to `mutable`) and field-type changes keep the representation and
 *   are not changes.
 * - A change counts when its record names the script, or names no script at
 *   all (a record whose location was cut off is counted, not guessed away).
 *   Only a record that names another script (Node's own) is left out.
 * - A pair cut in two leaves a head (`x{` that never reaches its `}->`) in
 *   one piece and a tail (`}->y{` with no `x{` of its own) in another. The
 *   halves cannot be matched to each other, and neither names its script
 *   for certain, so a cut pair is a failure unless every way of joining the
 *   heads to the tails keeps the representation: each head is a birth (`v`)
 *   or has the one side every tail has. A head or tail with no counterpart
 *   is a failure too.
 */
const MARKER = '[generalizing]';
const PAIR = /([a-z])\{[^{}[\]\n]*\}->([a-z])\{/g;
const TAIL = /\}->([a-z])\{/g;
const HEAD = /([a-z])\{/g;
const LOCATION = / at ([^\s:[\]]+(?::[^\s:[\]]+)*):\d+\]/g;

interface CutPairs {
  heads: string[];
  tails: string[];
}

/** The sides of the pairs cut in two, from every record's leftovers once its whole pairs are gone. */
function cutPairs(records: string[]): CutPairs {
  const heads: string[] = [];
  const tails: string[] = [];
  for (const record of records) {
    const rest = record.replace(PAIR, ' ');
    for (const [, side] of rest.matchAll(TAIL)) tails.push(side!);
    for (const [, side] of rest.replace(TAIL, ' ').matchAll(HEAD)) heads.push(side!);
  }
  return { heads, tails };
}

/** A description of the cut pairs that could hide a change, or none. */
function unsafeCut({ heads, tails }: CutPairs): string | null {
  if (heads.length === 0 && tails.length === 0) return null;
  const kept =
    heads.length > 0 &&
    tails.length > 0 &&
    heads.every((head) => head === 'v' || tails.every((tail) => tail === head));
  return kept ? null : `${MARKER}(cut pairs) heads ${heads.join(',')} tails ${tails.join(',')}`;
}

/** Each record that changed a field's representation, attributed to `script` or to no script. */
export function representationChanges(output: string, script: string): string[] {
  const changes: string[] = [];
  const records = output
    .split(MARKER)
    .slice(1)
    .map((piece) => piece.trim());
  for (const record of records) {
    const changed = [...record.matchAll(PAIR)].some(([, from, to]) => from !== 'v' && from !== to);
    if (!changed) continue;
    const scripts = [...record.matchAll(LOCATION)].map((m) => m[1]);
    if (scripts.length === 0 || scripts.includes(script)) changes.push(`${MARKER}${record}`);
  }
  const cut = unsafeCut(cutPairs(records));
  if (cut) changes.push(cut);
  return changes;
}
