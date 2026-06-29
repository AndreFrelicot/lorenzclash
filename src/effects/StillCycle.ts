// Drives the fullscreen "captured still" background effect (no GPU here — pure
// timing/state). Two independent jobs:
//
//  1. Fill a small pool of high-res camera stills on a cadence (round-robin)
//     while the camera is live, so there is always something to show.
//  2. Run the appearance cycle: hidden (stars only) → dissolve in → hold →
//     dissolve out → hidden for a random gap → repeat with a new random still.
//
// Per frame it returns the HD pool slot to capture into (or -1), and exposes the
// current `reveal` (0..1 dissolve progress) and `layer` for the renderer.

const CAPTURE_INTERVAL = 2.0; // seconds between HD captures while the camera is on
const DISSOLVE_DUR = 0.9; // seconds for a dissolve in or out
const HOLD_MIN = 0.6; // short hold — the image flicks through the buffer, not lingers
const HOLD_MAX = 1.4;
const GAP_MIN = 3.0; // "not too short": min stars-only gap between appearances
const GAP_MAX = 8.0; // "not too long": max stars-only gap
const FLIP_INTERVAL = 0.2; // seconds per buffered frame while visible (rapid montage)

type Phase = 'hidden' | 'in' | 'hold' | 'out';

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const rand = (min: number, max: number): number => min + Math.random() * (max - min);

export class StillCycle {
  reveal = 0;
  layer = 0;
  fieldIndex = 0; // which Lorenz butterfly view dissolves this appearance
  hueOffset = 0; // base hue of this appearance (0..1)
  // Pulse flags (true for a single frame) marking the bounds of a visible appearance —
  // the export recorder records the whole stretch in between as one sequence clip.
  sequenceStart = false; // a still begins dissolving in (hidden → in)
  sequenceEnd = false; // it finishes dissolving out (out → hidden)

  private phase: Phase = 'hidden';
  private timer: number;
  private flipTimer = 0; // counts down to the next buffer frame while visible
  private captureTimer = CAPTURE_INTERVAL;
  private nextSlot = 0;
  private captured = 0; // number of pool slots holding a valid frame (0..pool)

  constructor(
    private readonly pool: number,
    private readonly fieldCount: number,
  ) {
    this.timer = rand(GAP_MIN, GAP_MAX);
  }

  // Advance one frame. Returns the HD pool slot to capture into this frame, or
  // -1 if none. `captureActive` gates capturing (no live source → nothing to
  // store): true when the camera is on OR the synthetic source is feeding the pool.
  update(dt: number, captureActive: boolean): number {
    this.timer -= dt;
    this.sequenceStart = false;
    this.sequenceEnd = false;

    switch (this.phase) {
      case 'hidden':
        this.reveal = 0;
        if (this.timer <= 0 && this.captured > 0) {
          this.layer = Math.floor(Math.random() * this.captured);
          this.fieldIndex = Math.floor(Math.random() * this.fieldCount);
          this.hueOffset = Math.random();
          this.flipTimer = FLIP_INTERVAL;
          this.phase = 'in';
          this.timer = DISSOLVE_DUR;
          this.sequenceStart = true; // a new visible sequence begins
        }
        break;
      case 'in':
        this.reveal = clamp01(1 - this.timer / DISSOLVE_DUR);
        if (this.timer <= 0) {
          this.reveal = 1;
          this.phase = 'hold';
          this.timer = rand(HOLD_MIN, HOLD_MAX);
        }
        break;
      case 'hold':
        this.reveal = 1;
        if (this.timer <= 0) {
          this.phase = 'out';
          this.timer = DISSOLVE_DUR;
        }
        break;
      case 'out':
        this.reveal = clamp01(this.timer / DISSOLVE_DUR);
        if (this.timer <= 0) {
          this.reveal = 0;
          this.phase = 'hidden';
          this.timer = rand(GAP_MIN, GAP_MAX);
          this.sequenceEnd = true; // the visible sequence is over
        }
        break;
    }

    // While visible, flick through the buffered frames (~FLIP_INTERVAL each) for
    // a rapid montage — gives rhythm/grain instead of one lingering image.
    if (this.phase !== 'hidden' && this.captured > 1) {
      this.flipTimer -= dt;
      if (this.flipTimer <= 0) {
        this.flipTimer += FLIP_INTERVAL;
        this.layer = (this.layer + 1) % this.captured;
      }
    }

    let captureSlot = -1;
    if (captureActive) {
      this.captureTimer -= dt;
      if (this.captureTimer <= 0) {
        this.captureTimer = CAPTURE_INTERVAL;
        captureSlot = this.nextSlot;
        this.nextSlot = (this.nextSlot + 1) % this.pool;
        if (this.captured < this.pool) this.captured++;
      }
    }
    return captureSlot;
  }
}
