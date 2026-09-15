/**
 * Arrangement tab (#70, record §2; #435): transport and bpm, seed, and the
 * document itself — export downloads a file, import reads one back (record:
 * the console is a local tool, so a page-initiated download simply works).
 * The exported file is the normalised document — patches, returns, mix,
 * sequencers, harmony, all of it; saved under
 * `packages/client/src/audio/arrangements/<name>.json` the game bundles it
 * at build time (record §3) and `?music=<name>` plays it, `bed-01` being the
 * default.
 */
import type { AppCtx } from './context';
import { el, fmt0, section } from './dom';
import { makeKnob } from './knob';

const COLOR = '#E0A44E';

function transportSection(ctx: AppCtx): HTMLElement {
  const { root, body } = section('Transport');
  const row = el('div', 'bar-row');
  const mute = el('button', 'btn', 'Mute') as HTMLButtonElement;
  mute.type = 'button';
  mute.onclick = (): void => {
    const system = ctx.host.system;
    if (!system) return ctx.status('enable audio first');
    mute.setAttribute('aria-pressed', String(system.toggleMute()));
  };
  row.appendChild(mute);
  const restart = el('button', 'btn', 'Restart') as HTMLButtonElement;
  restart.type = 'button';
  restart.title = 'Rebuild from the document and play from tick 0';
  restart.onclick = (): void => ctx.restructure(() => {});
  row.appendChild(restart);
  row.appendChild(
    makeKnob({
      label: 'BPM',
      min: 20,
      max: 300,
      def: 96,
      step: 1,
      color: COLOR,
      fmt: fmt0,
      get: () => ctx.model.doc.bpm,
      set: (v) => void ctx.change({ bpm: v }),
    }),
  );
  const seed = el('div');
  seed.appendChild(el('span', 'field-label', 'Seed'));
  const seedInput = document.createElement('input');
  seedInput.className = 'field';
  seedInput.name = 'seed';
  seedInput.type = 'number';
  seedInput.value = String(ctx.model.doc.seed);
  seedInput.setAttribute('aria-label', 'Seed');
  seedInput.onchange = (): void => void ctx.change({ seed: Number(seedInput.value) });
  seed.appendChild(seedInput);
  const reroll = el('button', 'btn', 'Reroll') as HTMLButtonElement;
  reroll.type = 'button';
  reroll.onclick = (): void => {
    const next = Math.floor(Math.random() * 1e6);
    seedInput.value = String(next);
    ctx.change({ seed: next });
  };
  seed.appendChild(reroll);
  row.appendChild(seed);
  body.appendChild(row);
  return root;
}

function documentSection(ctx: AppCtx): HTMLElement {
  const { root, body } = section(
    'Document',
    'Export downloads the whole piece — a snapshot of every patch any part plays, plus ' +
      'returns, mix, sequencers and harmony — as one normalised document. Save it as ' +
      'packages/client/src/audio/arrangements/<name>.json: the game bundles every file there, ' +
      'resolves patches from the document alone (#562), ?music=<name> plays it (bed-01 is the ' +
      'default), and npm run verify gates each one.',
  );
  const row = el('div', 'bar-row');
  const name = document.createElement('input');
  name.className = 'field';
  name.name = 'export-name';
  name.value = 'bed-01.json';
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
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
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
      const counters = Object.entries(r.counters)
        .map(([id, n]) => `${id} ${n}`)
        .join(' · ');
      line.textContent =
        `${r.running ? 'running' : 'stopped'}${r.muted ? ' (muted)' : ''} — ` +
        `bpm ${r.bpm} — root ${r.root} — ${counters}`;
    }
    setTimeout(update, 500);
  };
  // Deferred: at build time the section is not yet in the DOM, and the
  // isConnected guard above would kill the loop before it started.
  setTimeout(update, 50);
  return root;
}

export function renderArrangementTab(body: HTMLElement, ctx: AppCtx): void {
  body.innerHTML = '';
  body.appendChild(transportSection(ctx));
  body.appendChild(documentSection(ctx));
  body.appendChild(reportSection(ctx));
  body.appendChild(readoutSection(ctx));
}
