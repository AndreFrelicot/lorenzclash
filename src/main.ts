// Self-hosted type (fontsource — no external CDN, ships from node_modules and is
// lazy-loaded per unicode-range). Space Grotesk = UI/display, Space Mono =
// technical readouts. Demoscene-bold type system lives in styles.css.
import '@fontsource/space-grotesk/400.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/600.css';
import '@fontsource/space-grotesk/700.css';
import '@fontsource/space-mono/400.css';
import '@fontsource/space-mono/700.css';
import './styles.css';
import { App } from './app/App.ts';
import { haptics } from './haptics.ts';
import { mountErrorScreen } from './ui/ErrorScreen.ts';

const canvas = document.querySelector<HTMLCanvasElement>('#gpu-canvas');
const uiRoot = document.querySelector<HTMLElement>('#ui-root');

if (!canvas || !uiRoot) {
  throw new Error('Missing #gpu-canvas or #ui-root in index.html');
}

// Surface any uncaught error on screen — invaluable when debugging on a phone
// where the console isn't readily accessible (turns a black screen into text).
const showFatal = (label: string, detail: unknown): void => {
  const message = detail instanceof Error ? `${detail.name}: ${detail.message}` : String(detail);
  console.error(label, detail);
  mountErrorScreen(uiRoot, `${label} ${message}`);
};
// Only surface REAL same-origin app errors as the fatal screen. Cross-origin scripts
// (the Umami analytics script, a Safari/Chrome extension injected into the page) report a
// detail-less "Script error." with NO Error object — and failed resource loads arrive
// error-less too. Ignore those: a third-party script must never be able to replace the
// whole app with the error screen.
window.addEventListener('error', (e) => {
  if (!e.error) return;
  showFatal('Error:', e.error);
});
window.addEventListener('unhandledrejection', (e) => showFatal('Unhandled rejection:', e.reason));

const app = new App(canvas, uiRoot);
app.start().catch((err: unknown) => showFatal('Failed to start the app:', err));

// Tactile feedback on every button press, app-wide (Android only — a no-op elsewhere).
// One delegated listener covers all controls, the export sheet, the legend and the start
// screen. A button can override the default light tap with data-haptic="light|medium|heavy"
// for a weightier press, or "off" to stay silent.
window.addEventListener(
  'pointerdown',
  (e) => {
    const btn = (e.target as Element | null)?.closest?.('button');
    if (!btn) return;
    const kind = (btn as HTMLElement).dataset.haptic;
    if (kind === 'off') return;
    if (kind === 'light' || kind === 'medium' || kind === 'heavy') haptics.impact(kind);
    else haptics.tap();
  },
  true,
);

// Installed Android PWAs can still show the system status bar — and a 1px white divider line
// under it — even with `display: fullscreen` in the manifest: Chrome doesn't always honor the
// mode, and an install made before the manifest changed keeps its old (standalone) display
// mode. The reliable cure is the Fullscreen API — requesting it on the first user gesture drops
// the app into true immersive mode (status + nav bars hidden, divider gone). Guarded to
// installed PWAs so a desktop browser tab is never forced fullscreen; the listener removes
// itself once granted so a deliberate swipe-out isn't immediately re-entered. iOS lacks
// Element.requestFullscreen (the `&&` guard skips it) and already handles this via its
// black-translucent status bar.
const isInstalledPWA =
  window.matchMedia('(display-mode: standalone)').matches ||
  window.matchMedia('(display-mode: fullscreen)').matches;
if (isInstalledPWA && document.documentElement.requestFullscreen) {
  const goImmersive = (): void => {
    if (document.fullscreenElement) return;
    document.documentElement
      .requestFullscreen({ navigationUI: 'hide' })
      .then(() => window.removeEventListener('pointerdown', goImmersive))
      .catch(() => {
        // Rejected (no gesture yet / transient) — harmless; the next pointerdown retries.
      });
  };
  window.addEventListener('pointerdown', goImmersive);
}

// Register the service worker (public/sw.js). It's what lets the app INSTALL as a real PWA
// on Android — Chrome only offers "Install" + a standalone/fullscreen launch (vs a plain
// home-screen shortcut) when a SW with a fetch handler is present on a secure, valid-HTTPS
// origin. Registered after the app boots so it never competes with startup; guarded so it's
// a no-op where service workers aren't available (e.g. http://<LAN-IP> without HTTPS).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err: unknown) => {
      console.warn('[lorenz] service worker registration failed', err);
    });
  });
}
