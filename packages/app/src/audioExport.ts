/**
 * The Export Audio section of the Settings tab (windsor#40): the song
 * rendered offline through the engine's `renderSong` — the live system on an
 * offline context — and written as a WAV by its `encodeWav`; or, with Stems
 * chosen (windsor#41), the engine's `renderStems`: one WAV per part and per
 * return beside the master, in one zip. Sample rate, bit depth and tail are
 * chosen here, and whether stems take the "Sidechain only" parts too;
 * Download always, Save as… where the browser has the save picker. While a
 * render runs the section shows its progress and a Cancel; a cancelled
 * render writes nothing. The rules are `audioExportModel.ts` and
 * `audioExportStems.ts`, the destinations `audioExportSinks.ts`.
 *
 * The settings and a running render live at module scope, so a tab re-render
 * mid-render redraws the progress rather than losing it.
 */
import {
  RENDER_SAMPLE_RATES,
  RENDER_TAIL_SECONDS,
  WAV_BIT_DEPTHS,
  encodeWavAsync,
  renderRefusal,
  renderSong,
  renderStems,
} from '@windsor/engine';
import type { RenderSampleRate, WavBitDepth } from '@windsor/engine';
import { HZ_PER_KHZ, PERCENT, TAIL_KNOB_STEP } from './audioExportConstants';
import type {
  AudioExportOutcome,
  AudioExportSettings,
  ExportDestination,
  WavSink,
} from './audioExportModel';
import {
  defaultExportSettings,
  exportDestinations,
  exportNotice,
  runAudioExport,
  wavFileName,
} from './audioExportModel';
import { runStemExport, stemsZipName } from './audioExportStems';
import { downloadSink, pickSaveSink, savePickerAvailable } from './audioExportSinks';
import type { AppCtx } from './context';
import { el, section, seg } from './dom';
import { makeKnob } from './knob';

interface ExportJob {
  controller: AbortController;
  fraction: number;
}

const settings: AudioExportSettings = defaultExportSettings();
let job: ExportJob | null = null;
/** Redraws whichever section is on the page now; replaced on every render of it. */
let repaint: () => void = () => {};

const DESTINATION_LABELS: Record<ExportDestination, string> = {
  download: 'Download',
  saveAs: 'Save as…',
};

/** The Export Audio section. `songName` reads the Export field, the song's only name. */
export function audioExportSection(ctx: AppCtx, songName: () => string): HTMLElement {
  const { root, body } = section(
    'Export Audio',
    'Renders the whole song offline through the same engine as playback, then writes a ' +
      'stereo WAV. The tail keeps rendering after the last bar so ' +
      'releases and returns ring out; a tail of 0 gives a loop-ready file. Stems adds one ' +
      'WAV per part (after its fader, without its sends) and one per return, beside the ' +
      "master, in one zip; they skip the master's inserts and limiter, so summed they are " +
      'the master before its dynamics.',
  );
  body.appendChild(formatControls());
  const actions = el('div', 'bar-row export-actions');
  body.appendChild(actions);
  repaint = (): void => paintActions(actions, ctx, songName);
  repaint();
  return root;
}

/** Mix or stems, the rate, the depth, the tail, and — for stems — the muted parts. */
function formatControls(): HTMLElement {
  const formats = el('div', 'bar-row export-formats');
  const muted = el('label', '', 'Include sidechain-only parts');
  muted.title = 'Stems of the parts routed "Sidechain only", which the master never hears';
  const include = document.createElement('input');
  include.type = 'checkbox';
  include.name = 'export-include-muted';
  include.checked = settings.includeMuted;
  include.onchange = (): void => void (settings.includeMuted = include.checked);
  muted.prepend(include);
  muted.hidden = !settings.stems;
  formats.appendChild(
    seg(
      [
        { value: 'mix', label: 'Mix' },
        { value: 'stems', label: 'Stems' },
      ],
      () => (settings.stems ? 'stems' : 'mix'),
      (value) => {
        settings.stems = value === 'stems';
        muted.hidden = !settings.stems;
      },
    ),
  );
  formats.appendChild(
    seg(
      RENDER_SAMPLE_RATES.map((rate) => ({
        value: String(rate),
        label: `${rate / HZ_PER_KHZ} kHz`,
      })),
      () => String(settings.sampleRate),
      (value) => (settings.sampleRate = Number(value) as RenderSampleRate),
    ),
  );
  formats.appendChild(
    seg(
      WAV_BIT_DEPTHS.map((bits) => ({ value: String(bits), label: `${bits}-bit` })),
      () => String(settings.bitDepth),
      (value) => (settings.bitDepth = Number(value) as WavBitDepth),
    ),
  );
  formats.appendChild(
    makeKnob({
      label: 'Tail',
      min: RENDER_TAIL_SECONDS.min,
      max: RENDER_TAIL_SECONDS.max,
      def: RENDER_TAIL_SECONDS.default,
      step: TAIL_KNOB_STEP,
      fmt: (v) => `${v.toFixed(1)} s`,
      get: () => settings.tailSeconds,
      set: (v) => (settings.tailSeconds = v),
    }),
  );
  formats.appendChild(muted);
  return formats;
}

