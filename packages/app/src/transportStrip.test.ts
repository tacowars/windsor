/**
 * Where the strip lives (#708 decision 5, windsor#11 decision 1), asserted
 * without a DOM: the strip is an element of the header inside the one
 * persistent chrome, outside the tab root, so every tab shows it and no
 * separate strip row exists; the Arrangement tab no longer draws a transport
 * section of its own (#708 decision 3).
 */
import { readFileSync } from 'node:fs';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeElement, fakeEvent, openGestureConsole } from './__fixtures__/gestureConsole';
import { settleGestures } from './gestureHooks';
import { tapHandler } from './transportStrip';
import { TAP_TEMPO } from './transportTables';

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');

/**
 * The strip is persistent chrome when it sits inside the header, itself in
 * the sticky chrome block before the tab root — so no tab panel can hide it —
 * and appears exactly once.
 */
function stripIsChrome(html: string): boolean {
  const chrome = html.indexOf('<div class="chrome">');
  const headerStart = html.indexOf('<header class="head">');
  const headerEnd = html.indexOf('</header>');
  const strip = html.indexOf('id="transportStrip"');
  const tabRoot = html.indexOf('id="tabRoot"');
  return (
    chrome > -1 &&
    chrome < headerStart &&
    headerStart < strip &&
    strip < headerEnd &&
    headerEnd < tabRoot &&
    html.split('id="transportStrip"').length === 2
  );
}

describe('the transport strip in the page', () => {
  const template = read('../index.html');

  it('sits in the header, inside the sticky chrome and outside every tab panel', () => {
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
    const ownRow = template.replace(strip, '').replace('</header>', `</header>${tag}`);
    expect(stripIsChrome(ownRow)).toBe(false);
    expect(stripIsChrome(template.replace(strip, tag + tag))).toBe(false);
  });

  it('is mounted by the composition file, and the Arrangement tab has no transport section', () => {
    expect(read('./main.ts')).toContain("mountTransportStrip(ctx, $('transportStrip'))");
    const arrangement = read('./arrangementTab.ts');
    expect(arrangement).not.toContain("section('Transport'");
  });
});

describe('tap tempo as an undo step (windsor#130)', () => {
  let clock = 0;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('window', new EventTarget());
    clock = 0;
  });
  afterEach(() => {
    settleGestures();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** A tap on the press, then `gapMs` of quiet on the fake clock. */
  function tapThen(onTap: (e: MouseEvent) => void, gapMs: number): void {
    onTap(fakeEvent('pointerdown') as MouseEvent);
    clock += gapMs;
    vi.advanceTimersByTime(gapMs);
  }

  it('makes a sequence of taps one step, and a sequence after the tap window another', () => {
    const ctx = openGestureConsole();
    const start = ctx.model.doc.transport.bpm;
    const onTap = tapHandler(
      ctx,
      new FakeElement(),
      () => {},
      () => clock,
    );
    for (let i = 0; i < 5; i++) tapThen(onTap, 600);
    expect(ctx.model.doc.transport.bpm).toBe(100);
    tapThen(onTap, TAP_TEMPO.resetMs);
    for (let i = 0; i < 4; i++) tapThen(onTap, 400);
    tapThen(onTap, TAP_TEMPO.resetMs);
    expect(ctx.model.doc.transport.bpm).toBe(150);
    expect(ctx.undoLabel).toBe('Tap tempo');
    expect(ctx.undo()).toBe(true);
    expect(ctx.model.doc.transport.bpm).toBe(100);
    expect(ctx.undo()).toBe(true);
    expect(ctx.model.doc.transport.bpm).toBe(start);
    expect(ctx.canUndo).toBe(false);
  });
});
