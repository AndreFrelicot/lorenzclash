// Minimal, discrete on-screen controls: the artwork owns the screen, controls stay
// out of the way. Icon-only buttons (inline SVG); a transient caption above the bar
// names the action just taken.
// Two "summon" buttons pop the slow-mo/margin faders and the speed pad above the bar
// (App owns those popovers). Visibility of the bar itself is driven by the UiShell.
import { getMessages, onLocaleChange } from '../i18n.ts';
import { makeIcon, type IconName } from './icons.ts';

export interface ControlsState {
  camera: boolean;
  split: boolean; // A = camera / B = synthetic (only meaningful while camera is on)
  follow: number; // 0 orbit, 1/2 follow curve 1/2 head, 3/4 trail curve 1/2
  shape: number; // 0 = plane, 1 = cube, 2 = sphere
  audioMode: number; // 0 = muted, 1 = sound (both analyse)
  trackName: string;
  auto: boolean;
}

export interface ControlsCallbacks {
  onToggleCamera: (on: boolean) => void;
  onToggleSplit: (on: boolean) => void;
  onCycleFollow: () => void;
  onCycleTrail: () => void;
  onCycleShape: () => void;
  onCycleAudio: () => void;
  onCycleTrack: () => void;
  onToggleAuto: (on: boolean) => void;
  onToggleTransport: () => void; // summon the slow-mo + margin faders
  onTogglePad: () => void; // summon the speed pad
  onSnapshot: () => void; // record a 5 s clip of the live view into the export list
  onOpenExport: () => void; // open the export menu
  onHelp: () => void; // open the in-app help / legend overlay
}

export interface ControlsHandle {
  setCamera: (on: boolean) => void;
  setSplit: (on: boolean) => void;
  setSplitAvailable: (on: boolean) => void; // reveal/collapse the Split button
  setFollow: (mode: number, silent?: boolean) => void;
  setShape: (mode: number, silent?: boolean) => void;
  setAudio: (mode: number) => void;
  setTrack: (name: string) => void;
  setAuto: (on: boolean) => void;
  setSnapshotProgress: (p: number) => void; // 0..1 = recording ring, < 0 = idle
  setAutoEnergy: (level: number) => void; // 0..1 live audio level → Auto halo pulse
  announce: (text: string) => void; // show a transient caption (e.g. "storage full")
  destroy: () => void;
}

const AUDIO_ICONS: IconName[] = ['music-muted', 'music'];

function label(button: HTMLButtonElement, text: string): void {
  button.setAttribute('aria-label', text);
  button.title = text;
}

// Small A/B chip above a button (View / Trail) showing the active curve; scales in/out.
// The chip lives inside a pivot wrapper that fills the button, so rotating it by the bar
// angle swings the chip up ALONG the oblique (pivoting on the button centre, not its own).
function makeBadge(parent: HTMLElement): HTMLSpanElement {
  const pivot = document.createElement('span');
  pivot.className = 'ctrl-badge-pivot';
  pivot.setAttribute('aria-hidden', 'true');
  const b = document.createElement('span');
  b.className = 'ctrl-badge';
  b.dir = 'auto';
  pivot.appendChild(b);
  parent.appendChild(pivot);
  return b;
}
function setBadge(badge: HTMLSpanElement, text: string): void {
  badge.textContent = text;
  badge.classList.toggle('show', text !== '');
}

