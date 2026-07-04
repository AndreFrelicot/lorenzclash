// Export menu: a centred modal listing the recorded background sequences (clips) as a
// reorderable vertical list. Tap a clip to preview it (video + its start sound), drag
// the handle to reorder (the first clip seeds "continuous" audio), pin to keep, include
// or exclude, choose the audio mode + sound, then generate and download or share.
// App owns the recorder, the encode/deliver closure, and mutes the live music +
// pauses capture while this dialog is open.
import type { Sequence, SequenceRecorder } from '../export/SequenceRecorder.ts';
import { encodeSequences, type ExportOptions, type ExportResult } from '../export/Mp4Encoder.ts';
import { haptics } from '../haptics.ts';
import { getLocale, getMessages, onLocaleChange } from '../i18n.ts';
import { makeIcon, type IconName } from './icons.ts';

export interface ExportMenuHandle {
  open: () => void;
  close: () => void;
  refresh: () => void;
  destroy: () => void;
}

export interface ExportMenuDeps {
  recorder: SequenceRecorder;
  endCardDurationSec: number;
  generate: (
    sequences: Sequence[],
    opts: ExportOptions,
    onProgress: (p: number) => void,
  ) => Promise<ExportResult>;
  onOpen: () => void;
  onClose: () => void;
}

const THUMB_W = 96;
const ROWS_PER_FRAME = 2;

function canShareFiles(): boolean {
  return typeof navigator.share === 'function' && typeof navigator.canShare === 'function';
}

function describeBlob(result: ExportResult): string {
  return `${Math.round(result.blob.size / 1e6)}MB type=${result.blob.type || 'n/a'} ext=${result.ext}`;
}

