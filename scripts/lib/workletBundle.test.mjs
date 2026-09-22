import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  bannerFor,
  bundleOptions,
  bundleWorklet,
  REBUILD_COMMAND,
  sourceDirOf,
  WORKLET_DIR,
  WORKLETS,
} from './workletBundle.mjs';

describe('the worklet bundle table', () => {
  it('names an entry that exists and an output under generated/ for every worklet', () => {
    expect(WORKLETS.length).toBeGreaterThan(0);
    for (const worklet of WORKLETS) {
      expect(existsSync(join(WORKLET_DIR, worklet.entry)), worklet.entry).toBe(true);
      expect(worklet.output.startsWith('generated/'), worklet.output).toBe(true);
      expect(sourceDirOf(worklet)).not.toBe('generated');
    }
  });
});

describe('the esbuild options', () => {
  const [fm] = WORKLETS;
  const options = bundleOptions(fm, '/w');

  it('bundle into one module and transform nothing else', () => {
    expect(options.entryPoints).toEqual(['/w/fm/fmProcessor.js']);
    expect(options.bundle).toBe(true);
    expect(options.format).toBe('esm');
    expect(options.target).toBe('esnext');
    expect(options.minify).toBe(false);
    expect(options.treeShaking).toBe(false);
    expect(options.write).toBe(false);
  });

  it('open the output with a banner that names the source folder and the rebuild command', () => {
    const banner = bannerFor(fm);
    expect(options.banner.js).toBe(banner);
    expect(banner).toContain('GENERATED');
    expect(banner).toContain('packages/client/src/audio/worklet/fm/');
    expect(banner).toContain(REBUILD_COMMAND);
    expect(banner).toContain('--check');
  });
});

describe('the committed generated files', () => {
  it.each(WORKLETS.map((w) => [w.name, w]))(
    '%s is a fresh bundle of its source',
    async (_name, worklet) => {
      const text = await bundleWorklet(worklet);
      expect(text).toBe(readFileSync(join(WORKLET_DIR, worklet.output), 'utf8'));
      // A worklet script: the processor registered at top level, and no import left
      // for a blob URL or the harness to fail on.
      expect(text.startsWith(bannerFor(worklet))).toBe(true);
      expect(text).toMatch(/^registerProcessor\(/m);
      expect(text).not.toMatch(/^import\s/m);
    },
  );

  it('refuses a missing entry by name', async () => {
    await expect(
      bundleWorklet({ name: 'x', entry: 'x/x.js', output: 'generated/x.js' }),
    ).rejects.toThrow('x/x.js is missing');
  });
});
