/**
 * Reads V8's `--trace-generalization` output for the representation changes
 * one script caused (windsor#198). V8 prints each generalisation as
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
 */
const MARKER = '[generalizing]';
const PAIR = /([a-z])\{[^{}[\]\n]*\}->([a-z])\{/g;
const LOCATION = / at ([^\s:[\]]+(?::[^\s:[\]]+)*):\d+\]/g;

/** Each record that changed a field's representation, attributed to `script` or to no script. */
export function representationChanges(output: string, script: string): string[] {
  const changes: string[] = [];
  for (const piece of output.split(MARKER).slice(1)) {
    const record = piece.trim();
    const changed = [...record.matchAll(PAIR)].some(([, from, to]) => from !== 'v' && from !== to);
    if (!changed) continue;
    const scripts = [...record.matchAll(LOCATION)].map((m) => m[1]);
    if (scripts.length === 0 || scripts.includes(script)) changes.push(`${MARKER}${record}`);
  }
  return changes;
}
