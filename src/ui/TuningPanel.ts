// Live tuning panel: a collapsible "Tune" stack of collapsible categories, each a
// labelled group of sliders bound to a getter/setter. A dev tool (could later be
// gated behind the debug option).

export interface SliderSpec {
  label: string;
  min: number;
  max: number;
  step: number;
  get: () => number;
  set: (value: number) => void;
  // When false, the setter fires on release (change) instead of continuously
  // (input) — for expensive setters like GPU buffer reallocation. The displayed
  // value still tracks the drag live. Default true.
  continuous?: boolean;
}

// An action button rendered after a group's sliders (e.g. "fire this effect now").
export interface ButtonSpec {
  label: string;
  onClick: () => void;
  haptic?: 'light' | 'medium' | 'heavy'; // stronger press feedback (default: light tap)
}

export interface SliderGroup {
  title: string;
  sliders: SliderSpec[];
  buttons?: ButtonSpec[];
  collapsed?: boolean; // default true
}

// A 0/1 step-1 spec is really a boolean → render a checkbox instead of a slider.
function isBoolean(spec: SliderSpec): boolean {
  return spec.min === 0 && spec.max === 1 && spec.step === 1;
}

function buildCheckboxRow(spec: SliderSpec): HTMLElement {
  const row = document.createElement('label');
  row.className = 'tuning-row tuning-row-check';

  const name = document.createElement('span');
  name.className = 'tuning-label';
  name.textContent = spec.label;

  const check = document.createElement('input');
  check.type = 'checkbox';
  check.className = 'tuning-check';
  check.checked = spec.get() >= 0.5;
  check.addEventListener('change', () => spec.set(check.checked ? 1 : 0));

  row.append(name, check);
  return row;
}

function buildRow(spec: SliderSpec): HTMLElement {
  if (isBoolean(spec)) return buildCheckboxRow(spec);

  const row = document.createElement('label');
  row.className = 'tuning-row';

  const name = document.createElement('span');
  name.className = 'tuning-label';
  name.textContent = spec.label;

  const value = document.createElement('span');
  value.className = 'tuning-value';
  value.textContent = spec.get().toFixed(2);

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = String(spec.min);
  slider.max = String(spec.max);
  slider.step = String(spec.step);
  slider.value = String(spec.get());
  slider.addEventListener('input', () => {
    const v = Number(slider.value);
    value.textContent = v.toFixed(2);
    if (spec.continuous !== false) spec.set(v);
  });
  // Heavy setters opt out of live updates and commit once on release.
  if (spec.continuous === false) {
    slider.addEventListener('change', () => spec.set(Number(slider.value)));
  }

  row.append(name, slider, value);
  return row;
}

// A collapsible header bound to a panel element: toggles `is-collapsed` and keeps
// the ▸/▾ marker in sync.
function makeToggle(target: HTMLElement, button: HTMLElement, label: string): () => void {
  const render = (): void => {
    const collapsed = target.classList.contains('is-collapsed');
    button.textContent = `${collapsed ? '▸' : '▾'} ${label}`;
    button.setAttribute('aria-expanded', String(!collapsed));
  };
  button.addEventListener('click', () => {
    target.classList.toggle('is-collapsed');
    render();
  });
  render();
  return render;
}

export interface TuningHandle {
  destroy: () => void;
  reveal: (open?: boolean) => void; // hidden until unlocked, optionally opened immediately
  toggle: () => void;
}

export function mountTuningPanel(root: HTMLElement, groups: SliderGroup[]): TuningHandle {
  const panel = document.createElement('div');
  // Hidden by default — revealed only via the legend's secret gesture-page code.
  panel.className = 'tuning is-collapsed is-hidden';

  const header = document.createElement('button');
  header.className = 'tuning-toggle';
  header.type = 'button';

  const body = document.createElement('div');
  body.className = 'tuning-body';

  const renderPanelToggle = makeToggle(panel, header, 'Tune');

  for (const group of groups) {
    const section = document.createElement('div');
    section.className = 'tuning-group';
    if (group.collapsed !== false) section.classList.add('is-collapsed');

    const groupHeader = document.createElement('button');
    groupHeader.className = 'tuning-group-toggle';
    groupHeader.type = 'button';

    const groupBody = document.createElement('div');
    groupBody.className = 'tuning-group-body';
    for (const spec of group.sliders) groupBody.appendChild(buildRow(spec));
    for (const spec of group.buttons ?? []) {
      const btn = document.createElement('button');
      btn.className = 'tuning-btn';
      btn.type = 'button';
      btn.textContent = spec.label;
      if (spec.haptic) btn.dataset.haptic = spec.haptic;
      btn.addEventListener('click', spec.onClick);
      groupBody.appendChild(btn);
    }

    makeToggle(section, groupHeader, group.title);
    section.append(groupHeader, groupBody);
    body.appendChild(section);
  }

  panel.append(header, body);
  root.appendChild(panel);
  return {
    destroy: () => panel.remove(),
    reveal: (open = false) => {
      panel.classList.remove('is-hidden');
      if (open) {
        panel.classList.remove('is-collapsed');
        renderPanelToggle();
      }
    },
    toggle: () => {
      panel.classList.toggle('is-hidden');
    },
  };
}
