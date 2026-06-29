// Tactile feedback for mobile — Android only, by design. It rides the standard Vibration
// API (navigator.vibrate), which iOS Safari does NOT support, so every call is a silent
// no-op on iOS and desktop and callers never need to guard. (Rich iOS haptics are left to
// the native port; the web has no reliable equivalent.) Chrome/Android ignores vibrate()
// until the page has had a user gesture — the app always opens on a tap, so by the time any
// of these fire (including timer-driven auto-director ticks) that activation is in place.

export type ImpactStyle = 'light' | 'medium' | 'heavy';

const canVibrate = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

// Treat the OS "reduce motion" preference as "minimise incidental sensory feedback".
// Read live so toggling it in Settings takes effect without a reload.
const reduceMotion =
  typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

let enabled = true;

function buzz(pattern: number | number[]): void {
  if (!enabled || !canVibrate || reduceMotion?.matches) return;
  // A few engines throw if called without a prior user gesture — swallow it.
  try {
    navigator.vibrate(pattern);
  } catch {
    /* ignore */
  }
}

const IMPACT_MS: Record<ImpactStyle, number> = { light: 10, medium: 18, heavy: 28 };

export const haptics = {
  /** Whether the platform can actually vibrate (Android). */
  get supported(): boolean {
    return canVibrate;
  },
  /** Master switch — for a future settings toggle. */
  setEnabled(on: boolean): void {
    enabled = on;
  },
  /** Crisp tick — UI button presses, gesture entry. */
  tap(): void {
    buzz(8);
  },
  /** Weightier confirmation — comet launch, manual snapshot. */
  impact(style: ImpactStyle = 'medium'): void {
    buzz(IMPACT_MS[style]);
  },
  /** Whisper-light blip — automatic changes (view / shape / track) the user didn't trigger. */
  select(): void {
    buzz(5);
  },
  /** Two-beat flourish — a longer job finished (video export). */
  success(): void {
    buzz([12, 40, 22]);
  },
};
