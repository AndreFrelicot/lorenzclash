// Pointer-drag input on the canvas (unifies mouse / touch / stylus via Pointer
// Events). A deliberate drag contributes a normalized tilt that feeds the Lorenz
// hub (and the deformation grid) — the always-available motion control. The
// contribution DECAYS back to 0 when not dragging, so it's a gesture, not a sticky
// setting.

// Normalized drag tilt fed to the Lorenz hub / grid.
export interface MotionTilt {
  tiltX: number;
  tiltY: number;
  twist: number;
}

const DECAY = 0.9; // per-frame ease back toward 0 when not dragging

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export class TouchInput {
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private dx = 0; // accumulated drag since the last consumeDelta()
  private dy = 0;
  private startX = 0;
  private startY = 0;
  private pull = 0; // 0..1: drag displacement from the start → slow-mo engagement
  private readonly active = new Set<number>(); // live pointers on the canvas

  // Integrated, normalized tilt from the drag (read() accumulates + decays it).
  private tiltX = 0;
  private tiltY = 0;
  // Reused result for read() — the caller consumes it immediately (no per-frame alloc).
  private readonly tilt: MotionTilt = { tiltX: 0, tiltY: 0, twist: 0 };

  constructor(private readonly target: HTMLElement) {
    target.addEventListener('pointerdown', this.onDown);
    target.addEventListener('pointermove', this.onMove);
    // Listen on window for up/cancel so a release outside the canvas still ends
    // the drag.
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
  }

  private readonly onDown = (e: PointerEvent): void => {
    this.active.add(e.pointerId);
    // 2+ pointers = a pinch (zoom, handled by ZoomControl) → not a slow-mo/tilt drag.
    if (this.active.size > 1) {
      this.dragging = false;
      this.pull = 0;
      return;
    }
    this.dragging = true;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.startX = e.clientX;
    this.startY = e.clientY;
    this.pull = 0;
  };

  private readonly onMove = (e: PointerEvent): void => {
    if (!this.dragging || this.active.size > 1) return;
    this.dx += e.clientX - this.lastX;
    this.dy += e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    // Distance from the drag start → slow-mo depth (full pull ≈ 40% of the height).
    const dist = Math.hypot(e.clientX - this.startX, e.clientY - this.startY);
    this.pull = clamp(dist / Math.max(window.innerHeight * 0.4, 1), 0, 1);
  };

  private readonly onUp = (e: PointerEvent): void => {
    this.active.delete(e.pointerId);
    this.dragging = false;
  };

  // True while a drag is in progress — drives the slow-mo engagement in App.
  get isDragging(): boolean {
    return this.dragging;
  }

  // 0..1: how far the current drag has pulled from its start → slow-mo depth.
  get slowPull(): number {
    return this.pull;
  }

  // Decaying, normalized tilt from the pointer-drag. Horizontal drag → tiltX,
  // vertical drag → tiltY (inverted: drag up tilts forward). While dragging the
  // tilt builds and holds; when released it eases back to 0. Called once per frame;
  // `gain` (tunable DragGain) scales pixels → tilt. twist is currently unused.
  // Consumes the accumulated pixel drag (then resets it) and returns a reused
  // object — valid until the next read().
  read(gain: number): MotionTilt {
    const dx = this.dx;
    const dy = this.dy;
    this.dx = 0;
    this.dy = 0;
    this.tiltX = clamp(this.tiltX + dx * gain, -1, 1);
    this.tiltY = clamp(this.tiltY - dy * gain, -1, 1);
    if (!this.dragging) {
      this.tiltX *= DECAY;
      this.tiltY *= DECAY;
    }
    this.tilt.tiltX = this.tiltX;
    this.tilt.tiltY = this.tiltY;
    return this.tilt;
  }

  destroy(): void {
    this.target.removeEventListener('pointerdown', this.onDown);
    this.target.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointercancel', this.onUp);
  }
}
