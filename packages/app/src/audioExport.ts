/**
 * The Export Audio section of the Settings tab (windsor#40): the song
 * rendered offline through the engine's `renderSong` — the live system on an
 * offline context — and written as a WAV by its `encodeWav`. Sample rate, bit
 * depth and tail are chosen here; Download always, Save as… where the browser
 * has the save picker. While a render runs the section shows its progress and
 * a Cancel; a cancelled render writes nothing. The rules are
 * `audioExportModel.ts`, the destinations `audioExportSinks.ts`.
 *
 * The settings and a running render live at module scope, so a tab re-render
 * mid-render redraws the progress rather than losing it.
 */
import {
  RENDER_SAMPLE_RATES,
  RENDER_TAIL_SECONDS,
  WAV_BIT_DEPTHS,
  encodeWav,
  renderSong,
} from '@windsor/engine';
import type { RenderSampleRate, WavBitDepth } from '@windsor/engine';
import { HZ_PER_KHZ, PERCENT, TAIL_KNOB_STEP } from './audioExportConstants';
import type { AudioExportSettings, ExportDestination, WavSink } from './audioExportModel';
import {
  defaultExportSettings,
  exportDestinations,
  exportNotice,
  runAudioExport,
  wavFileName,
} from './audioExportModel';
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
      'releases and returns ring out; a tail of 0 gives a loop-ready file.',
  );
  const formats = el('div', 'bar-row');
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
  body.appendChild(formats);
  const actions = el('div', 'bar-row');
  body.appendChild(actions);
  repaint = (): void => paintActions(actions, ctx, songName);
  repaint();
  return root;
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
    button.onclick = (): void => void startExport(ctx, destination, wavFileName(songName()));
    row.appendChild(button);
  }
}

async function startExport(
  ctx: AppCtx,
  destination: ExportDestination,
  fileName: string,
): Promise<void> {
  if (job) return;
  let sink: WavSink | null;
  try {
    // The picker opens first, inside the click's user activation.
    sink = destination === 'saveAs' ? await pickSaveSink(fileName) : downloadSink(fileName);
  } catch (error) {
    ctx.notify(`audio export failed: ${String(error)}`, 'error');
    return;
  }
  if (!sink) return;
  const current: ExportJob = { controller: new AbortController(), fraction: 0 };
  job = current;
  repaint();
  const outcome = await runAudioExport({
    // A snapshot: an edit made while the render runs is not in this file.
    document: structuredClone(ctx.model.doc),
    settings: { ...settings },
    fileName,
    sink,
    signal: current.controller.signal,
    onProgress: (fraction) => {
      current.fraction = fraction;
      repaint();
    },
    render: renderSong,
    encode: encodeWav,
  });
  job = null;
  repaint();
  const notice = exportNotice(outcome);
  ctx.notify(notice.message, notice.tone);
}
