// In-app help: an animated, paged legend of the controls + credits. Shown by the start
// screen's Help button and the in-experience Help button, so it's mounted once on the UI
// root and shared.
import { getMessages, onLocaleChange, type Translation } from '../i18n.ts';
import { makeIcon, makeLogo, type IconName } from './icons.ts';

interface LegendItem {
  icon: IconName;
  name: string;
  desc: string;
  sep?: boolean;
  section?: string;
}
interface LegendPage {
  id: LegendPageId;
  title: string;
  items: LegendItem[];
  credits?: boolean;
}

export type LegendPageId =
  | 'controls-primary'
  | 'controls-source'
  | 'controls-gesture'
  | 'export-clips'
  | 'export-generate'
  | 'requirements'
  | 'credits';

function buildLegendPages(t: Translation): LegendPage[] {
  const item = t.legend.items;
  return [
    {
      id: 'controls-primary',
      title: t.legend.controlsTitle,
      items: [
        { icon: 'shape', name: item.shapeName, desc: item.shapeDesc },
        { icon: 'trail', name: item.trailName, desc: item.trailDesc },
        { icon: 'view', name: item.viewName, desc: item.viewDesc },
        { icon: 'snapshot', name: item.snapshotName, desc: item.snapshotDesc },
      ],
    },
    {
      id: 'controls-source',
      title: t.legend.controlsTitle,
      items: [
        { icon: 'music', name: item.musicName, desc: item.musicDesc },
        { icon: 'split', name: item.splitName, desc: item.splitDesc },
        { icon: 'camera', name: item.cameraName, desc: item.cameraDesc },
        { icon: 'export', name: item.exportName, desc: item.exportDesc },
      ],
    },
    {
      id: 'controls-gesture',
      title: t.legend.controlsTitle,
      items: [
        { icon: 'track', name: item.trackName, desc: item.trackDesc },
        { icon: 'margin', name: item.frameName, desc: item.frameDesc },
        { icon: 'speed', name: item.speedName, desc: item.speedDesc },
        { icon: 'auto', name: item.autoName, desc: item.autoDesc },
        {
          icon: 'drag',
          name: item.slowmoName,
          desc: item.slowmoDesc,
          section: t.legend.gestureControls,
        },
        { icon: 'zoom', name: item.pinchName, desc: item.pinchDesc },
      ],
    },
    {
      id: 'export-clips',
      title: t.legend.exportClipsTitle,
      items: [
        { icon: 'snapshot', name: item.clipsName, desc: item.clipsDesc },
        { icon: 'check', name: item.includeName, desc: item.includeDesc },
        { icon: 'keep', name: item.keepName, desc: item.keepDesc },
        { icon: 'trash', name: item.deleteName, desc: item.deleteDesc },
      ],
    },
    {
      id: 'export-generate',
      title: t.legend.exportTitle,
      items: [
        { icon: 'sound', name: item.soundName, desc: item.soundDesc },
        { icon: 'export', name: item.generateName, desc: item.generateDesc },
        { icon: 'warning', name: item.deviceLimitsName, desc: item.deviceLimitsDesc },
      ],
    },
    {
      id: 'requirements',
      title: t.legend.requirementsTitle,
      items: [
        { icon: 'view', name: item.browserName, desc: item.browserDesc },
        { icon: 'camera', name: item.recommendedName, desc: item.recommendedDesc },
        { icon: 'warning', name: item.olderDevicesName, desc: item.olderDevicesDesc },
      ],
    },
    { id: 'credits', title: t.legend.creditsTitle, items: [], credits: true },
  ];
}

export interface LegendHandle {
  open: (page?: LegendPageId) => void;
  close: () => void;
  destroy: () => void;
}

