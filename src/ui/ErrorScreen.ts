// Non-blocking error overlay with a reload affordance. Used when WebGPU init
// fails or the device is lost unrecoverably.
import { getMessages, onLocaleChange } from '../i18n.ts';

export function mountErrorScreen(root: HTMLElement, message: string, detail?: string): () => void {
  const screen = document.createElement('div');
  screen.className = 'screen';

  const title = document.createElement('h1');
  title.textContent = getMessages().appName;

  const text = document.createElement('p');
  text.textContent = message;

  const reload = document.createElement('button');
  reload.className = 'start-button';
  reload.addEventListener('click', () => location.reload());

  screen.append(title, text);
  // Optional diagnostic line — baked onto the crash screen so a screenshot alone (no remote
  // console needed) reveals what had grown: uptime, canvas MP, fps, encode queue, clips, etc.
  if (detail) {
    const diag = document.createElement('p');
    diag.className = 'error-detail';
    diag.textContent = detail;
    screen.append(diag);
  }
  screen.append(reload);
  root.appendChild(screen);

  const renderLocale = (): void => {
    title.textContent = getMessages().appName;
    reload.textContent = getMessages().common.reload;
  };
  const offLocale = onLocaleChange(renderLocale);
  renderLocale();

  return () => {
    offLocale();
    screen.remove();
  };
}
