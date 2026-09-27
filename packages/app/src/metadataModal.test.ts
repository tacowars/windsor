/**
 * The metadata modal's loudness line (#617). The offline render is started by
 * Save or Copy to new *before* the dialog opens and takes seconds to answer,
 * so the line has to belong to the open that asked for it: cancel, reopen on
 * another patch inside that window, and the first render used to land its peak
 * under the second patch's title. The dialog itself is DOM; the rule that
 * decides whether a resolution may still write is not, and that is what is
 * driven here, through the same helper the modal wires its `.then` to.
 */
import { describe, expect, it } from 'vitest';

import { claimLoudnessLine } from './metadataModal';

describe('claimLoudnessLine', () => {
  it('lets the current open write', () => {
    const lines: string[] = [];
    claimLoudnessLine((line) => void lines.push(line))('peak -3.0 dBFS');
    expect(lines).toEqual(['peak -3.0 dBFS']);
  });

  it('drops a resolution from an open that has since been superseded', () => {
    const first: string[] = [];
    const second: string[] = [];
    // Save on patch A: the render starts, the modal opens, Cancel.
    const showA = claimLoudnessLine((line) => void first.push(line));
    // Save on patch B while A's render is still running.
    const showB = claimLoudnessLine((line) => void second.push(line));

    showA("A's peak");
    expect(first).toEqual([]);
    showB("B's peak");
    expect(second).toEqual(["B's peak"]);
    // Late is still late, however long A took.
    showA("A's peak, at last");
    expect(first).toEqual([]);
  });

  it('keeps a failed render of an old open off the new one too', () => {
    const first: string[] = [];
    const showA = claimLoudnessLine((line) => void first.push(line));
    claimLoudnessLine(() => undefined);
    showA('Loudness check unavailable: boom');
    expect(first).toEqual([]);
  });

  it('reclaims the line for each fresh open', () => {
    const seen: string[] = [];
    const write = (line: string): void => void seen.push(line);
    claimLoudnessLine(write)('one');
    claimLoudnessLine(write)('two');
    claimLoudnessLine(write)('three');
    expect(seen).toEqual(['one', 'two', 'three']);
  });
});
