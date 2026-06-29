// Debug layer-decomposition: drives a "slideshow" that reveals the render layers
// one at a time — cumulative build-up (fond → +grid → +ribbon → … → +ripple) or in
// isolation (solo) — for capturing pedagogical screenshots. App supplies the
// per-layer on/off setters and a caption sink; this just holds the ordered list +
// the current index.

export interface DebugLayer {
  key: string;
  label: string;
  set: (on: boolean) => void;
}

function clampIndex(n: number, len: number): number {
  if (n < 0) return 0;
  if (n > len - 1) return len - 1;
  return n;
}

export class DebugDecomposer {
  private index = 0;

  constructor(
    private readonly layers: DebugLayer[],
    private readonly onCaption: (text: string) => void,
  ) {}

  // Cumulative: layers [0..n] ON, the rest OFF.
  applyCumulative(n: number): void {
    this.index = clampIndex(n, this.layers.length);
    this.layers.forEach((layer, i) => layer.set(i <= this.index));
    const cur = this.layers[this.index];
    this.onCaption(`${this.index + 1}/${this.layers.length} · +${cur.label}`);
  }

  // Solo: only layer n ON.
  applySolo(n: number): void {
    this.index = clampIndex(n, this.layers.length);
    this.layers.forEach((layer, i) => layer.set(i === this.index));
    const cur = this.layers[this.index];
    this.onCaption(`solo · ${cur.label}`);
  }

  next(solo: boolean): void {
    if (solo) this.applySolo(this.index + 1);
    else this.applyCumulative(this.index + 1);
  }

  prev(solo: boolean): void {
    if (solo) this.applySolo(this.index - 1);
    else this.applyCumulative(this.index - 1);
  }
}
