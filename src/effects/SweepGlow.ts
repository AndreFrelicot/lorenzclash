// A glowing pulse that rides a curve's age axis from the head (0) to the tail (1),
// then waits a random gap before the next pass — each pass at its own random speed.
// Pure timing/state (no GPU): exposes the current pulse centre (`front`, in age
// space) and whether it's `active`. One instance per curve so A and B never pulse
// in lockstep. Mirrors the shape-morph wave, but slower and self-retriggering.

const GAP_MIN = 3.0; // stars-like idle gap between passes (cf. StillCycle's GAP_*)
const GAP_MAX = 8.0;
const DUR_MIN = 1.5; // seconds for one head→tail sweep — slower than the ~0.8s morph
const DUR_MAX = 3.0;
const MARGIN = 0.25; // travel a little past both ends so the pulse eases in and out

const rand = (min: number, max: number): number => min + Math.random() * (max - min);

export class SweepGlow {
  front = -MARGIN; // pulse centre in age space (only meaningful while active)
  active = false;

  private timer: number;
  private dur = DUR_MIN;

  // `stagger` offsets the first pass so two curves don't fire together.
  constructor(stagger = 0) {
    this.timer = rand(GAP_MIN, GAP_MAX) + stagger;
  }

  update(dt: number): void {
    if (this.active) {
      // Front sweeps from -MARGIN to 1+MARGIN over `dur`, then idles for a new gap.
      this.front += (dt / this.dur) * (1 + 2 * MARGIN);
      if (this.front >= 1 + MARGIN) {
        this.active = false;
        this.timer = rand(GAP_MIN, GAP_MAX);
      }
      return;
    }
    this.timer -= dt;
    if (this.timer <= 0) {
      this.active = true;
      this.dur = rand(DUR_MIN, DUR_MAX);
      this.front = -MARGIN;
    }
  }
}
