import { execFileSync } from 'node:child_process';
import { defineConfig } from 'vite';

/** A full SHA from CI is cut to git's short form. */
const SHORT_SHA = 7;
/** `YYYY-MM-DD` out of an ISO timestamp. */
const ISO_DATE = 10;

/** The checked-out commit, short, or `unknown` outside a git checkout. */
function gitCommit(): string {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

/**
 * The audio gate's build line (windsor#578 decision 8; the global is
 * declared in `src/buildStamp.d.ts`). On a PR, CI checks out a merge commit,
 * so CI passes the PR's head SHA and number as `WINDSOR_COMMIT` and
 * `WINDSOR_PR`; otherwise the commit is the checkout's. An empty variable
 * (CI on a push to main) counts as unset.
 */
function buildStamp(): { commit: string; date: string; pr: string | null } {
  const commit = process.env['WINDSOR_COMMIT'];
  return {
    commit: commit ? commit.slice(0, SHORT_SHA) : gitCommit(),
    date: new Date().toISOString().slice(0, ISO_DATE),
    pr: process.env['WINDSOR_PR'] || null,
  };
}

/**
 * The app is a static site: `vite build` writes `dist/` (HTML, the hashed app
 * bundle, and each DSP worklet the engine names with `new URL(…,
 * import.meta.url)`, emitted as its own asset). A relative `base` lets that
 * folder be served from any path — a GitHub Pages project site, a Cloudflare
 * Pages root or an S3 prefix — without a rebuild; `WINDSOR_BASE` overrides it.
 * Under `npm run dev` the build stamp is null and the gate reads `Windsor dev`.
 */
export default defineConfig(({ command }) => ({
  base: process.env['WINDSOR_BASE'] ?? './',
  define: {
    __WINDSOR_BUILD__: JSON.stringify(command === 'build' ? buildStamp() : null),
  },
  server: { port: 5173, strictPort: true },
  build: {
    target: 'es2022',
    sourcemap: true,
    // Never inline a worklet as a data URL (Vite's default for a small asset):
    // each loads through `audioWorklet.addModule` from a real file.
    assetsInlineLimit: (file: string) => (file.endsWith('.js') ? false : undefined),
  },
}));
