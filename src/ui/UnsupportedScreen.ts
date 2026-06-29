// Shown when WebGPU is unavailable. No WebGL fallback is offered; this is a clear
// dead end with guidance.
import { getMessages, onLocaleChange } from '../i18n.ts';

export function mountUnsupportedScreen(root: HTMLElement): () => void {
  const screen = document.createElement('div');
  screen.className = 'screen';
  const title = document.createElement('h1');
  const text = document.createElement('p');
  screen.append(title, text);
  root.appendChild(screen);

  const renderLocale = (): void => {
    title.textContent = getMessages().appName;
    text.innerHTML = getMessages().unsupported.messageHtml;
  };
  const offLocale = onLocaleChange(renderLocale);
  renderLocale();

  return () => {
    offLocale();
    screen.remove();
  };
}
