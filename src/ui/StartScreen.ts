// Start screen: lets the user choose which layers to enable, then start the
// experience from a user gesture (required for camera permission + audio).
//
// When the camera is enabled we acquire it up front and show a live preview so the
// user can fix a wrong feed orientation BEFORE starting. The preview is rendered
// through the engine's OWN capture path (host.renderCameraPreview) — same camera
// copy/external path and same rotation — so it's WYSIWYG with the ribbon/HD on
// every platform, and the rotation set here is honoured everywhere. The acquired
// CameraInput is handed to onStart so the running app reuses it — no second
// getUserMedia, no flash. A Help button reveals an animated legend of the controls.
import {
  DEFAULT_START_OPTIONS,
  OPTION_START_TRACK_SRC,
  type StartOptions,
} from '../app/AppState.ts';
import { CameraInput } from '../camera/CameraInput.ts';
import { getMessages, onLocaleChange } from '../i18n.ts';
import { mountLanguageSelector } from './LanguageSelector.ts';
import type { LegendPageId } from './LegendOverlay.ts';
import { makeIcon, makeLogo, type IconName } from './icons.ts';

// The slice of WebGPUContext the preview needs: the shared rotation param and the
// GPU preview renderer (camera frame → preview canvas, via the engine's capture).
interface PreviewHost {
  captureParams: { rotation: number; sourceLandscape: boolean };
  renderCameraPreview(video: HTMLVideoElement, canvas: HTMLCanvasElement): boolean;
}

interface OptionToggleSpec {
  key: 'camera' | 'audio';
  labelKey: 'camera' | 'music';
  iconOn: IconName;
  iconOff: IconName;
}

const OPTION_TOGGLES: OptionToggleSpec[] = [
  { key: 'camera', labelKey: 'camera', iconOn: 'camera', iconOff: 'camera' },
  { key: 'audio', labelKey: 'music', iconOn: 'music', iconOff: 'music-muted' },
];

type EmptyTextKey = 'enableCamera' | 'startingCamera' | 'cameraUnavailable';

