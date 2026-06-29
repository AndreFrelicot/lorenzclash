// A "comet": a sphere + cube that shoot from a curve's head (age 0) and streak to
// its tail (age 1), spiralling around the curve and shedding a short wake — then
// idle a random gap before the next pass. Pure timing/state (no GPU): exposes the
// current travel `front` (in age space) and whether it's `active`, read by the
// comet shader. One instance per curve so A and B never fire in lockstep. Unlike
// SweepGlow it can also be fired by hand (`launch`), and its cadence/speed are
// driven by live params rather than fixed in-engine constants.

const GAP_MIN = 6.0; // seconds of idle between auto passes (scaled by `period`)
const GAP_MAX = 18.0;
// Travel a little past both ends so the streak eases in/out. Exported so the wake can
// convert "age behind the front" into real seconds (front spans 1+2·MARGIN over `dur`).
export const COMET_MARGIN = 0.08;
const MARGIN = COMET_MARGIN;

const rand = (min: number, max: number): number => min + Math.random() * (max - min);

export class Comet {
  front = 1 + MARGIN; // off-screen (past the tail) at rest
  active = false;

  private timer: number;
  private dur = 2.5;

  // `stagger` offsets the first pass so two curves don't fire together.
  constructor(stagger = 0) {
    this.timer = rand(GAP_MIN, GAP_MAX) + stagger;
  }

  // Fire a single head→tail pass over `duration` seconds (manual or auto trigger).
  launch(duration: number): void {
    this.active = true;
    this.dur = duration;
    this.front = -MARGIN;
  }

  // `enabled` gates the periodic auto-fire; `period` scales the idle gap; `duration`
  // sets the head→tail crossing time. Runs on real dt (independent of scroll speed).
  update(dt: number, enabled: boolean, period: number, duration: number): void {
    if (this.active) {
      this.front += (dt / Math.max(this.dur, 0.1)) * (1 + 2 * MARGIN);
      if (this.front >= 1 + MARGIN) {
        this.active = false;
        this.timer = rand(GAP_MIN, GAP_MAX) * period;
      }
      return;
    }
    if (!enabled) return;
    this.timer -= dt;
    if (this.timer <= 0) this.launch(duration);
  }
}
