/**
 * Arrangement tab (#70, record §2; #435): the document itself — export downloads a file, import reads one back (record:
 * the console is a local tool, so a page-initiated download simply works).
 * New song starts over from one Init part with no sequencer (#598), asking
 * first when the document has changed since it was opened.
 * The exported file is the normalised document — patches, returns, each
 * part's strip, sequencers, harmony, all of it — self-contained (#562), so
 * Import on any machine plays it as exported. The transport, bpm and bars moved to the strip above every tab
 * (#708, `transportStrip.ts`); Mute became ‖ and Restart is gone — Import is
 * the rebuild left (#629).
 */
import { EXPORT_URL_TTL_MS, READOUT_DEFER_MS, READOUT_POLL_MS } from './arrangementConstants';
import type { AppCtx } from './context';
import { el, section } from './dom';
import { openConfirm } from './metadataModal';
import { newSong } from './songParts';

/** Start over on a new song, asking first when this one has changed since it was opened (#598). */
function newSongButton(ctx: AppCtx): HTMLElement {
  const fresh = el('button', 'btn', 'New song') as HTMLButtonElement;
  fresh.type = 'button';
  fresh.title = 'Start over: one part, the Init patch, no sequencer';
  fresh.onclick = (): void => {
    const start = (): void => {
      ctx.parts.selected = 0;
      ctx.importDoc(newSong());
      ctx.status('new song — pick a sequencer for Part 1 in the Parts tab');
    };
    if (!ctx.model.changed) return start();
    void openConfirm({
      title: 'New song',
      body: 'Discard the changes to this song? Export first to keep them.',
      ok: 'Discard',
      opener: fresh,
    }).then((ok) => ok && start());
  };
  return fresh;
}

function documentSection(ctx: AppCtx): HTMLElement {
  const { root, body } = section(
    'Document',
    'Export downloads the whole piece — a snapshot of every patch any part plays, plus ' +
      "returns, every part's strip, sequencers and harmony — as one normalised, self-contained " +
      'document. Import reads one back and plays it exactly as exported.',
  );
  const row = el('div', 'bar-row');
  row.appendChild(newSongButton(ctx));
  const name = document.createElement('input');
  name.className = 'field';
  name.name = 'export-name';
  name.value = 'song.json';
  name.setAttribute('aria-label', 'Export file name');
  row.appendChild(name);
  const exportBtn = el('button', 'btn primary', 'Export') as HTMLButtonElement;
  exportBtn.type = 'button';
  exportBtn.onclick = (): void => {
    const blob = new Blob([ctx.model.toJson()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name.value || 'arrangement.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), EXPORT_URL_TTL_MS);
    ctx.status(`exported ${a.download}`);
  };
  row.appendChild(exportBtn);
  const file = document.createElement('input');
  file.name = 'import-file';
  file.type = 'file';
  file.accept = '.json,application/json';
  file.className = 'field';
  file.setAttribute('aria-label', 'Import a document');
  file.onchange = (): void => {
    const chosen = file.files?.[0];
    if (!chosen) return;
    chosen
      .text()
      .then((text) => {
        ctx.importDoc(JSON.parse(text) as unknown);
        ctx.status(`imported ${chosen.name}`);
      })
      .catch((error: unknown) => ctx.status(`import failed: ${String(error)}`));
  };
  row.appendChild(file);
  body.appendChild(row);
  return root;
}

function reportSection(ctx: AppCtx): HTMLElement {
  const { root, body } = section('Normalisation report');
  const { corrections, dangling, filled, usable } = ctx.model;
  if (!usable)
    body.appendChild(el('p', 'hint hot', 'Nothing usable — the metronome fallback is playing.'));
  // #562: a song carries every patch it plays, so a document written before
  // that took these from the library on open. Say which, and that exporting
  // is what makes the song self-contained.
  if (filled.length > 0) {
    body.appendChild(
      el(
        'p',
        'hint hot',
        `filled from the library on open: ${filled.join(', ')} — this song did not carry ` +
          'them. They are embedded now; export to save the song with them in it.',
      ),
    );
  }
  if (corrections.length === 0 && dangling.length === 0 && filled.length === 0) {
    body.appendChild(el('p', 'hint', 'Clean: nothing corrected, nothing dangling.'));
  }
  for (const line of corrections) body.appendChild(el('p', 'hint', `corrected: ${line}`));
  for (const line of dangling) body.appendChild(el('p', 'hint hot', `dangling: ${line}`));
  return root;
}

function readoutSection(ctx: AppCtx): HTMLElement {
  const { root, body } = section('Live readout');
  const line = el('p', 'status', 'audio not enabled');
  body.appendChild(line);
  const update = (): void => {
    if (!line.isConnected) return;
    const system = ctx.host.system;
    if (system) {
      const r = system.readout();
      const counters = ctx.model.doc.parts
        .map((part) => `${part.name} ${r.counters[part.slot] ?? 0}`)
        .join(' · ');
      line.textContent =
        `${r.running ? 'running' : 'stopped'}${r.muted ? ' (muted)' : ''} — ` +
        `bpm ${r.bpm} — root ${r.root} — ${counters}`;
    }
    setTimeout(update, READOUT_POLL_MS);
  };
  // Deferred: at build time the section is not yet in the DOM, and the
  // isConnected guard above would kill the loop before it started.
  setTimeout(update, READOUT_DEFER_MS);
  return root;
}

export function renderArrangementTab(body: HTMLElement, ctx: AppCtx): void {
  body.innerHTML = '';
  body.appendChild(documentSection(ctx));
  body.appendChild(reportSection(ctx));
  body.appendChild(readoutSection(ctx));
}
