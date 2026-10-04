/**
 * The build's stamp (windsor#578 decision 8), which `vite.config.ts` injects
 * through `define`: the short commit, the UTC build date and, on a PR
 * preview, the PR number; null under `npm run dev`. Read only by
 * `audioGate.ts`, which formats it with `audioGateBuildLine.ts`.
 */
declare const __WINDSOR_BUILD__: {
  readonly commit: string;
  readonly date: string;
  readonly pr: string | null;
} | null;
