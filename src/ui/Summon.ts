// A summoned popover: a button shows it, it stays up while the pointer is active
// within it (dragging a fader/pad), and fades out a short while after you let go and
// go idle. Toggles `.is-open` on the element.

export interface Summon {
  open: () => void;
  close: () => void;
  toggle: () => void;
  destroy: () => void;
}

export function mountSummon(el: HTMLElement, idleMs = 2200): Summon {
  let timer: number | undefined;

  const arm = (): void => {
    if (timer !== undefined) window.clearTimeout(timer);
    timer = window.setTimeout(() => el.classList.remove('is-open'), idleMs);
  };

  const open = (): void => {
    el.classList.add('is-open');
    arm();
  };

  const close = (): void => {
    el.classList.remove('is-open');
    if (timer !== undefined) window.clearTimeout(timer);
  };

  const toggle = (): void => {
    if (el.classList.contains('is-open')) el.classList.remove('is-open');
    else open();
  };

  // Pointer activity inside the popover keeps it up (re-arm), so it fades only after
  // the interaction ends + a short idle.
  const onActivity = (): void => {
    if (el.classList.contains('is-open')) arm();
  };
  el.addEventListener('pointerdown', onActivity, true);
  el.addEventListener('pointermove', onActivity, true);

  return {
    open,
    close,
    toggle,
    destroy: () => {
      if (timer !== undefined) window.clearTimeout(timer);
      el.removeEventListener('pointerdown', onActivity, true);
      el.removeEventListener('pointermove', onActivity, true);
    },
  };
}