export function mountLegend(root: HTMLElement, opts: { onUnlock?: () => void } = {}): LegendHandle {
  const legend = document.createElement('div');
  legend.className = 'legend-overlay';

  const legendPanel = document.createElement('div');
  legendPanel.className = 'legend-panel';
  legendPanel.addEventListener('click', (e) => e.stopPropagation());

  const legendTitle = document.createElement('h2');
  legendTitle.className = 'legend-title';
  const legendTitleText = document.createElement('span');
  legendTitle.appendChild(legendTitleText);
  const legendTitleLogo = makeLogo(26);
  legendTitleLogo.classList.add('legend-title-logo');

  const legendClose = document.createElement('button');
  legendClose.type = 'button';
  legendClose.className = 'legend-close';
  legendClose.appendChild(makeIcon('close', 20));

  const pagesHost = document.createElement('div');
  pagesHost.className = 'legend-pages';

  const legendNav = document.createElement('div');
  legendNav.className = 'legend-nav';
  const navPrev = document.createElement('button');
  navPrev.type = 'button';
  navPrev.className = 'legend-arrow';
  navPrev.appendChild(makeIcon('arrow-left', 20));
  const dotsEl = document.createElement('div');
  dotsEl.className = 'legend-dots';
  const navNext = document.createElement('button');
  navNext.type = 'button';
  navNext.className = 'legend-arrow';
  navNext.appendChild(makeIcon('arrow-right', 20));
  legendNav.append(navPrev, dotsEl, navNext);

  legendPanel.append(legendClose, legendTitle, pagesHost, legendNav);
  legend.appendChild(legendPanel);

  let pages = buildLegendPages(getMessages());
  let pageEls: HTMLElement[] = [];
  let dots: HTMLElement[] = [];
  let current = 0;
  let slowmoIcon: HTMLElement | null = null;
  let pinchIcon: HTMLElement | null = null;

  const CODE: Array<'drag' | 'zoom'> = ['drag', 'zoom', 'drag', 'zoom'];
  const CODE_WINDOW = 5000;
  let codeStep = 0;
  let codeStart = 0;

  const popIcon = (el: HTMLElement | null): Promise<void> => {
    if (!el) return Promise.resolve();
    const anim = el.animate(
      [{ transform: 'scale(1)' }, { transform: 'scale(1.7)' }, { transform: 'scale(1)' }],
      { duration: 500, easing: 'ease-in-out' },
    );
    return anim.finished.then(() => undefined).catch(() => undefined);
  };

  const tapCode = (icon: 'drag' | 'zoom'): void => {
    const now = performance.now();
    if (codeStep > 0 && now - codeStart > CODE_WINDOW) codeStep = 0;
    if (icon === CODE[codeStep]) {
      if (codeStep === 0) codeStart = now;
      codeStep += 1;
      if (codeStep === CODE.length) {
        codeStep = 0;
        opts.onUnlock?.();
        void popIcon(slowmoIcon).then(() => popIcon(pinchIcon));
      }
    } else {
      codeStep = icon === CODE[0] ? 1 : 0;
      if (codeStep === 1) codeStart = now;
    }
  };

  const wireCode = (el: HTMLElement | null, icon: 'drag' | 'zoom'): void => {
    if (!el) return;
    el.style.cursor = 'pointer';
    el.addEventListener('click', () => tapCode(icon));
  };

  const makeLegendRow = (item: LegendItem, i: number): HTMLElement => {
    const row = document.createElement('div');
    row.className = 'legend-row';
    if (item.sep) row.classList.add('legend-row-sep');
    row.style.setProperty('--i', String(i));
    const iconWrap = document.createElement('span');
    iconWrap.className = 'legend-icon';
    iconWrap.appendChild(makeIcon(item.icon, 22));
    const txt = document.createElement('div');
    txt.className = 'legend-text';
    const nameEl = document.createElement('strong');
    nameEl.textContent = item.name;
    const descEl = document.createElement('span');
    descEl.textContent = item.desc;
    txt.append(nameEl, descEl);
    row.append(iconWrap, txt);
    if (item.icon === 'drag') {
      slowmoIcon = iconWrap;
      wireCode(slowmoIcon, 'drag');
    } else if (item.icon === 'zoom') {
      pinchIcon = iconWrap;
      wireCode(pinchIcon, 'zoom');
    }
    return row;
  };

  const makeSubtitle = (text: string): HTMLElement => {
    const h = document.createElement('div');
    h.className = 'legend-subtitle';
    h.textContent = text;
    return h;
  };

  const makeCredits = (i: number, withSep: boolean): HTMLElement => {
    const t = getMessages();
    const credits = document.createElement('div');
    credits.className = withSep ? 'legend-credits legend-row-sep' : 'legend-credits';
    credits.style.setProperty('--i', String(i));
    const line1 = document.createElement('span');
    line1.textContent = t.legend.credits.line1;
    const line2 = document.createElement('span');
    line2.textContent = t.legend.credits.line2;
    const link = document.createElement('a');
    link.className = 'legend-link';
    link.href = 'https://andrefrelicot.dev/';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'andrefrelicot.dev';
    const date = document.createElement('span');
    date.textContent = t.legend.credits.date;
    const version = document.createElement('span');
    version.className = 'legend-version';
    version.textContent = `v${__APP_VERSION__}`;
    credits.append(line1, line2, link, date, version);
    return credits;
  };

  const makePrivacy = (i: number): HTMLElement => {
    const t = getMessages();
    const box = document.createElement('div');
    box.className = 'legend-privacy';
    box.style.setProperty('--i', String(i));
    const h = document.createElement('div');
    h.className = 'legend-subtitle';
    h.textContent = t.legend.credits.privacyTitle;
    const l1 = document.createElement('span');
    l1.textContent = t.legend.credits.privacyLine1;
    const l2 = document.createElement('span');
    l2.textContent = t.legend.credits.privacyLine2;
    box.append(h, l1, l2);
    return box;
  };

  const fitLegend = (): void => {
    const margin = 24;
    const fit = Math.min(
      1,
      (window.innerHeight - margin * 2) / legendPanel.offsetHeight,
      (window.innerWidth - margin * 2) / legendPanel.offsetWidth,
    );
    legendPanel.style.setProperty('--fit', fit.toFixed(3));
  };

  function showPage(i: number): void {
    current = Math.max(0, Math.min(pages.length - 1, i));
    pageEls.forEach((el, k) => el.classList.toggle('is-active', k === current));
    legendTitleText.textContent = pages[current].title;
    if (pages[current].credits) legendTitle.appendChild(legendTitleLogo);
    else legendTitleLogo.remove();
    navPrev.classList.toggle('is-hidden', current === 0);
    navNext.classList.toggle('is-hidden', current === pages.length - 1);
    dots.forEach((d, k) => d.classList.toggle('is-active', k === current));
    fitLegend();
  }

  function renderChrome(): void {
    const t = getMessages();
    legendClose.setAttribute('aria-label', t.common.close);
    legendClose.title = t.common.close;
    navPrev.setAttribute('aria-label', t.legend.previousPage);
    navPrev.title = t.legend.previousPage;
    navNext.setAttribute('aria-label', t.legend.nextPage);
    navNext.title = t.legend.nextPage;
  }

  function rebuildPages(): void {
    const previousId = pages[current]?.id;
    pages = buildLegendPages(getMessages());
    slowmoIcon = null;
    pinchIcon = null;
    pageEls = pages.map((page) => {
      const el = document.createElement('div');
      el.className = 'legend-page legend-list';
      page.items.forEach((item, i) => {
        if (item.section) el.appendChild(makeSubtitle(item.section));
        el.appendChild(makeLegendRow(item, i));
      });
      if (page.credits) {
        el.appendChild(makeCredits(page.items.length, page.items.length > 0));
        el.appendChild(makePrivacy(page.items.length + 1));
      }
      return el;
    });
    pagesHost.replaceChildren(...pageEls);
    dotsEl.replaceChildren();
    dots = pages.map(() => {
      const d = document.createElement('span');
      dotsEl.appendChild(d);
      return d;
    });
    const nextIndex = previousId ? pages.findIndex((p) => p.id === previousId) : current;
    showPage(nextIndex >= 0 ? nextIndex : 0);
  }

  navPrev.addEventListener('click', () => showPage(current - 1));
  navNext.addEventListener('click', () => showPage(current + 1));

  let swipeX = 0;
  let swipeY = 0;
  legendPanel.addEventListener(
    'touchstart',
    (e) => {
      swipeX = e.changedTouches[0].clientX;
      swipeY = e.changedTouches[0].clientY;
    },
    { passive: true },
  );
  legendPanel.addEventListener(
    'touchend',
    (e) => {
      const dx = e.changedTouches[0].clientX - swipeX;
      const dy = e.changedTouches[0].clientY - swipeY;
      if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        showPage(current + (dx < 0 ? 1 : -1));
      }
    },
    { passive: true },
  );

  const openLegend = (page?: LegendPageId): void => {
    const index = page ? pages.findIndex((p) => p.id === page) : 0;
    showPage(index >= 0 ? index : 0);
    legend.classList.add('is-open');
  };
  const closeLegend = (): void => legend.classList.remove('is-open');

  const onResize = (): void => {
    if (legend.classList.contains('is-open')) fitLegend();
  };
  window.addEventListener('resize', onResize);

  const onKeyDown = (e: KeyboardEvent): void => {
    if (!legend.classList.contains('is-open')) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      closeLegend();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      showPage(current - 1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      showPage(current + 1);
    }
  };
  window.addEventListener('keydown', onKeyDown);

  const offLocale = onLocaleChange(() => {
    renderChrome();
    rebuildPages();
  });
  legendClose.addEventListener('click', closeLegend);
  legend.addEventListener('click', closeLegend);

  renderChrome();
  rebuildPages();
  root.appendChild(legend);

  return {
    open: openLegend,
    close: closeLegend,
    destroy: () => {
      offLocale();
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKeyDown);
      legend.remove();
    },
  };
}
