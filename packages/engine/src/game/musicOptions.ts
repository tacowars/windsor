/**
 * The `?music=` dial (issue #69, refinement decision 2; #435):
 *
 * - `?music=0` suppresses the generative music for dev sessions and
 *   harnesses. The audio graph — engine, buses, returns, parts, bindings — is
 *   still built; only the transport never starts, so a page stays silent
 *   without carving a second code path through the system.
 * - `?music=<name>` plays the committed `arrangements/<name>.json` instead of
 *   the default, so a console export can be auditioned by dropping it in the
 *   folder and naming it here. `1` keeps the default.
 *
 * Bench mode (`?bench=1`) builds no audio at all and is decided in main.ts,
 * not here. DOM-free: the tests and the e2e harness read the parsing alone.
 */
export function musicEnabledFromQuery(search: string): boolean {
  return new URLSearchParams(search).get('music') !== '0';
}

/** The document name `?music=` asks for, or `null` for the default (absent, `0`, `1`). */
export function musicDocumentFromQuery(search: string): string | null {
  const value = new URLSearchParams(search).get('music');
  if (value === null || value === '' || value === '0' || value === '1') return null;
  return value;
}
