// UiShell: keeps the on-screen controls hidden until the user reaches for them, then
// auto-hides after a spell of inactivity — the art owns the screen, the controls are
// there the instant you tap. Toggles `.ui-revealed` on the UI root; CSS fades the
// controls in/out (see styles.css). A tap/click anywhere reveals + re-arms the idle
// timer; plain mouse movement does NOT reveal them (on desktop that would pop the
// controls up on every idle hover).

export interface UiShell {
  reveal: () => void;
  destroy: () => void;
}

export function mountUiShell(uiRoot: HTMLElement, idleMs = 3000): UiShell {
  let timer: number | undefined;

  const hide = (): void => uiRoot.classList.remove('ui-revealed');

  const reveal = (): void => {
    uiRoot.classList.add('ui-revealed');
    if (timer !== undefined) window.clearTimeout(timer);
    timer = window.setTimeout(hide, idleMs);
  };

  // Capture phase so it fires even if a control stops propagation. A tap/click reveals
  // immediately; the controls then fade once you go still. Mouse movement alone never
  // reveals them — the art keeps the screen until you actually reach for a control.
  const onDown = (): void => reveal();
  window.addEventListener('pointerdown', onDown, true);

  reveal(); // show briefly on entry, then fade

  return {
    reveal,
    destroy: () => {
      if (timer !== undefined) window.clearTimeout(timer);
      window.removeEventListener('pointerdown', onDown, true);
    },
  };
}
