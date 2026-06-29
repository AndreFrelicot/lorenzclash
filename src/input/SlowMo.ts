// Slow-mo transport. A drag anywhere on the artwork (not the menu) engages it:
// `value` eases from 1 (normal) down to SLOW_MIN, scaled by how far the drag pulls.
// Releasing springs `value` back up to 1 (with the music). App reads the eased
// `value` once per frame → audio playbackRate (tape-stop) + animation scroll, so
// there are no audio clicks. Replaces the on-screen SlowMoFader (now a gesture).

const SLOW_MIN = 0.35; // slowest warp (matches AudioEngine's playbackRate floor)
const EASE = 0.18; // value → target per frame (smooth follow)
const RETURN = 0.06; // target → 1 per frame when released (smooth spring-back)

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export class SlowMo {
  private target = 1;
  private current = 1;
  private engaged = false;

  // 1 = normal speed, down to SLOW_MIN. Read once per frame by App.
  get value(): number {
    return this.current;
  }

  // How slow-mo'd we currently are, 0 (normal) .. 1 (max) — for driving the visuals.
  get amount(): number {
    return (1 - this.current) / (1 - SLOW_MIN);
  }

  // Engage while dragging; `pull` (0..1) sets how deep the slow-mo goes.
  engage(pull: number): void {
    this.engaged = true;
    this.target = 1 - clamp(pull, 0, 1) * (1 - SLOW_MIN);
  }

  release(): void {
    this.engaged = false;
  }

  update(): void {
    if (!this.engaged) this.target += (1 - this.target) * RETURN;
    this.current += (this.target - this.current) * EASE;
  }
}
