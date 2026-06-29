// Transient zoom from pinch (mobile) or wheel/trackpad (desktop). The zoom is
// clamped to a max level and SPRINGS BACK to 1 (the original framing) when the
// gesture is released — a "peek" zoom, not a persistent one. Applied as an FOV
// scale in WebGPUContext, so it works in every camera mode (orbit/follow/trail).
//
// Also locks the browser's own pinch/ctrl-wheel zoom (the viewport meta disables
// user scaling, but iOS Safari ignores that — so we preventDefault the gesture*
// and pinch touchmove / wheel events too).

import { haptics } from '../haptics.ts';

const MAX_ZOOM = 3; // how far in the peek goes ("un certain level")
const EASE = 0.18; // current → target per frame (smooth follow)
const RETURN = 0.045; // target → 1 per frame when released (smooth spring-back)
const WHEEL_SENS = 0.0018; // zoom per wheel delta unit

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function touchDist(a: Touch, b: Touch): number {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

export class ZoomControl {
  private target = 1;
  private current = 1;
  private pinching = false;
  private pinchStartDist = 1;

  constructor(private readonly el: HTMLElement) {
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('touchstart', this.onTouchStart, { passive: false });
    el.addEventListener('touchmove', this.onTouchMove, { passive: false });
    el.addEventListener('touchend', this.onTouchEnd, { passive: false });
    el.addEventListener('touchcancel', this.onTouchEnd, { passive: false });
    // Safari's page-pinch gestures (iOS ignores user-scalable=no) — block globally.
    window.addEventListener('gesturestart', this.preventGesture, { passive: false });
    window.addEventListener('gesturechange', this.preventGesture, { passive: false });
    window.addEventListener('gestureend', this.preventGesture, { passive: false });
  }

  // 1 = no zoom (origin), up to MAX_ZOOM. Read once per frame by App → gpu.zoom.
  get value(): number {
    return this.current;
  }

  // Ease toward the target; when no pinch is active, the target itself decays back
  // to 1 so the view smoothly returns to its original framing.
  update(): void {
    if (!this.pinching) {
      this.target += (1 - this.target) * RETURN;
    }
    this.current += (this.target - this.current) * EASE;
  }

  destroy(): void {
    this.el.removeEventListener('wheel', this.onWheel);
    this.el.removeEventListener('touchstart', this.onTouchStart);
    this.el.removeEventListener('touchmove', this.onTouchMove);
    this.el.removeEventListener('touchend', this.onTouchEnd);
    this.el.removeEventListener('touchcancel', this.onTouchEnd);
    window.removeEventListener('gesturestart', this.preventGesture);
    window.removeEventListener('gesturechange', this.preventGesture);
    window.removeEventListener('gestureend', this.preventGesture);
  }

  private readonly onWheel = (e: WheelEvent): void => {
    // preventDefault stops page scroll AND the desktop ctrl/⌘-wheel browser zoom.
    e.preventDefault();
    this.target = clamp(this.target - e.deltaY * WHEEL_SENS, 1, MAX_ZOOM);
  };

  private readonly onTouchStart = (e: TouchEvent): void => {
    if (e.touches.length === 2) {
      if (!this.pinching) haptics.tap(); // tick as the pinch begins
      this.pinching = true;
      this.pinchStartDist = Math.max(touchDist(e.touches[0], e.touches[1]), 1);
      e.preventDefault();
    }
  };

  private readonly onTouchMove = (e: TouchEvent): void => {
    if (this.pinching && e.touches.length === 2) {
      e.preventDefault();
      const ratio = touchDist(e.touches[0], e.touches[1]) / this.pinchStartDist;
      this.target = clamp(ratio, 1, MAX_ZOOM); // spread = zoom in; pinch in clamps to origin
    }
  };

  private readonly onTouchEnd = (e: TouchEvent): void => {
    // A finger lifted: end the pinch so the view springs back to its origin.
    if (e.touches.length < 2) this.pinching = false;
  };

  private readonly preventGesture = (e: Event): void => {
    e.preventDefault();
  };
}
