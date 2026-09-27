/**
 * Where the strip lives (#708 decision 5), asserted without a DOM: the
 * template's one persistent chrome holds the header and the strip, outside
 * the tab root, so every tab shows it; the Arrangement tab no longer draws a
 * transport section of its own (decision 3).
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');

/**
 * The strip is persistent chrome when it sits inside the sticky chrome block,
 * after the header and before the tab root — so no tab panel can hide it —
 * and appears exactly once.
 */
function stripIsChrome(html: string): boolean {
  const chrome = html.indexOf('<div class="chrome">');
  const headerEnd = html.indexOf('</header>');
  const strip = html.indexOf('id="transportStrip"');
  const tabRoot = html.indexOf('id="tabRoot"');
  return (
    chrome > -1 &&
    chrome < headerEnd &&
    headerEnd < strip &&
    strip < tabRoot &&
    html.split('id="transportStrip"').length === 2
  );
}

describe('the transport strip in the page', () => {
  const template = read('../index.html');

  it('sits under the header, inside the sticky chrome and outside every tab panel', () => {
    expect(stripIsChrome(template)).toBe(true);
  });

  it('negative: a strip moved into the tab root, missing, or doubled is not chrome', () => {
    const strip = /<section class="transport-strip"[^>]*><\/section>/;
    const tag = strip.exec(template)?.[0] ?? '';
    expect(tag).not.toBe('');
    const moved = template
      .replace(strip, '')
      .replace('id="tabRoot"></main>', `id="tabRoot">${tag}</main>`);
    expect(stripIsChrome(moved)).toBe(false);
    expect(stripIsChrome(template.replace(strip, ''))).toBe(false);
    expect(stripIsChrome(template.replace(strip, tag + tag))).toBe(false);
  });

  it('is mounted by the composition file, and the Arrangement tab has no transport section', () => {
    expect(read('./main.ts')).toContain("mountTransportStrip(ctx, $('transportStrip'))");
    const arrangement = read('./arrangementTab.ts');
    expect(arrangement).not.toContain("section('Transport'");
    expect(arrangement).not.toContain('toggleMute');
  });
});
