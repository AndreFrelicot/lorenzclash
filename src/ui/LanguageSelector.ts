import {
  getLocale,
  getMessages,
  LOCALE_OPTIONS,
  onLocaleChange,
  setLocale,
  type Locale,
} from '../i18n.ts';
import { makeIcon } from './icons.ts';

export interface LanguageSelectorHandle {
  destroy: () => void;
}

const ALPHABETIC_LOCALE_OPTIONS = [...LOCALE_OPTIONS].sort((a, b) =>
  a.label.localeCompare(b.label, 'en', { sensitivity: 'base' }),
);

function orderedLocaleOptions(selected: Locale) {
  const current = ALPHABETIC_LOCALE_OPTIONS.find((opt) => opt.locale === selected);
  if (!current) return ALPHABETIC_LOCALE_OPTIONS;
  return [current, ...ALPHABETIC_LOCALE_OPTIONS.filter((opt) => opt.locale !== selected)];
}

export function mountLanguageSelector(root: HTMLElement): LanguageSelectorHandle {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'lang-button';
  const buttonFlag = document.createElement('span');
  buttonFlag.className = 'lang-button-flag';
  const buttonCode = document.createElement('span');
  buttonCode.className = 'lang-button-code';
  button.append(buttonFlag, buttonCode);

  const overlay = document.createElement('div');
  overlay.className = 'lang-overlay';

  const panel = document.createElement('div');
  panel.className = 'lang-panel';
  panel.addEventListener('click', (e) => e.stopPropagation());
  overlay.appendChild(panel);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'lang-close';
  closeBtn.appendChild(makeIcon('close', 20));

  const title = document.createElement('h2');
  title.className = 'lang-title';
  const subtitle = document.createElement('p');
  subtitle.className = 'lang-subtitle';
  const grid = document.createElement('div');
  grid.className = 'lang-grid';

  const optionButtons = new Map<Locale, HTMLButtonElement>();
  for (const opt of LOCALE_OPTIONS) {
    const optBtn = document.createElement('button');
    optBtn.type = 'button';
    optBtn.className = 'lang-option';
    optBtn.dataset.locale = opt.locale;
    optBtn.setAttribute('aria-pressed', 'false');

    const code = document.createElement('span');
    code.className = 'lang-option-code';
    code.textContent = opt.short;
    const flag = document.createElement('span');
    flag.className = 'lang-option-flag';
    flag.textContent = opt.flag;
    const text = document.createElement('span');
    text.className = 'lang-option-text';
    const native = document.createElement('strong');
    native.textContent = opt.nativeName;
    const label = document.createElement('span');
    label.textContent = opt.label;
    text.append(native, label);

    optBtn.append(code, flag, text);
    optBtn.addEventListener('click', () => {
      setLocale(opt.locale);
      close();
    });
    optionButtons.set(opt.locale, optBtn);
    grid.appendChild(optBtn);
  }

  panel.append(closeBtn, title, subtitle, grid);

  function open(): void {
    overlay.classList.add('is-open');
  }

  function close(): void {
    overlay.classList.remove('is-open');
  }

  function render(): void {
    const locale = getLocale();
    const option = LOCALE_OPTIONS.find((opt) => opt.locale === locale) ?? LOCALE_OPTIONS[0];
    const t = getMessages();
    buttonFlag.textContent = option.flag;
    buttonCode.textContent = option.short;
    button.setAttribute('aria-label', t.language.buttonLabel);
    button.title = t.language.buttonLabel;
    closeBtn.setAttribute('aria-label', t.language.close);
    closeBtn.title = t.common.close;
    title.textContent = t.language.title;
    subtitle.textContent = t.language.subtitle;
    for (const [optLocale, optBtn] of optionButtons) {
      const selected = optLocale === locale;
      optBtn.classList.toggle('is-selected', selected);
      optBtn.setAttribute('aria-pressed', String(selected));
    }
    for (const opt of orderedLocaleOptions(locale)) {
      const optBtn = optionButtons.get(opt.locale);
      if (optBtn) grid.appendChild(optBtn);
    }
  }

  button.addEventListener('click', open);
  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', close);
  const onKey = (e: KeyboardEvent): void => {
    if (!overlay.classList.contains('is-open')) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };
  window.addEventListener('keydown', onKey);

  const offLocale = onLocaleChange(render);
  render();
  root.append(button, overlay);

  return {
    destroy: () => {
      offLocale();
      window.removeEventListener('keydown', onKey);
      button.remove();
      overlay.remove();
    },
  };
}
