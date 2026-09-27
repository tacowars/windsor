// Flat config. Type-aware rules are deliberately off: they multiply lint time
// and the gate must stay fast.
import eslint from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default defineConfig(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/*.d.ts',
      // The DSP worklet bundles (#643): `scripts/build-worklets.mjs` writes
      // each from its source folder beside it, and `--check` in `npm run
      // verify` refuses a copy that differs. Lint the sources, not the output.
      'packages/engine/src/worklet/generated/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // Size limits (CLAUDE.md "Code structure"). The default response to a
      // hit is to split. If the split would only invent an abstraction to
      // satisfy the number, exceed it slightly with a targeted
      //   // eslint-disable-next-line max-lines-per-function -- <why>
      // and a reason the reviewer can weigh. Raise a limit itself only with a
      // decision record.
      'max-lines': ['error', { max: 350, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': [
        'error',
        { max: 60, skipBlankLines: true, skipComments: true, IIFEs: true },
      ],
      'max-depth': ['error', 4],
      'max-params': ['error', 5],
    },
  },
  {
    // The engine is UI-free: it never imports the app. The app reaches the
    // engine through `@windsor/engine` (its index) — the one surface — and
    // never by a relative path into the engine's folders.
    files: ['packages/engine/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^@windsor/app|(\\.\\./)+app/',
              message: 'the engine never imports the app (CLAUDE.md "Layout").',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/app/src/**/*.ts'],
    ignores: ['packages/app/src/**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^@windsor/engine/|(\\.\\./)+engine/',
              message:
                'the app imports the engine through `@windsor/engine` only; extend its index.ts rather than reaching past it (CLAUDE.md "Layout").',
            },
          ],
        },
      ],
    },
  },
  {
    // Data separate from logic (CLAUDE.md "Code structure"). An area's
    // tunables belong in one exported `<area>Constants.ts` / `<area>Tables.ts`
    // beside the logic, and the logic takes the table as a parameter
    // defaulting to the shipped one — so a test, a sweep or a bench can inject
    // another. A bare number in a logic file is precisely the value that
    // cannot be injected, which is what this rule finds.
    //
    // 0, 1, 2 and -1 are exempt (identity, the other index, a "not found"),
    // as are array indices and parameter defaults.
    files: ['packages/*/src/**/*.ts'],
    ignores: [
      // Tests and fixtures are where concrete numbers belong.
      '**/*.test.ts',
      '**/__fixtures__/**',
      // The table files themselves — the destination, not the offence.
      '**/constants.ts',
      '**/*Constants.ts',
      '**/*Defaults.ts',
      '**/*Table*.ts',
      '**/presets*.ts',
    ],
    rules: {
      'no-magic-numbers': [
        'error',
        {
          ignore: [-1, 0, 1, 2],
          ignoreArrayIndexes: true,
          ignoreDefaultValues: true,
          enforceConst: false,
          detectObjects: false,
        },
      ],
    },
  },
  {
    // Tests read better as long describe() blocks; keep the file cap only.
    files: ['**/*.test.ts', '**/*.test.mjs'],
    rules: { 'max-lines-per-function': 'off' },
  },
);
