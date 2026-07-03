// Persistent vertical fader for the global-view auto-frame margin (left edge,
// mirroring the slow-mo fader on the right). Same glass look/ergonomics, but it
// STAYS where dropped (a setting, not a sprung transient): pulling the knob DOWN
// tightens the frame (less margin → fills more), UP loosens it. Lets you tune the
// framing on-screen without the Tune menu. See WebGPUContext.frameParams.margin.

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export class MarginFader {
  private value: number;
  private dragging = false;

  private readonly root: HTMLElement;
  private readonly track: HTMLElement;
  private readonly knob: HTMLElement;

  constructor(
    parent: HTMLElement,
    initial: number,
    private readonly min: number,
    private readonly max: number,
    private readonly onChange: (value: number) => void,
    // Fired when the knob is grabbed / released, so the app can preview the
    // framing in the free-orbit view while dragging and restore the view after.
    private readonly onGrab?: () => void,
    private readonly onRelease?: () => void,
  ) {
    this.value = clamp(initial, min, max);

    this.root = document.createElement('div');
    this.root.className = 'marginfader';

    this.track = document.createElement('div');
    this.track.className = 'marginfader-track';

    this.knob = document.createElement('div');
    this.knob.className = 'marginfader-knob';

    this.track.appendChild(this.knob);
    this.root.appendChild(this.track);
    parent.appendChild(this.root);
    this.layoutKnob();

    this.track.addEventListener('pointerdown', this.onDown);
    this.track.addEventListener('pointermove', this.onMove);
    this.track.addEventListener('pointerup', this.onUp);
    this.track.addEventListener('pointercancel', this.onUp);
    window.addEventListener('resize', this.invalidateRect);
  }

  destroy(): void {
    this.track.removeEventListener('pointerdown', this.onDown);
    this.track.removeEventListener('pointermove', this.onMove);
    this.track.removeEventListener('pointerup', this.onUp);
    this.track.removeEventListener('pointercancel', this.onUp);
    window.removeEventListener('resize', this.invalidateRect);
    this.root.remove();
  }

  // Track rect cached for the drag (getBoundingClientRect on every pointermove
  // forces layout). Invalidated on resize/orientation change so a layout shift
  // mid-drag falls back to a fresh read, like the old per-move behavior.
  private rect: DOMRect | null = null;
  private readonly invalidateRect = (): void => {
    this.rect = null;
  };

  private readonly onDown = (e: PointerEvent): void => {
    this.dragging = true;
    this.rect = this.track.getBoundingClientRect();
    this.track.setPointerCapture(e.pointerId);
    this.onGrab?.();
    this.setFromPointer(e);
  };

  private readonly onMove = (e: PointerEvent): void => {
    if (this.dragging) this.setFromPointer(e);
  };

  private readonly onUp = (e: PointerEvent): void => {
    const wasDragging = this.dragging;
    this.dragging = false;
    if (this.track.hasPointerCapture(e.pointerId)) this.track.releasePointerCapture(e.pointerId);
    if (wasDragging) this.onRelease?.();
  };

  // Pointer Y within the track → fraction 0 (top = max/loose) .. 1 (bottom = min/tight).
  private setFromPointer(e: PointerEvent): void {
    const rect = this.rect ?? this.track.getBoundingClientRect();
    const fraction = clamp((e.clientY - rect.top) / Math.max(rect.height, 1), 0, 1);
    this.value = this.max - fraction * (this.max - this.min);
    this.layoutKnob();
    this.onChange(this.value);
  }

  private layoutKnob(): void {
    const fraction = (this.max - this.value) / (this.max - this.min);
    this.knob.style.top = `${fraction * 100}%`;
  }
}
