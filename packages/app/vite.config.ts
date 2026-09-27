import { defineConfig } from 'vite';

/**
 * The app is a static site: `vite build` writes `dist/` (HTML, the hashed app
 * bundle, and each DSP worklet the engine names with `new URL(…,
 * import.meta.url)`, emitted as its own asset). A relative `base` lets that
 * folder be served from any path — a GitHub Pages project site, a Cloudflare
 * Pages root or an S3 prefix — without a rebuild; `WINDSOR_BASE` overrides it.
 */
export default defineConfig({
  base: process.env['WINDSOR_BASE'] ?? './',
  server: { port: 5173, strictPort: true },
  build: {
    target: 'es2022',
    sourcemap: true,
    // Never inline a worklet as a data URL (Vite's default for a small asset):
    // each loads through `audioWorklet.addModule` from a real file.
    assetsInlineLimit: (file) => (file.endsWith('.js') ? false : undefined),
  },
});
