/**
 * The audio gate's build line (windsor#578 decision 8): which build of
 * Windsor this is, stamped by `vite.config.ts` at build time because both
 * `package.json` versions are `0.0.0`. The formats are the mockup's:
 * `Windsor 9543344 · 4 Oct 2026` on a main build, `Windsor PR #576 ·
 * abc1234 · 4 Oct 2026` on a PR preview, `Windsor dev` under `npm run dev`.
 */
import { BUILD_MONTHS } from './audioGateTables';

/** What `vite build` stamps: the short commit, the UTC build date, and the PR number on a preview. */
export interface BuildStamp {
  readonly commit: string;
  /** `YYYY-MM-DD`, UTC. */
  readonly date: string;
  readonly pr: string | null;
}

const SEPARATOR = ' · ';

/** `2026-10-04` as `4 Oct 2026`; any other text as it is. */
export function buildDate(iso: string, months: readonly string[] = BUILD_MONTHS): string {
  const [year, month, day] = iso.split('-').map(Number);
  const name = month === undefined ? undefined : months[month - 1];
  if (!year || !name || !day) return iso;
  return `${day} ${name} ${year}`;
}

/** The line after the bold "Windsor": the stamp, or `dev` with none. */
export function buildLine(
  stamp: BuildStamp | null,
  months: readonly string[] = BUILD_MONTHS,
): string {
  if (!stamp) return 'dev';
  const parts = [stamp.commit, buildDate(stamp.date, months)];
  if (stamp.pr) parts.unshift(`PR #${stamp.pr}`);
  return parts.join(SEPARATOR);
}
