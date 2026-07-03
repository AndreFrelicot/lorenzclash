// Square XY pad (bottom-left). X axis → curve A speed, Y axis (up = fast) →
// curve B speed. Unlike the slow-mo fader this is PERSISTENT: the knob stays
// where you drop it — it SETS the speeds, it doesn't peek-and-return. Same
// pointer/glass ergonomics as SlowMoFader. Emits normalized {x, y} in 0..1
// (y: 0 = top) on drag via the onChange callback.

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// Two pointerdowns within this window (ms) count as a double-tap → reset to home.
const DOUBLE_MS = 320;

export class XYPad {
  private xv = 0;
  private yv = 0;
  private dragging = false;
  // "Home" = the canonical/default position (set via setNormalized); a double-tap
  // springs the knob back to it. Last pointerdown time → double-tap detection.
  private homeX = 0;
  private homeY = 0;
  private lastTapTime = 0;

  private readonly root: HTMLElement;
  private readonly knob: HTMLElement;

  constructor(
    parent: HTMLElement,
    private readonly onChange: (x: number, y: number) => void,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'xypad';

    this.knob = document.createElement('div');
    this.knob.className = 'xypad-knob';

    this.root.appendChild(this.knob);
    parent.appendChild(this.root);

    this.root.addEventListener('pointerdown', this.onDown);
    this.root.addEventListener('pointermove', this.onMove);
    this.root.addEventListener('pointerup', this.onUp);
    this.root.addEventListener('pointercancel', this.onUp);
    window.addEventListener('resize', this.invalidateRect);

    this.layoutKnob();
  }

  get x(): number {
    return this.xv;
  }

  get y(): number {
    return this.yv;
  }

  // Position the knob from outside (e.g. to match the current speeds on start so
  // the first touch doesn't jump). Records this as "home" for the double-tap reset.
  // Does NOT fire onChange.
  setNormalized(x: number, y: number): void {
    this.xv = clamp(x, 0, 1);
    this.yv = clamp(y, 0, 1);
    this.homeX = this.xv;
    this.homeY = this.yv;
    this.layoutKnob();
  }

  destroy(): void {
    this.root.removeEventListener('pointerdown', this.onDown);
    this.root.removeEventListener('pointermove', this.onMove);
    this.root.removeEventListener('pointerup', this.onUp);
    this.root.removeEventListener('pointercancel', this.onUp);
    window.removeEventListener('resize', this.invalidateRect);
    this.root.remove();
  }

  // Pad rect cached for the drag (getBoundingClientRect on every pointermove
  // forces layout). Invalidated on resize/orientation change so a layout shift
  // mid-drag falls back to a fresh read, like the old per-move behavior.
  private rect: DOMRect | null = null;
  private readonly invalidateRect = (): void => {
    this.rect = null;
  };

  private readonly onDown = (e: PointerEvent): void => {
    const now = performance.now();
    // Double-tap anywhere on the pad → spring back to the default position.
    if (now - this.lastTapTime < DOUBLE_MS) {
      this.lastTapTime = 0;
      this.resetToHome();
      return;
    }
    this.lastTapTime = now;
    this.dragging = true;
    this.rect = this.root.getBoundingClientRect();
    this.root.setPointerCapture(e.pointerId);
    this.setFromPointer(e);
  };

  // Snap the knob to home (the default) and emit it so the speeds resync.
  private resetToHome(): void {
    this.dragging = false;
    this.xv = this.homeX;
    this.yv = this.homeY;
    this.layoutKnob();
    this.onChange(this.xv, this.yv);
  }

  private readonly onMove = (e: PointerEvent): void => {
    if (this.dragging) this.setFromPointer(e);
  };

  private readonly onUp = (e: PointerEvent): void => {
    this.dragging = false;
    if (this.root.hasPointerCapture(e.pointerId)) this.root.releasePointerCapture(e.pointerId);
  };

  private setFromPointer(e: PointerEvent): void {
    const rect = this.rect ?? this.root.getBoundingClientRect();
    this.xv = clamp((e.clientX - rect.left) / Math.max(rect.width, 1), 0, 1);
    this.yv = clamp((e.clientY - rect.top) / Math.max(rect.height, 1), 0, 1);
    this.layoutKnob();
    this.onChange(this.xv, this.yv);
  }

  // Place the knob at (xv, yv) within the pad.
  private layoutKnob(): void {
    this.knob.style.left = `${this.xv * 100}%`;
    this.knob.style.top = `${this.yv * 100}%`;
  }
}
