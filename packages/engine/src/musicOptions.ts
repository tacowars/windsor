/**
 * `?music=0` (issue #69, refinement decision 2): suppresses the generative
 * music for dev sessions and harnesses. The audio graph — engine, buses,
 * returns, parts, bindings — is still built; only the transport never starts,
 * so a page stays silent without carving a second code path through the
 * system. Bench mode (`?bench=1`) builds no audio at all and is decided in
 * main.ts, not here.
 */
export function musicEnabledFromQuery(search: string): boolean {
  return new URLSearchParams(search).get('music') !== '0';
}
