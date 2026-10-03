// reads-by-path: {packages/*/{src,lib},scripts/lib}/**
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { URL, fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { READ_BY_PATH, SCANNED_BY } from '../../vitest.config.ts';
import { checkTestInputs, importedModules, parseMarker, readCallsIn } from './testInputs.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SOURCE = /\.(ts|mjs)$/;

/** Every `.ts` / `.mjs` file under vitest's include roots, repo-relative. */
function sourceFiles() {
  const packages = readdirSync(join(ROOT, 'packages'));
  const roots = [
    ...packages.flatMap((p) => [`packages/${p}/src`, `packages/${p}/lib`]),
    'scripts/lib',
  ];
  return roots.flatMap((root) => {
    let names;
    try {
      names = readdirSync(join(ROOT, root), { recursive: true });
    } catch {
      return [];
    }
    return names
      .filter((name) => SOURCE.test(name) && !name.split('/').includes('node_modules'))
      .map((name) => {
        const path = relative(ROOT, join(ROOT, root, name));
        return { path, text: readFileSync(join(ROOT, path), 'utf8') };
      });
  });
}

describe('test inputs read by path', () => {
  it('every reader declares its inputs, and CI watches each one', () => {
    const files = sourceFiles();
    expect(files.length).toBeGreaterThan(100);
    const problems = checkTestInputs({ files, readByPath: READ_BY_PATH, scannedBy: SCANNED_BY });
    expect(problems).toEqual([]);
  });
});

describe('checkTestInputs', () => {
  const readByPath = ['fixtures/**'];
  const scannedBy = [['src/*.css', ['src/a.test.ts']]];
  const run = (files) => checkTestInputs({ files, readByPath, scannedBy: [...scannedBy] });
  const reader = "import { readFileSync } from 'node:fs';\nreadFileSync(x);\n";
  const marked = (globs) => `// reads-by-path: ${globs}\n${reader}`;
  const listedTest = { path: 'src/a.test.ts', text: '' };

  it('passes declared readers, and a build that is not esbuild', () => {
    const files = [
      { path: 'src/a.test.ts', text: marked('src/*.css, fixtures/**') },
      { path: 'src/b.ts', text: marked('none (reads what its caller passes)') },
      { path: 'src/c.ts', text: 'host.build();\n' },
    ];
    expect(run(files)).toEqual([]);
  });

  it('fails a reader without a marker, and an unknown glob', () => {
    expect(run([listedTest, { path: 'src/b.ts', text: reader }])).toEqual([
      'src/b.ts: reads by path (readFileSync) but has no reads-by-path marker',
    ]);
    expect(run([listedTest, { path: 'src/b.ts', text: marked('docs/**') }])).toEqual([
      'src/b.ts: "docs/**" is neither a READ_BY_PATH entry nor a SCANNED_BY glob',
    ]);
  });

  it('fails a scanning test, or an importer of a scanning module, that SCANNED_BY misses', () => {
    const files = [
      listedTest,
      { path: 'src/b.test.ts', text: marked('src/*.css') },
      { path: 'src/sheet.ts', text: marked('src/*.css') },
      { path: 'src/c.test.ts', text: "import { css } from './sheet';\n" },
    ];
    expect(run(files)).toEqual([
      'SCANNED_BY "src/*.css" does not list src/b.test.ts, which reads it',
      'SCANNED_BY "src/*.css" does not list src/c.test.ts, which imports src/sheet.ts, which reads it',
    ]);
  });

  it('fails a SCANNED_BY test that does not exist, and a bare none', () => {
    expect(run([{ path: 'src/b.ts', text: marked('none') }])).toEqual([
      'src/b.ts: "none": write none as "none (<why>)"',
      'SCANNED_BY "src/*.css" names src/a.test.ts, which does not exist',
    ]);
  });

  it('parses markers, read calls and import specifiers', () => {
    expect(parseMarker('// reads-by-path: a/**, b\n')).toEqual({
      globs: ['a/**', 'b'],
      problems: [],
    });
    expect(parseMarker('const x = 1;\n')).toBeNull();
    expect(readCallsIn("import { build } from 'esbuild';\nawait build(o);\n")).toEqual(['build']);
    expect(readCallsIn("import { readFileSync } from 'node:fs';\n")).toEqual([]);
    const text = "import { a } from '../x/y.ts';\nimport b from '@windsor/engine/patch/presets';\n";
    expect(importedModules('packages/app/src/z.test.ts', text)).toEqual([
      'packages/app/x/y',
      'packages/engine/src/patch/presets',
    ]);
  });
});
