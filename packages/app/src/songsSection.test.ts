/**
 * The Songs section's save path (windsor#458): whether the write stores or
 * fails, focus ends on the strip's button as drawn now, never on the page.
 */
import { describe, expect, it } from 'vitest';
import { settleSave } from './songsSection';

function strip() {
  const calls: string[] = [];
  return {
    calls,
    update: (): void => void calls.push('update'),
    focusAction: (): void => void calls.push('focus'),
  };
}

describe('the section’s save path', () => {
  it('focuses the strip action after a failed Save as… whose edit redrew the strip', async () => {
    // The write rejected, but the name and tags had already gone onto the song.
    const s = strip();
    let notified = false;
    await settleSave(Promise.resolve(null), { opener: { isConnected: false }, strip: s }, () => {
      notified = true;
    });
    expect(notified).toBe(false);
    expect(s.calls).toEqual(['update', 'focus']);
  });

  it('reports a stored save and focuses the replacement button', async () => {
    const s = strip();
    let notified = false;
    await settleSave(Promise.resolve('id'), { opener: { isConnected: false }, strip: s }, () => {
      notified = true;
    });
    expect(notified).toBe(true);
    expect(s.calls).toEqual(['update', 'focus']);
  });

  it('leaves focus alone while the opener is still in the page', async () => {
    const s = strip();
    await settleSave(Promise.resolve(null), { opener: { isConnected: true }, strip: s }, () => {});
    expect(s.calls).toEqual([]);
  });
});