export function mountStartScreen(
  root: HTMLElement,
  host: PreviewHost,
  onStart: (options: StartOptions, camera: CameraInput | null) => void,
  openHelp: (page?: LegendPageId) => void,
): () => void {
  const options: StartOptions = { ...DEFAULT_START_OPTIONS };
  const t = () => getMessages();

  const screen = document.createElement('div');
  screen.className = 'screen is-start';
  const languageSelector = mountLanguageSelector(root);

  const logo = makeLogo(64);
  logo.classList.add('start-logo');

  const title = document.createElement('h1');
  title.textContent = t().start.title;

  // Two epigraphs that alternate: 1) Lorenz's 1972 talk title (the butterfly effect),
  // 2) Nietzsche. Each settles white, gets briefly "tinted" with the ENTER CHAOS texture,
  // returns to white, then fade-swaps to the other (see styles.css .start-intro).
  let quotes = t().start.quotes;
  let quoteIndex = 0;
  const intro = document.createElement('p');
  intro.className = 'start-intro';
  intro.textContent = quotes[0];
  intro.dataset.text = quotes[0]; // the ::after chaos-tint copy reads this

  // Cycle: hold white → chaos-tint sweep → white → fade-swap to the other quote → repeat.
  // Skipped under reduced motion (a single static quote).
  const introTimers: number[] = [];
  const onIntroAnimEnd = (e: AnimationEvent): void => {
    if (e.animationName !== 'intro-chaos') return;
    intro.classList.remove('is-chaos');
    introTimers.push(
      window.setTimeout(() => {
        intro.classList.add('is-swapping'); // fade out
        introTimers.push(
          window.setTimeout(() => {
            quoteIndex = (quoteIndex + 1) % quotes.length;
            intro.textContent = quotes[quoteIndex];
            intro.dataset.text = quotes[quoteIndex];
            intro.classList.remove('is-swapping'); // fade back in
            introTimers.push(window.setTimeout(() => intro.classList.add('is-chaos'), 2400));
          }, 500),
        );
      }, 1200),
    );
  };
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    intro.addEventListener('animationend', onIntroAnimEnd);
    introTimers.push(window.setTimeout(() => intro.classList.add('is-chaos'), 2600));
  }

  // ── Camera preview ───────────────────────────────────────────────────────
  // Acquired when the camera is enabled; the same CameraInput is reused by the app.
  let camera: CameraInput | null = null;
  let acquiring = false;
  let started = false;

  const preview = document.createElement('div');
  preview.className = 'start-preview';

  // GPU preview canvas: the engine draws the rotated camera frame here each rAF.
  const previewCanvas = document.createElement('canvas');
  previewCanvas.className = 'start-preview-canvas';
  previewCanvas.width = 512;
  previewCanvas.height = 512;

  const empty = document.createElement('div');
  empty.className = 'start-preview-empty';
  const emptyIcon = makeIcon('camera', 30);
  const emptyText = document.createElement('span');
  empty.append(emptyIcon, emptyText);
  let emptyTextKey: EmptyTextKey = 'enableCamera';
  const setEmptyText = (key: EmptyTextKey): void => {
    emptyTextKey = key;
    emptyText.textContent = t().start[key];
  };
  setEmptyText('enableCamera');

  // Rotate the feed 90° at a time — bumps the SAME captureParams.rotation the engine
  // uses, so the next preview frame (and the running artwork) reflect it identically.
  const rotateBtn = document.createElement('button');
  rotateBtn.type = 'button';
  rotateBtn.className = 'start-rotate';
  rotateBtn.appendChild(makeIcon('rotate', 22));

  // Aspect: flip the (unknowable) source buffer orientation. Fixes the stretch — and on
  // Android, also flips the default rotation — when the platform's buffer disagrees with
  // its reported dimensions. One tap, judged from the live preview.
  const aspectBtn = document.createElement('button');
  aspectBtn.type = 'button';
  aspectBtn.className = 'start-aspect';
  aspectBtn.appendChild(makeIcon('aspect', 22));

  preview.append(previewCanvas, empty, rotateBtn, aspectBtn);

  // rAF loop: render the live frame through the engine's capture path until Start.
  let rafId = 0;
  const pump = (): void => {
    rafId = requestAnimationFrame(pump);
    const v = camera?.source ?? null;
    if (v && host.renderCameraPreview(v, previewCanvas)) {
      preview.classList.add('is-live');
    }
  };
  const startPump = (): void => {
    if (!rafId) rafId = requestAnimationFrame(pump);
  };
  const stopPump = (): void => {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  };

  const acquireCamera = async (): Promise<void> => {
    if (camera || acquiring) return;
    acquiring = true;
    setEmptyText('startingCamera');
    try {
      const cam = await CameraInput.create();
      // Toggled back off, or Start was hit, while getUserMedia was in flight →
      // discard so we don't leak an orphan stream (the app acquires its own).
      if (!options.camera || started) {
        cam.destroy();
        return;
      }
      camera = cam;
      startPump();
    } catch (err) {
      console.warn('[lorenz] preview camera unavailable', err);
      camera = null;
      preview.classList.remove('is-live');
      setEmptyText('cameraUnavailable');
    } finally {
      acquiring = false;
    }
  };

  const releaseCamera = (): void => {
    stopPump();
    preview.classList.remove('is-live');
    camera?.destroy();
    camera = null;
  };

  rotateBtn.addEventListener('click', () => {
    host.captureParams.rotation = (Math.round(host.captureParams.rotation) + 1) & 3;
  });
  aspectBtn.addEventListener('click', () => {
    host.captureParams.sourceLandscape = !host.captureParams.sourceLandscape;
  });
  // Tapping the placeholder retries acquisition (covers iOS, where getUserMedia
  // needs a user gesture the initial best-effort attempt may lack).
  empty.addEventListener('click', () => {
    if (options.camera) void acquireCamera();
  });

  // ── Option toggles (icon buttons replacing the checkboxes) ───────────────
  const optionsRow = document.createElement('div');
  optionsRow.className = 'start-toggles';
  const optionRenderers: Array<() => void> = [];

  for (const spec of OPTION_TOGGLES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'start-toggle';
    const text = document.createElement('span');
    const render = (on: boolean): void => {
      const translated = t().start[spec.labelKey];
      text.textContent = translated;
      button.classList.toggle('is-on', on);
      button.setAttribute('aria-pressed', String(on));
      button.setAttribute('aria-label', translated);
      button.replaceChildren(makeIcon(on ? spec.iconOn : spec.iconOff, 22), text);
    };
    render(options[spec.key]);
    optionRenderers.push(() => render(options[spec.key]));
    button.addEventListener('click', () => {
      const on = !button.classList.contains('is-on');
      options[spec.key] = on;
      render(on);
      if (spec.key === 'camera') {
        preview.classList.toggle('is-off', !on);
        if (on) void acquireCamera();
        else releaseCamera();
      }
    });
    optionsRow.appendChild(button);
  }

  // Help (?) sits on the toggles row so Start stays centred alone on its line.
  const helpButton = document.createElement('button');
  helpButton.type = 'button';
  helpButton.className = 'start-help';
  helpButton.appendChild(makeIcon('help', 22));
  optionsRow.appendChild(helpButton);

  // ── Action: Start (centred) ──────────────────────────────────────────────
  const actions = document.createElement('div');
  actions.className = 'start-actions';

  const startButton = document.createElement('button');
  startButton.className = 'start-button start-cta';
  startButton.type = 'button';

  actions.append(startButton);

  // ── Notices marquee ──────────────────────────────────────────────────────
  // A scrolling ticker that alternates the photosensitivity warning with a "use headphones"
  // tip. The track holds two copies of [warning, headphones] so it loops seamlessly (CSS
  // translateX 0 → -50%). The duplicate copy is aria-hidden so it isn't read twice.
  const warning = document.createElement('div');
  warning.className = 'start-warning';
  warning.setAttribute('role', 'note');
  const warningTrack = document.createElement('div');
  warningTrack.className = 'start-warning-track';
  const makeNotice = (icon: IconName, html: string): HTMLElement => {
    const msg = document.createElement('span');
    msg.className = 'start-warning-msg';
    const text = document.createElement('span');
    text.innerHTML = html;
    msg.append(makeIcon(icon, 18), text);
    return msg;
  };
  const renderNotices = (): void => {
    const notices: [IconName, string][] = [
      ['warning', t().start.photosensitivityHtml],
      ['headphones', t().start.headphonesHtml],
    ];
    warningTrack.replaceChildren();
    for (let copy = 0; copy < 2; copy++) {
      for (const [icon, html] of notices) {
        const msg = makeNotice(icon, html);
        if (copy === 1) msg.setAttribute('aria-hidden', 'true'); // loop duplicate
        warningTrack.appendChild(msg);
      }
    }
  };
  renderNotices();
  warning.appendChild(warningTrack);

  // The Help (?) button opens the shared in-app legend (owned by App via mountLegend, so
  // the same overlay also serves the in-scene Help button once the experience is running).
  helpButton.addEventListener('click', () => openHelp());

  startButton.addEventListener('click', (event) => {
    started = true;
    // Stop the preview loop; the CameraInput keeps decoding for the running app.
    stopPump();
    if (!options.camera) releaseCamera();
    onStart(
      {
        ...options,
        initialTrackSrc: event.altKey ? OPTION_START_TRACK_SRC : undefined,
      },
      options.camera ? camera : null,
    );
  });

  // ── Privacy notice ───────────────────────────────────────────────────────
  // Always visible (NOT in the rotating ticker) so it's clear from the home screen:
  // everything runs on the device and nothing is uploaded. Content-focused on purpose;
  // the credits page adds the (anonymous, no-IP) audience-analytics detail.
  const privacy = document.createElement('div');
  privacy.className = 'start-privacy';
  privacy.setAttribute('role', 'note');
  const privacyText = document.createElement('span');
  privacy.append(makeIcon('lock', 16), privacyText);

  const systemLink = document.createElement('button');
  systemLink.type = 'button';
  systemLink.className = 'start-system-link';
  systemLink.addEventListener('click', () => openHelp('requirements'));

  const trust = document.createElement('div');
  trust.className = 'start-trust';
  trust.append(privacy, systemLink);

  const renderLocale = (): void => {
    title.textContent = t().start.title;
    quotes = t().start.quotes;
    quoteIndex = Math.min(quoteIndex, quotes.length - 1);
    intro.textContent = quotes[quoteIndex];
    intro.dataset.text = quotes[quoteIndex];
    emptyText.textContent = t().start[emptyTextKey];
    rotateBtn.setAttribute('aria-label', t().start.rotateCamera);
    rotateBtn.title = t().start.rotateCamera;
    aspectBtn.setAttribute('aria-label', t().start.fixAspect);
    aspectBtn.title = t().start.fixAspect;
    optionRenderers.forEach((render) => render());
    helpButton.setAttribute('aria-label', t().start.help);
    helpButton.title = t().start.help;
    startButton.textContent = t().start.enterChaos;
    privacyText.innerHTML = t().start.privacyHtml;
    systemLink.textContent = t().start.systemRequirements;
    renderNotices();
  };
  const offLocale = onLocaleChange(renderLocale);
  renderLocale();

  screen.append(logo, title, intro, optionsRow, preview, actions, trust, warning);
  // Reflect the initial camera default (preview shown / hidden) before any tap.
  preview.classList.toggle('is-off', !options.camera);
  if (options.camera) void acquireCamera();
  root.appendChild(screen);

  return () => {
    stopPump();
    introTimers.forEach((t) => window.clearTimeout(t));
    intro.removeEventListener('animationend', onIntroAnimEnd);
    offLocale();
    languageSelector.destroy();
    // If torn down without Start (e.g. an error), don't leak the camera the app
    // never took ownership of.
    if (!started) releaseCamera();
    screen.remove();
  };
}