function formatDuration(seconds: number): string {
  const value = Math.max(0, seconds);
  const n = new Intl.NumberFormat(getLocale(), {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value);
  return `${n} s`;
}

function downloadFile(result: ExportResult, source = 'direct'): void {
  console.info(`[export-download] downloadFile source=${source} ${describeBlob(result)}`);
  const url = URL.createObjectURL(result.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `lorenz-clash.${result.ext}`;
  a.rel = 'noopener';
  // In the DOM before click() — some browsers ignore a detached anchor's download.
  document.body.appendChild(a);
  a.click();
  console.info(`[export-download] anchor click dispatched source=${source}`);
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

async function shareFile(result: ExportResult): Promise<void> {
  const file = new File([result.blob], `lorenz-clash.${result.ext}`, { type: result.blob.type });
  if (!navigator.canShare?.({ files: [file] })) {
    downloadFile(result, 'share-fallback');
    return;
  }
  try {
    await navigator.share({ files: [file], title: 'Lorenz Clash' });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') return;
    downloadFile(result, 'share-fallback');
  }
}

// Custom toggle: a hand-drawn SVG icon instead of a checkbox. On = bright, enlarged and
// slowly spinning; off = small and grey (driven by CSS on `.is-on`). See styles.css.
function makeIconToggle(
  icon: IconName,
  ariaLabel: string,
  initial: boolean,
  onToggle: (on: boolean) => void,
  labelText?: string,
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'export-toggle';
  btn.setAttribute('aria-label', ariaLabel);
  const ring = document.createElement('span');
  ring.className = 'toggle-ic';
  ring.appendChild(makeIcon(icon, 22));
  btn.appendChild(ring);
  if (labelText) {
    const t = document.createElement('span');
    t.textContent = labelText;
    btn.appendChild(t);
  }
  const set = (on: boolean): void => {
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-pressed', String(on));
  };
  set(initial);
  btn.addEventListener('click', () => {
    const on = !btn.classList.contains('is-on');
    set(on);
    onToggle(on);
  });
  return btn;
}

export function mountExportMenu(parent: HTMLElement, deps: ExportMenuDeps): ExportMenuHandle {
  const t = () => getMessages().exportMenu;
  const common = () => getMessages().common;
  let includeAudio = true;
  let audioMode: 'per-clip' | 'continuous' = 'continuous';
  let generating = false;
  let generationFailed = false;
  let resultValid = false; // a generation is current — Generate stays disabled until params change
  let delivering = false; // a download/share is in flight
  let lastResult: ExportResult | null = null;
  let order: number[] = []; // clip ids, user-arranged (export + continuous-audio order)
  let renderToken = 0; // cancels stale progressive row builds

  // Preview state.
  let previewId: number | null = null;
  let previewVideo: HTMLVideoElement | null = null;
  const previewUrls = new Map<number, string>();

  // Drag-reorder state.
  let dragId: number | null = null;
  let dragRow: HTMLElement | null = null;
  let grabPointerY = 0;
  let grabScrollTop = 0;
  let pointerY = 0;
  let dropIndex = 0; // insertion index among the non-dragged rows
  let autoRaf = 0;
  const dropBar = document.createElement('div'); // insertion indicator line
  dropBar.className = 'export-drop-bar';
  dropBar.style.display = 'none';

  const overlay = document.createElement('div');
  overlay.className = 'export-overlay';
  const panel = document.createElement('div');
  panel.className = 'export-panel';
  overlay.appendChild(panel);

  const closeBtn = document.createElement('button');
  closeBtn.className = 'export-close';
  closeBtn.type = 'button';
  closeBtn.appendChild(makeIcon('close'));
  closeBtn.addEventListener('click', () => close());
  panel.appendChild(closeBtn);

  const title = document.createElement('h2');
  title.className = 'export-title';
  panel.appendChild(title);

  const empty = document.createElement('p');
  empty.className = 'export-empty';
  panel.appendChild(empty);

  const list = document.createElement('div');
  list.className = 'export-list';
  panel.appendChild(list);

  // Controls: audio mode + sound.
  const controls = document.createElement('div');
  controls.className = 'export-controls';
  panel.appendChild(controls);

  const modeRow = document.createElement('div');
  modeRow.className = 'export-modes';
  const modeButtons: { mode: 'per-clip' | 'continuous'; el: HTMLButtonElement }[] = (
    [
      ['per-clip'],
      ['continuous'],
    ] as const
  ).map(([mode]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'export-mode';
    b.addEventListener('click', () => {
      audioMode = mode;
      syncModes();
      invalidateResult();
    });
    modeRow.appendChild(b);
    return { mode, el: b };
  });
  const syncModes = (): void => {
    for (const m of modeButtons) m.el.classList.toggle('is-on', m.mode === audioMode);
  };
  syncModes();
  controls.appendChild(modeRow);

  const soundToggle = makeIconToggle(
    'sound',
    t().includeSound,
    includeAudio,
    (on) => {
      includeAudio = on;
      modeRow.style.display = includeAudio ? '' : 'none';
      invalidateResult();
    },
    t().sound,
  );
  const soundLabel = soundToggle.querySelector<HTMLSpanElement>('.export-toggle > span:not(.toggle-ic)');
  soundToggle.style.marginLeft = 'auto'; // stay right even when the mode row is hidden
  controls.appendChild(soundToggle);

  // Curation: bulk-delete the disposable clips (neither kept nor included). Sits between the
  // list and the export controls; hidden when there's nothing to clear.
  const curationRow = document.createElement('div');
  curationRow.className = 'export-curation';
  const removeUnusedBtn = document.createElement('button');
  removeUnusedBtn.type = 'button';
  removeUnusedBtn.className = 'export-remove-unused';
  removeUnusedBtn.appendChild(makeIcon('trash', 16));
  const removeUnusedLabel = document.createElement('span');
  removeUnusedBtn.appendChild(removeUnusedLabel);
  removeUnusedBtn.addEventListener('click', () => {
    const n = deps.recorder.disposableCount();
    if (n === 0) return;
    void askConfirm(t().clearUnkeptConfirm(n)).then((ok) => {
      if (!ok) return;
      haptics.impact('medium');
      deps.recorder.removeDisposable();
      invalidateResult();
      renderGrid();
    });
  });
  curationRow.appendChild(removeUnusedBtn);
  panel.insertBefore(curationRow, controls);

  // Confirmation overlay for destructive actions (per-clip trash, bulk remove). A small card
  // over the panel rather than a native confirm() (jarring in a fullscreen PWA).
  const confirmEl = document.createElement('div');
  confirmEl.className = 'export-confirm';
  confirmEl.style.display = 'none';
  const confirmCard = document.createElement('div');
  confirmCard.className = 'export-confirm-card';
  const confirmMsg = document.createElement('p');
  confirmMsg.className = 'export-confirm-msg';
  const confirmBtns = document.createElement('div');
  confirmBtns.className = 'export-confirm-btns';
  const confirmCancel = document.createElement('button');
  confirmCancel.type = 'button';
  confirmCancel.className = 'export-confirm-cancel';
  const confirmOk = document.createElement('button');
  confirmOk.type = 'button';
  confirmOk.className = 'export-confirm-ok';
  confirmBtns.append(confirmCancel, confirmOk);
  confirmCard.append(confirmMsg, confirmBtns);
  confirmEl.appendChild(confirmCard);
  panel.appendChild(confirmEl);

  let confirmResolve: ((ok: boolean) => void) | null = null;
  function endConfirm(ok: boolean): void {
    confirmEl.style.display = 'none';
    const resolve = confirmResolve;
    confirmResolve = null;
    resolve?.(ok);
  }
  function askConfirm(message: string): Promise<boolean> {
    endConfirm(false); // resolve any prior pending confirm as cancelled
    confirmMsg.textContent = message;
    confirmEl.style.display = '';
    return new Promise<boolean>((resolve) => {
      confirmResolve = resolve;
    });
  }
  confirmCancel.addEventListener('click', () => endConfirm(false));
  confirmOk.addEventListener('click', () => endConfirm(true));

  const durationSummary = document.createElement('p');
  durationSummary.className = 'export-duration';
  panel.appendChild(durationSummary);

  const progress = document.createElement('div');
  progress.className = 'export-progress';
  const progressBar = document.createElement('div');
  progressBar.className = 'export-progress-bar';
  progress.appendChild(progressBar);
  panel.appendChild(progress);

  const generateBtn = document.createElement('button');
  generateBtn.className = 'export-generate';
  generateBtn.type = 'button';
  generateBtn.addEventListener('click', () => void run());
  panel.appendChild(generateBtn);

  const resultRow = document.createElement('div');
  resultRow.className = 'export-result';
  resultRow.style.display = 'none';
  const downloadBtn = document.createElement('button');
  downloadBtn.type = 'button';
  downloadBtn.className = 'export-action';
  const shareBtn = document.createElement('button');
  shareBtn.type = 'button';
  shareBtn.className = 'export-action';
  shareBtn.addEventListener('click', () => void deliver('share'));
  resultRow.append(downloadBtn, shareBtn);
  panel.appendChild(resultRow);

  let downloadProbeSeq = 0;

  function logDownloadProbe(kind: string, event?: PointerEvent | MouseEvent): void {
    if (kind === 'pointerdown' || downloadProbeSeq === 0) downloadProbeSeq += 1;
    const result = lastResult;
    const rect = downloadBtn.getBoundingClientRect();
    const eventBits = event
      ? ` pointer=${'pointerType' in event ? event.pointerType : 'mouse'} button=${event.button} ` +
        `client=${Math.round(event.clientX)},${Math.round(event.clientY)}`
      : '';
    console.info(
      `[export-download] #${downloadProbeSeq} ${kind}` +
        ` hasResult=${result ? 'yes' : 'no'}` +
        ` resultValid=${resultValid}` +
        ` delivering=${delivering}` +
        ` disabled=${downloadBtn.disabled}` +
        ` rowDisplay=${getComputedStyle(resultRow).display}` +
        ` blob=${result ? describeBlob(result) : 'n/a'}` +
        ` rect=${Math.round(rect.left)},${Math.round(rect.top)},${Math.round(rect.width)}×${Math.round(rect.height)}` +
        eventBits,
    );
  }

  downloadBtn.addEventListener('pointerdown', (event) => logDownloadProbe('pointerdown', event));
  downloadBtn.addEventListener('click', (event) => {
    logDownloadProbe('click', event);
    void deliver('download');
  });

  // Download/share with an explicit busy state — the op (esp. the share sheet) can lag, and
  // without feedback it feels unresponsive and invites repeat taps. Guard against re-entry.
  async function deliver(action: 'download' | 'share'): Promise<void> {
    const isDownload = action === 'download';
    if (isDownload) logDownloadProbe('deliver-request');
    if (!lastResult || delivering) {
      if (isDownload) logDownloadProbe('deliver-blocked');
      return;
    }
    delivering = true;
    resultRow.classList.add('is-busy');
    downloadBtn.disabled = true;
    shareBtn.disabled = true;
    try {
      if (isDownload) {
        logDownloadProbe('deliver-start');
        downloadFile(lastResult, 'button');
      } else {
        await shareFile(lastResult);
      }
    } finally {
      delivering = false;
      resultRow.classList.remove('is-busy');
      downloadBtn.disabled = false;
      shareBtn.disabled = false;
      if (isDownload) logDownloadProbe('deliver-end');
    }
  }

  // Generate is disabled while generating, while a download/share runs, and AFTER a
  // successful generation until something changes (invalidateResult flips resultValid).
  function refreshGenerateBtn(): void {
    if (generating) {
      generateBtn.disabled = true;
      return;
    }
    const hasIncluded = deps.recorder.list().some((s) => s.included);
    generateBtn.disabled = resultValid || !hasIncluded;
    generateBtn.textContent = resultValid ? t().generated : t().generateVideo;
  }

  function invalidateResult(): void {
    lastResult = null;
    resultValid = false; // params/order/inclusion changed → allow a fresh generation
    resultRow.style.display = 'none';
    refreshGenerateBtn();
  }

  function setProgress(p: number): void {
    progressBar.style.width = `${Math.round(Math.min(1, Math.max(0, p)) * 100)}%`;
  }

  // Keep `order` in sync with the recorder: drop gone clips, append new ones at the end.
  function reconcile(seqs: Sequence[]): void {
    const ids = new Set(seqs.map((s) => s.id));
    for (const [id, url] of previewUrls) {
      if (!ids.has(id)) {
        URL.revokeObjectURL(url);
        previewUrls.delete(id);
      }
    }
    const prevLen = order.length;
    order = order.filter((id) => ids.has(id));
    let changed = order.length !== prevLen; // a clip was removed
    for (const s of seqs)
      if (!order.includes(s.id)) {
        order.push(s.id);
        changed = true; // a new clip appeared (recorded while the dialog was closed)
      }
    // The exportable set changed → the last generation is stale; re-enable Generate.
    if (changed && resultValid) invalidateResult();
  }

  function orderedSequences(): Sequence[] {
    const byId = new Map(deps.recorder.list().map((s) => [s.id, s]));
    return order.map((id) => byId.get(id)).filter((s): s is Sequence => !!s);
  }

  function updateDurationSummary(ordered = orderedSequences()): void {
    const included = ordered.filter((s) => s.included);
    if (!included.length) {
      durationSummary.style.display = 'none';
      return;
    }
    const clipsSec = included.reduce((sum, seq) => sum + seq.durationUs / 1_000_000, 0);
    const totalSec = clipsSec + Math.max(0, deps.endCardDurationSec);
    durationSummary.textContent = t().exportDuration(formatDuration(totalSec));
    durationSummary.style.display = '';
  }

  function renderGrid(): void {
    const token = ++renderToken;
    const seqs = deps.recorder.list();
    reconcile(seqs);
    const ordered = orderedSequences();
    list.replaceChildren();
    empty.style.display = seqs.length ? 'none' : '';
    list.appendChild(dropBar); // absolute child, hidden until a drag
    const disposable = deps.recorder.disposableCount();
    removeUnusedLabel.textContent = t().clearUnkeptLabel(disposable);
    curationRow.style.display = disposable > 0 ? '' : 'none';
    updateDurationSummary(ordered);
    refreshGenerateBtn();

    let i = 0;
    const appendRows = (): void => {
      if (token !== renderToken) return;
      const frag = document.createDocumentFragment();
      const end = Math.min(ordered.length, i + ROWS_PER_FRAME);
      for (; i < end; i++) frag.appendChild(makeRow(ordered[i]));
      list.insertBefore(frag, dropBar);
      if (i < ordered.length) requestAnimationFrame(appendRows);
    };
    appendRows();
  }

  function makeRow(seq: Sequence): HTMLElement {
    const row = document.createElement('div');
    row.className = 'export-row';
    row.dataset.id = String(seq.id);
    row.classList.toggle('is-excluded', !seq.included);

    const handle = document.createElement('div');
    handle.className = 'export-drag';
    handle.textContent = '⠿';
    handle.title = t().dragToReorder;
    handle.addEventListener('pointerdown', (e) => startDrag(e, seq.id));
    row.appendChild(handle);

    const media = document.createElement('div');
    media.className = 'export-row-media';
    const canvas = document.createElement('canvas');
    const h = Math.max(1, Math.round((THUMB_W * seq.height) / seq.width));
    canvas.width = THUMB_W;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.drawImage(seq.thumb, 0, 0, THUMB_W, h);
    media.appendChild(canvas);
    const dur = document.createElement('span');
    dur.className = 'export-thumb-dur';
    dur.textContent = `${(seq.durationUs / 1_000_000).toFixed(1)}s`;
    media.appendChild(dur);
    media.addEventListener('click', () => {
      if (previewId === seq.id) stopPreview();
      else void startPreview(seq, media);
    });
    row.appendChild(media);

    const meta = document.createElement('div');
    meta.className = 'export-row-meta';
    const inc = makeIconToggle(
      'check',
      seq.included ? t().included : t().excluded,
      seq.included,
      (on) => {
        deps.recorder.setIncluded(seq.id, on);
        invalidateResult();
        renderGrid();
      },
    );
    meta.appendChild(inc);

    const keep = makeIconToggle(
      'keep',
      seq.pinned ? t().kept : t().keep,
      seq.pinned,
      (on) => {
        deps.recorder.setPinned(seq.id, on);
        invalidateResult();
        renderGrid();
      },
    );
    meta.appendChild(keep);

    const trash = document.createElement('button');
    trash.type = 'button';
    trash.className = 'export-trash';
    trash.setAttribute('aria-label', t().deleteClip);
    trash.appendChild(makeIcon('trash', 20));
    trash.addEventListener('click', () => {
      void askConfirm(t().deleteClipConfirm).then((ok) => {
        if (!ok) return;
        haptics.impact('medium');
        deps.recorder.remove(seq.id);
        invalidateResult();
        renderGrid();
      });
    });
    meta.appendChild(trash);
    row.appendChild(meta);

    return row;
  }

  // ---- preview --------------------------------------------------------------

  function stopPreview(): void {
    if (previewVideo) {
      previewVideo.pause();
      previewVideo.remove();
      previewVideo = null;
    }
    previewId = null;
  }

  async function startPreview(seq: Sequence, media: HTMLElement): Promise<void> {
    stopPreview();
    previewId = seq.id;
    let url = previewUrls.get(seq.id);
    if (!url) {
      // Building a preview = a full clip encode (so the slowed audio plays in sync). It can
      // take a moment — show a spinner on the thumbnail so it doesn't look frozen.
      media.classList.add('is-loading');
      try {
        // Build a real clip WITH its audio (slow-mo applied) so the preview is faithful —
        // the slowed sound plays in sync with the slowed video. Cached for re-taps.
        const res = await encodeSequences(
          [seq],
          { includeAudio: true, audioMode: 'per-clip', endCard: false },
          () => {},
          (s) => deps.recorder.loadPayload(s.id), // stored clip → load its chunks from disk
        );
        url = URL.createObjectURL(res.blob);
        previewUrls.set(seq.id, url);
      } catch (err) {
        console.error('[export] preview build failed', err);
        if (previewId === seq.id) previewId = null;
        media.classList.remove('is-loading');
        return;
      }
      media.classList.remove('is-loading');
    }
    if (previewId !== seq.id) return; // selection changed while building

    const video = document.createElement('video');
    video.className = 'export-preview-video';
    video.src = url;
    video.playsInline = true;
    video.loop = true;
    media.appendChild(video);
    previewVideo = video;
    // Play with sound (the tap is the user gesture). If autoplay-with-audio is blocked,
    // fall back to muted so the video still plays.
    video.play().catch(() => {
      video.muted = true;
      void video.play().catch((err) => {
        console.warn('[export] preview playback failed', err);
      });
    });
  }

  // ---- drag reorder ---------------------------------------------------------

  // Keep the dragged card under the finger (compensating for auto-scroll), and place the
  // insertion bar at the gap nearest the pointer (measured from each row's mid-height).
  function updateDrop(): void {
    if (!dragRow) return;
    dragRow.style.transform = `translateY(${pointerY - grabPointerY + (list.scrollTop - grabScrollTop)}px)`;
    const rows = [...list.querySelectorAll<HTMLElement>('.export-row')].filter(
      (r) => r !== dragRow,
    );
    let idx = rows.length;
    let beforeEl: HTMLElement | null = null;
    for (let i = 0; i < rows.length; i++) {
      const box = rows[i].getBoundingClientRect();
      if (pointerY < box.top + box.height / 2) {
        idx = i;
        beforeEl = rows[i];
        break;
      }
    }
    dropIndex = idx;
    const last = rows[rows.length - 1];
    dropBar.style.top = `${beforeEl ? beforeEl.offsetTop : last ? last.offsetTop + last.offsetHeight : 0}px`;
    dropBar.style.display = '';
  }

  // Scroll the list when the pointer nears its top/bottom edge (reach off-screen cards).
  function autoScroll(): void {
    if (dragId === null) return;
    const r = list.getBoundingClientRect();
    const EDGE = 56;
    const MAX = 16;
    let dy = 0;
    if (pointerY < r.top + EDGE) dy = -MAX * Math.min(1, (r.top + EDGE - pointerY) / EDGE);
    else if (pointerY > r.bottom - EDGE)
      dy = MAX * Math.min(1, (pointerY - (r.bottom - EDGE)) / EDGE);
    if (dy !== 0) {
      // Bound by the LAYOUT content height, not scrollHeight: the dragged card's
      // transform inflates scrollHeight on Chrome (transformed overflow), which would
      // let the auto-scroll run past the end. offsetTop/Height ignore the transform.
      const rows = list.querySelectorAll<HTMLElement>('.export-row');
      const lastRow = rows[rows.length - 1];
      const contentH = lastRow ? lastRow.offsetTop + lastRow.offsetHeight : 0;
      const max = Math.max(0, contentH - list.clientHeight);
      const next = Math.max(0, Math.min(max, list.scrollTop + dy));
      if (next !== list.scrollTop) {
        list.scrollTop = next;
        updateDrop();
      }
    }
    autoRaf = requestAnimationFrame(autoScroll);
  }

  function startDrag(e: PointerEvent, id: number): void {
    e.preventDefault();
    stopPreview();
    const row = list.querySelector<HTMLElement>(`.export-row[data-id="${id}"]`);
    if (!row) return;
    dragId = id;
    dragRow = row;
    grabPointerY = e.clientY;
    pointerY = e.clientY;
    grabScrollTop = list.scrollTop;
    row.classList.add('is-dragging');
    updateDrop();
    autoRaf = requestAnimationFrame(autoScroll);

    const onMove = (ev: PointerEvent): void => {
      pointerY = ev.clientY;
      updateDrop();
    };
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      cancelAnimationFrame(autoRaf);
      dropBar.style.display = 'none';
      // Reorder: pull the dragged id out, reinsert at the computed slot.
      const without = order.filter((x) => x !== id);
      without.splice(Math.min(dropIndex, without.length), 0, id);
      const changed = without.some((x, i) => x !== order[i]);
      order = without;
      dragId = null;
      dragRow = null;
      if (changed) invalidateResult();
      renderGrid(); // re-lays out in the new order (drops the transform/dragging styles)
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  // ---- generate -------------------------------------------------------------

  async function run(): Promise<void> {
    if (generating || dragId !== null) return;
    stopPreview();
    const included = orderedSequences().filter((s) => s.included);
    if (!included.length) return;
    invalidateResult();
    generating = true;
    generationFailed = false;
    generateBtn.disabled = true;
    generateBtn.textContent = t().generating;
    panel.classList.add('is-busy');
    setProgress(0);
    try {
      const result = await deps.generate(
        included,
        { includeAudio, audioMode, endCard: true },
        setProgress,
      );
      setProgress(1);
      lastResult = result;
      resultValid = true; // a current result exists → Generate stays disabled until a change
      haptics.success(); // two-beat flourish: the video finished rendering
      shareBtn.style.display = canShareFiles() ? '' : 'none';
      resultRow.style.display = 'flex';
    } catch (err) {
      console.error('Export failed', err);
      generationFailed = true;
      generateBtn.textContent = t().failedRetry;
    } finally {
      generating = false;
      panel.classList.remove('is-busy');
      if (generationFailed) {
        generateBtn.disabled = false; // let the user retry
      } else {
        refreshGenerateBtn(); // success → "Generated ✓" + disabled (resultValid)
      }
      window.setTimeout(() => {
        if (generating) return;
        if (generationFailed) {
          generationFailed = false;
          refreshGenerateBtn(); // clear the retry label back to the normal state
        }
        setProgress(0);
      }, 1800);
    }
  }

  function renderLocale(): void {
    closeBtn.setAttribute('aria-label', common().close);
    closeBtn.title = common().close;
    title.textContent = t().title;
    empty.textContent = t().empty;
    for (const m of modeButtons) {
      m.el.textContent = m.mode === 'per-clip' ? t().synced : t().continuous;
      m.el.title = m.mode === 'per-clip' ? t().syncedTitle : t().continuousTitle;
    }
    soundToggle.setAttribute('aria-label', t().includeSound);
    if (soundLabel) soundLabel.textContent = t().sound;
    confirmCancel.textContent = common().cancel;
    confirmOk.textContent = common().delete;
    downloadBtn.textContent = common().download;
    shareBtn.textContent = common().share;
    if (generationFailed) generateBtn.textContent = t().failedRetry;
    else if (generating) generateBtn.textContent = t().generating;
    else refreshGenerateBtn();
    if (overlay.classList.contains('is-open')) renderGrid();
  }

  function open(): void {
    deps.onOpen(); // pauses the live render → the grid build below has the GPU to itself
    console.info(`[export] open clips=${deps.recorder.list().length}`);
    renderGrid();
    overlay.classList.add('is-open');
  }
  function close(): void {
    renderToken++;
    stopPreview();
    endConfirm(false); // drop any pending confirm so it doesn't reappear on reopen
    overlay.classList.remove('is-open');
    deps.onClose();
  }

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  // Esc closes the dialog (when open).
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && overlay.classList.contains('is-open')) {
      e.preventDefault();
      close();
    }
  };
  window.addEventListener('keydown', onKey);
  const offLocale = onLocaleChange(renderLocale);
  renderLocale();

  parent.appendChild(overlay);

  return {
    open,
    close,
    refresh: () => {
      if (overlay.classList.contains('is-open')) renderGrid();
    },
    destroy: () => {
      stopPreview();
      offLocale();
      window.removeEventListener('keydown', onKey);
      for (const url of previewUrls.values()) URL.revokeObjectURL(url);
      previewUrls.clear();
      overlay.remove();
    },
  };
}