export function mountMinimalControls(
  root: HTMLElement,
  state: ControlsState,
  callbacks: ControlsCallbacks,
): ControlsHandle {
  const t = () => getMessages().controls;
  const bar = document.createElement('div');
  bar.className = 'controls';
  bar.dir = 'ltr';

  // Transient caption above the bar: names the action just taken (icon-only UI).
  const caption = document.createElement('div');
  caption.className = 'action-label';
  caption.dir = 'auto';
  caption.setAttribute('aria-live', 'polite');
  let captionTimer: number | undefined;
  const announce = (text: string): void => {
    caption.textContent = text;
    caption.classList.add('show');
    if (captionTimer !== undefined) window.clearTimeout(captionTimer);
    captionTimer = window.setTimeout(() => caption.classList.remove('show'), 1400);
  };

  const makeButton = (
    icon: IconName,
    text: string,
    onClick: () => void,
    parent: HTMLElement = bar,
  ): HTMLButtonElement => {
    const button = document.createElement('button');
    button.className = 'control-btn';
    button.type = 'button';
    button.appendChild(makeIcon(icon));
    label(button, text);
    button.addEventListener('click', onClick);
    parent.appendChild(button);
    return button;
  };

  // Cycle button: one icon + label per mode; `is-on` when mode != 0. Announces on
  // every change after the initial mount (incl. programmatic, e.g. the auto-director).
  const makeCycle = (
    icons: IconName[],
    labels: () => string[],
    initial: number,
    onCycle: () => void,
    parent: HTMLElement = bar,
    badgeLabels?: () => string[], // optional A/B-style chip per mode ('' = hidden), e.g. Shape names
  ): ((mode: number, silent?: boolean) => void) => {
    const initialLabels = labels();
    const button = makeButton(
      icons[initial] ?? icons[0],
      initialLabels[initial] ?? initialLabels[0],
      onCycle,
      parent,
    );
    const badge = badgeLabels ? makeBadge(button) : null;
    let inited = false;
    let currentMode = initial;
    // `silent` suppresses the caption for non-user (auto-director) changes.
    const set = (mode: number, silent = false): void => {
      currentMode = mode;
      button.classList.toggle('is-on', mode !== 0);
      // Swap only the icon (keep any badge child): remove the old <svg>, prepend the new.
      button.querySelector('.ui-icon')?.remove();
      button.insertBefore(makeIcon(icons[mode] ?? icons[0]), button.firstChild);
      const currentLabels = labels();
      const text = currentLabels[mode] ?? currentLabels[0];
      label(button, text);
      if (badge && badgeLabels) {
        const currentBadgeLabels = badgeLabels();
        setBadge(badge, currentBadgeLabels[mode] ?? '');
      }
      if (inited && !silent) announce(text);
    };
    set(initial);
    inited = true;
    refreshers.push(() => set(currentMode, true));
    return set;
  };

  const makeToggle = (
    icon: IconName,
    labelOn: () => string,
    labelOff: () => string,
    initial: boolean,
    onToggle: (on: boolean) => void,
    parent: HTMLElement = bar,
  ): { setState: (on: boolean) => void; el: HTMLButtonElement } => {
    const button = makeButton(
      icon,
      initial ? labelOn() : labelOff(),
      () => onToggle(!button.classList.contains('is-on')),
      parent,
    );
    let inited = false;
    let current = initial;
    const setState = (on: boolean, silent = false): void => {
      current = on;
      button.classList.toggle('is-on', on);
      const text = on ? labelOn() : labelOff();
      label(button, text);
      button.setAttribute('aria-pressed', String(on));
      if (inited && !silent) announce(text);
    };
    setState(initial);
    inited = true;
    refreshers.push(() => setState(current, true));
    return { setState, el: button };
  };

  // Four diagonal zones separated by oblique bars (see styles.css). Within a zone, buttons
  // step up to the right; the first one (lowest, largest) is its headline / most-used action.
  const makeZone = (name: string): HTMLDivElement => {
    const z = document.createElement('div');
    z.className = `ctrl-zone is-${name}`;
    bar.appendChild(z);
    return z;
  };
  const addSep = (): void => {
    const s = document.createElement('div');
    s.className = 'ctrl-sep';
    s.setAttribute('aria-hidden', 'true');
    bar.appendChild(s);
  };
  const zAudio = makeZone('audio');
  addSep();
  const zSource = makeZone('source');
  addSep();
  const zView = makeZone('view');
  addSep();
  const zCapture = makeZone('capture');
  const refreshers: Array<() => void> = [];

  // ── Z1 (zAudio) : Shape (hero) · Music · Track ─────────────────────────────
  const setShape = makeCycle(
    ['shape', 'shape', 'shape'],
    () => [...t().shapeLabels],
    state.shape,
    callbacks.onCycleShape,
    zAudio,
    () => [...t().shapeBadges], // chip names Cube/Sphere (Plane = default, no chip)
  );
  const setAudio = makeCycle(
    AUDIO_ICONS,
    () => [...t().audioLabels],
    state.audioMode,
    callbacks.onCycleAudio,
    zAudio,
  );
  const trackBtn = makeButton(
    'track',
    state.trackName || t().trackFallback,
    callbacks.onCycleTrack,
    zAudio,
  );
  let trackInited = false;
  let currentTrackName = state.trackName;
  const setTrack = (name: string, silent = false): void => {
    currentTrackName = name;
    const text = name || t().trackFallback;
    label(trackBtn, text);
    if (trackInited && !silent) announce(text);
  };
  setTrack(state.trackName);
  trackInited = true;
  refreshers.push(() => setTrack(currentTrackName, true));

  // ── Z2 (zSource) : Trail (hero) · Split · Frame margin ─────────────────────
  const trailBtn = makeButton('trail', t().trailOff, callbacks.onCycleTrail, zSource);
  // Split: curve A keeps the camera, curve B shows the synthetic material. Only meaningful
  // while the camera is on — dimmed (kept in place) otherwise so the diagonal stays intact.
  const split = makeToggle(
    'split',
    () => t().splitOn,
    () => t().splitOff,
    state.split,
    callbacks.onToggleSplit,
    zSource,
  );
  const setSplitAvailable = (on: boolean): void => {
    split.el.classList.toggle('is-unavailable', !on);
  };
  setSplitAvailable(state.camera);
  const marginBtn = makeButton('margin', t().frameMargin, callbacks.onToggleTransport, zSource);
  refreshers.push(() => label(marginBtn, t().frameMargin));

  // ── Z3 (zView) : View (hero) · Camera · Speed ──────────────────────────────
  const followBtn = makeButton('view', t().followLabels[0], callbacks.onCycleFollow, zView);
  const camera = makeToggle(
    'camera',
    () => t().cameraOn,
    () => t().cameraOff,
    state.camera,
    callbacks.onToggleCamera,
    zView,
  );
  const speedBtn = makeButton('speed', t().speedPad, callbacks.onTogglePad, zView);
  refreshers.push(() => label(speedBtn, t().speedPad));

  // ── Z4 (zCapture) : Snapshot (hero) · Export · Auto · Help ─────────────────
  const snapshotBtn = makeButton('snapshot', t().snapshot, callbacks.onSnapshot, zCapture);
  refreshers.push(() => label(snapshotBtn, t().snapshot));
  const exportBtn = makeButton('export', t().export, callbacks.onOpenExport, zCapture);
  refreshers.push(() => label(exportBtn, t().export));
  const auto = makeToggle(
    'auto',
    () => t().autoOn,
    () => t().autoOff,
    state.auto,
    callbacks.onToggleAuto,
    zCapture,
  );
  auto.el.classList.add('is-auto'); // music-reactive multicolour halo when on (styles.css)
  const helpBtn = makeButton('help', t().help, callbacks.onHelp, zCapture);
  refreshers.push(() => label(helpBtn, t().help));

  // Follow + Trail share one mode (0-4) via two buttons (now in different zones). A/B chips
  // above each show which curve is followed / trailed (scale in/out from the button centre).
  const followBadge = makeBadge(followBtn);
  const trailBadge = makeBadge(trailBtn);
  let followInited = false;
  let currentFollowMode = state.follow;
  const setFollow = (mode: number, silent = false): void => {
    currentFollowMode = mode;
    const followLabels = t().followLabels;
    followBtn.classList.toggle('is-on', mode === 1 || mode === 2);
    label(followBtn, mode === 1 ? followLabels[1] : mode === 2 ? followLabels[2] : followLabels[0]);
    setBadge(followBadge, mode === 1 ? 'A' : mode === 2 ? 'B' : '');
    trailBtn.classList.toggle('is-on', mode === 3 || mode === 4);
    label(trailBtn, mode === 3 ? followLabels[3] : mode === 4 ? followLabels[4] : t().trailOff);
    setBadge(trailBadge, mode === 3 ? 'A' : mode === 4 ? 'B' : '');
    if (followInited && !silent) announce(followLabels[mode] ?? followLabels[0]);
  };
  setFollow(state.follow);
  followInited = true;
  refreshers.push(() => setFollow(currentFollowMode, true));

  // Recording feedback: a red ring sweeping around the Snapshot button (--rec 0..1).
  let snapRec = false;
  const setSnapshotProgress = (p: number): void => {
    if (p < 0) {
      if (!snapRec) return;
      snapRec = false;
      snapshotBtn.classList.remove('is-recording');
      snapshotBtn.style.removeProperty('--rec');
    } else {
      snapRec = true;
      snapshotBtn.classList.add('is-recording');
      snapshotBtn.style.setProperty('--rec', p.toFixed(3));
    }
  };

  root.append(caption, bar);

  // Same diagonal structure on every device — only the SCALE changes: shrink the whole
  // cluster uniformly so it fits the viewport width. `scrollWidth`/`offsetHeight` are the
  // un-transformed layout box, so applying the scale via transform doesn't feed back. We
  // publish the scaled bar height as `--bar-h` so the caption + summon popovers sit above it.
  const fit = (): void => {
    const natural = bar.scrollWidth || 1;
    const scale = Math.min(1, (window.innerWidth - 20) / natural);
    root.style.setProperty('--ctrl-scale', scale.toFixed(4));
    root.style.setProperty('--bar-h', `${bar.offsetHeight * scale}px`);
  };
  fit();
  const ro = new ResizeObserver(fit);
  ro.observe(bar);
  window.addEventListener('resize', fit);
  const offLocale = onLocaleChange(() => {
    refreshers.forEach((refresh) => refresh());
    fit();
  });

  return {
    setCamera: camera.setState,
    setSplit: split.setState,
    setSplitAvailable,
    setFollow,
    setShape,
    setAudio,
    setTrack,
    setAuto: auto.setState,
    setSnapshotProgress,
    setAutoEnergy: (level: number): void => {
      // Only while Auto is on (its halo is hidden otherwise) — drives the --energy pulse.
      if (!auto.el.classList.contains('is-on')) return;
      auto.el.style.setProperty('--energy', Math.max(0, Math.min(1, level)).toFixed(3));
    },
    announce,
    destroy: () => {
      ro.disconnect();
      offLocale();
      window.removeEventListener('resize', fit);
      if (captionTimer !== undefined) window.clearTimeout(captionTimer);
      caption.remove();
      bar.remove();
    },
  };
}