/** Idle: one button per destination. Rendering: the progress bar and Cancel. */
function paintActions(row: HTMLElement, ctx: AppCtx, songName: () => string): void {
  row.replaceChildren();
  if (job) {
    const bar = document.createElement('progress');
    bar.max = 1;
    bar.value = job.fraction;
    bar.setAttribute('aria-label', 'Render progress');
    row.appendChild(bar);
    row.appendChild(el('span', 'hint', `rendering ${Math.round(job.fraction * PERCENT)}%`));
    const cancel = el('button', 'btn', 'Cancel') as HTMLButtonElement;
    cancel.type = 'button';
    cancel.onclick = (): void => job?.controller.abort();
    row.appendChild(cancel);
    return;
  }
  for (const destination of exportDestinations(savePickerAvailable())) {
    const button = el(
      'button',
      destination === 'download' ? 'btn primary' : 'btn',
      DESTINATION_LABELS[destination],
    ) as HTMLButtonElement;
    button.type = 'button';
    button.onclick = (): void => void startExport(ctx, destination, songName());
    row.appendChild(button);
  }
}

async function startExport(
  ctx: AppCtx,
  destination: ExportDestination,
  exportName: string,
): Promise<void> {
  if (job) return;
  // A song too long to hold is refused before a picker opens or a byte is allocated.
  const refusal = renderRefusal(ctx.model.doc, settings);
  if (refusal) {
    ctx.notify(`audio export refused: ${refusal}`, 'error');
    return;
  }
  const chosen = { ...settings };
  const fileName = chosen.stems ? stemsZipName(exportName) : wavFileName(exportName);
  let sink: WavSink | null;
  try {
    // The picker opens first, inside the click's user activation.
    sink =
      destination === 'saveAs'
        ? await pickSaveSink(fileName, chosen.stems ? 'zip' : 'wav')
        : downloadSink(fileName);
  } catch (error) {
    ctx.notify(`audio export failed: ${String(error)}`, 'error');
    return;
  }
  if (!sink) return;
  const current: ExportJob = { controller: new AbortController(), fraction: 0 };
  job = current;
  repaint();
  const outcome = await runExport(ctx, chosen, { exportName, fileName, sink, job: current });
  job = null;
  repaint();
  const notice = exportNotice(outcome);
  ctx.notify(notice.message, notice.tone);
}

/** The mix's run or the stems', over a snapshot of the song: an edit made while it runs is not in the files. */
function runExport(
  ctx: AppCtx,
  chosen: AudioExportSettings,
  target: { exportName: string; fileName: string; sink: WavSink; job: ExportJob },
): Promise<AudioExportOutcome> {
  const common = {
    document: structuredClone(ctx.model.doc),
    settings: chosen,
    fileName: target.fileName,
    sink: target.sink,
    signal: target.job.controller.signal,
    onProgress: (fraction: number): void => {
      target.job.fraction = fraction;
      repaint();
    },
    encode: encodeWavAsync,
  };
  if (!chosen.stems) return runAudioExport({ ...common, render: renderSong });
  return runStemExport({
    ...common,
    exportName: target.exportName,
    modified: new Date(),
    render: renderStems,
  });
}
