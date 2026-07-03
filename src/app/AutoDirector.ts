// Auto director: watches the live audio and, on a musical section change, switches
// the render preset (camera mode + shape). "Novelty" = how far the short-term sound
// profile (level/bands/centroid) has drifted from the long-term one; a big drift =
// a new section. Switches respect a cooldown, and a max-gap fallback forces a change
// so it never sits still on steady/ambient material. No dependency — it rides the
// FFT features we already compute.
import type { AudioFeatures } from '../audio/AudioEngine.ts';

export interface RenderPreset {
  follow: number; // 0 orbit, 1/2 follow curve 1/2, 3/4 trail curve 1/2
  shape: number; // 0 plane, 1 cube, 2 sphere
}

export interface DirectedRenderPreset extends RenderPreset {
  comet: boolean;
}

export type RhythmCueKind = 'beat' | 'kick' | 'snare' | 'tom' | 'roll';

export interface RhythmCue {
  kind: RhythmCueKind;
  time: number;
  strength: number;
  duration?: number;
  density?: number;
}

export interface TrackDirectorUpdate {
  preset: DirectedRenderPreset | null;
  cues: RhythmCue[];
  role: string | null;
}

export interface TrackStructureAnalysis {
  tracks: TrackStructureTrack[];
}

interface TrackStructureTrack {
  name: string;
  src: string;
  duration: number;
  events?: TrackRhythmEvents;
  sections: TrackStructureSection[];
}

interface TrackRhythmEvents {
  beats?: TrackRhythmPoint[];
  kicks?: TrackRhythmPoint[];
  snares?: TrackRhythmPoint[];
  toms?: TrackRhythmPoint[];
  rolls?: TrackRhythmRoll[];
}

type TrackRhythmPoint = [time: number, strength: number];
type TrackRhythmRoll = [start: number, end: number, density: number, strength: number];

interface TrackStructureSection {
  start: number;
  end: number;
  role?: string;
  director: {
    view: string;
    shape: string;
    comet: boolean;
  };
}

// Curated camera × shape combos the director picks from (avoiding the current one).
const PRESETS: RenderPreset[] = [
  { follow: 0, shape: 0 }, // orbit · plane (the classic)
  { follow: 0, shape: 1 }, // orbit · cube
  { follow: 0, shape: 2 }, // orbit · sphere
  { follow: 1, shape: 0 }, // follow head · plane
  { follow: 2, shape: 0 }, // follow curve 2 · plane
  { follow: 3, shape: 0 }, // trail A · plane (the dissolving tail)
  { follow: 4, shape: 1 }, // trail B · cube
];

const DIM = 5; // level, bass, mid, treble, centroid

// Shared empty cue list for the (common) frames where no rhythm event fired.
const NO_CUES: RhythmCue[] = [];

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// Memoized on the raw src: the per-frame callers always pass the currently
// playing track's src, so the split/regex work runs only on track change.
let lastRawSrc: string | null = null;
let lastNormSrc = '';
function normalizeTrackSrc(src: string): string {
  if (src === lastRawSrc) return lastNormSrc;
  lastRawSrc = src;
  lastNormSrc = src.split('?')[0]?.replace(/^https?:\/\/[^/]+/, '') ?? src;
  return lastNormSrc;
}

function followForView(view: string): number | null {
  switch (view) {
    case 'orbit':
      return 0;
    case 'followA':
      return 1;
    case 'followB':
      return 2;
    case 'tailA':
      return 3;
    case 'tailB':
      return 4;
    default:
      return null;
  }
}

function shapeForName(shape: string): number | null {
  switch (shape) {
    case 'plane':
      return 0;
    case 'cube':
      return 1;
    case 'sphere':
      return 2;
    default:
      return null;
  }
}

export class AutoDirector {
  // Live-tunable. sensitivity: higher = more switches (lower novelty threshold).
  // cooldown: minimum seconds between switches. maxGap: force a switch after this.
  readonly params = { sensitivity: 0.5, cooldown: 8, maxGap: 40 };

  private readonly short = new Float32Array(DIM);
  private readonly long = new Float32Array(DIM);
  private readonly probe = new Float32Array(DIM); // reused per-frame feature vector
  private init = false;
  private since = 0; // seconds since the last switch
  private last = -1; // last preset index (avoid repeating)

  // Restart the analysis (e.g. when auto is toggled on) so it doesn't fire instantly.
  reset(): void {
    this.init = false;
    this.since = 0;
  }

  // Feed one frame; returns a preset to apply when it decides to switch, else null.
  update(dt: number, f: AudioFeatures): RenderPreset | null {
    const p = this.probe; // reused — no per-frame array allocation
    p[0] = f.level;
    p[1] = f.bass;
    p[2] = f.mid;
    p[3] = f.treble;
    p[4] = f.centroid;
    if (!this.init) {
      for (let i = 0; i < DIM; i++) this.short[i] = this.long[i] = p[i];
      this.init = true;
      this.since = 0;
      return null;
    }
    let nov = 0;
    for (let i = 0; i < DIM; i++) {
      this.short[i] += (p[i] - this.short[i]) * 0.06; // ~short-term profile
      this.long[i] += (p[i] - this.long[i]) * 0.008; // ~long-term profile
      const d = this.short[i] - this.long[i];
      nov += d * d;
    }
    nov = Math.sqrt(nov);

    this.since += dt;
    if (this.since < this.params.cooldown) return null;
    const threshold = lerp(0.5, 0.12, this.params.sensitivity);
    if (nov < threshold && this.since < this.params.maxGap) return null;

    // Switch: rebaseline the long-term profile to "now" so it doesn't retrigger on
    // the same section, then pick a different preset.
    this.since = 0;
    for (let i = 0; i < DIM; i++) this.long[i] = this.short[i];
    return this.pick();
  }

  private pick(): RenderPreset {
    let idx = this.last;
    for (let tries = 0; tries < 8 && idx === this.last; tries++) {
      idx = Math.floor(Math.random() * PRESETS.length);
    }
    this.last = idx;
    return PRESETS[idx];
  }
}

// Offline structure director: reads the generated per-track section timeline and
// emits a preset only when playback enters a new analysed section. The classic FFT
// director above is intentionally unchanged; App chooses between the two.
export class TrackStructureDirector {
  private readonly byName = new Map<string, TrackStructureTrack>();
  private readonly bySrc = new Map<string, TrackStructureTrack>();
  private activeTrackKey = '';
  private activeSection = -1;
  private lastPosition = 0;
  private readonly cursors = { beats: 0, kicks: 0, snares: 0, toms: 0, rolls: 0 };
  // 1-entry findTrack memo: App calls hasTrack() + update() (+ durationForTrack)
  // every frame with the same (name, src) — resolve the lookup once per change.
  private memoName: string | null = null;
  private memoSrc: string | null = null;
  private memoTrack: TrackStructureTrack | null = null;

  constructor(analysis: TrackStructureAnalysis) {
    for (const track of analysis.tracks) {
      this.byName.set(track.name, track);
      this.bySrc.set(normalizeTrackSrc(track.src), track);
    }
  }

  reset(): void {
    this.activeTrackKey = '';
    this.activeSection = -1;
    this.lastPosition = 0;
    this.resetCursors();
  }

  hasTrack(name: string, src: string): boolean {
    return this.findTrack(name, src) !== null;
  }

  durationForTrack(name: string, src: string): number | null {
    return this.findTrack(name, src)?.duration ?? null;
  }

  update(name: string, src: string, positionSec: number): TrackDirectorUpdate {
    const track = this.findTrack(name, src);
    if (!track) {
      this.reset();
      return this.fillResult(null, NO_CUES, null);
    }
    const key = track.src || track.name;
    const t = Math.max(0, Math.min(positionSec, track.duration));
    if (key !== this.activeTrackKey) {
      this.activeTrackKey = key;
      this.activeSection = -1;
      this.lastPosition = t;
      this.resetCursors(track, t);
    } else if (t + 0.25 < this.lastPosition) {
      this.lastPosition = t;
      this.activeSection = -1;
      this.resetCursors(track, t);
    }

    const cues = this.collectCues(track, t);
    // Indexed loop (findIndex allocates a closure per frame).
    const sections = track.sections;
    let sectionIndex = -1;
    for (let i = 0; i < sections.length; i++) {
      const s = sections[i]!;
      if (t >= s.start && (t < s.end || i === sections.length - 1)) {
        sectionIndex = i;
        break;
      }
    }
    const role = sectionIndex >= 0 ? (track.sections[sectionIndex]?.role ?? null) : null;
    if (sectionIndex < 0 || sectionIndex === this.activeSection) {
      this.lastPosition = t;
      return this.fillResult(null, cues, role);
    }
    this.activeSection = sectionIndex;

    const director = track.sections[sectionIndex]?.director;
    if (!director) {
      this.lastPosition = t;
      return this.fillResult(null, cues, role);
    }
    const follow = followForView(director.view);
    const shape = shapeForName(director.shape);
    this.lastPosition = t;
    if (follow === null || shape === null) return this.fillResult(null, cues, role);
    // The preset object only allocates on a section change (rare).
    return this.fillResult({ follow, shape, comet: director.comet }, cues, role);
  }

  // Reused result object — App consumes it within the same frame, never retains it.
  private readonly result: TrackDirectorUpdate = { preset: null, cues: NO_CUES, role: null };
  private fillResult(
    preset: DirectedRenderPreset | null,
    cues: RhythmCue[],
    role: string | null,
  ): TrackDirectorUpdate {
    this.result.preset = preset;
    this.result.cues = cues;
    this.result.role = role;
    return this.result;
  }

  private findTrack(name: string, src: string): TrackStructureTrack | null {
    if (name === this.memoName && src === this.memoSrc) return this.memoTrack;
    this.memoName = name;
    this.memoSrc = src;
    this.memoTrack = this.bySrc.get(normalizeTrackSrc(src)) ?? this.byName.get(name) ?? null;
    return this.memoTrack;
  }

  private resetCursors(track?: TrackStructureTrack, positionSec = 0): void {
    this.cursors.beats = firstAfter(track?.events?.beats, positionSec);
    this.cursors.kicks = firstAfter(track?.events?.kicks, positionSec);
    this.cursors.snares = firstAfter(track?.events?.snares, positionSec);
    this.cursors.toms = firstAfter(track?.events?.toms, positionSec);
    this.cursors.rolls = firstAfterRoll(track?.events?.rolls, positionSec);
  }

  private collectCues(track: TrackStructureTrack, positionSec: number): RhythmCue[] {
    const events = track.events;
    if (!events) return NO_CUES;
    const cues: RhythmCue[] = [];
    this.collectPointCues(cues, 'beat', events.beats, 'beats', positionSec);
    this.collectPointCues(cues, 'kick', events.kicks, 'kicks', positionSec);
    this.collectPointCues(cues, 'snare', events.snares, 'snares', positionSec);
    this.collectPointCues(cues, 'tom', events.toms, 'toms', positionSec);
    this.collectRollCues(cues, events.rolls, positionSec);
    this.lastPosition = positionSec;
    // The common frame fires no cue at all — skip the sort + slice allocations.
    if (cues.length === 0) return NO_CUES;
    cues.sort((a, b) => a.time - b.time);
    return cues.length > 12 ? cues.slice(-12) : cues;
  }

  private collectPointCues(
    cues: RhythmCue[],
    kind: Exclude<RhythmCueKind, 'roll'>,
    list: TrackRhythmPoint[] | undefined,
    cursorKey: 'beats' | 'kicks' | 'snares' | 'toms',
    positionSec: number,
  ): void {
    if (!list) return;
    let cursor = this.cursors[cursorKey];
    while (cursor < list.length && list[cursor]![0] <= positionSec) {
      const event = list[cursor]!;
      if (event[0] > this.lastPosition) cues.push({ kind, time: event[0], strength: event[1] });
      cursor++;
    }
    this.cursors[cursorKey] = cursor;
  }

  private collectRollCues(
    cues: RhythmCue[],
    list: TrackRhythmRoll[] | undefined,
    positionSec: number,
  ): void {
    if (!list) return;
    let cursor = this.cursors.rolls;
    while (cursor < list.length && list[cursor]![0] <= positionSec) {
      const event = list[cursor]!;
      if (event[0] > this.lastPosition) {
        cues.push({
          kind: 'roll',
          time: event[0],
          strength: event[3],
          duration: Math.max(0.1, event[1] - event[0]),
          density: event[2],
        });
      }
      cursor++;
    }
    this.cursors.rolls = cursor;
  }
}

function firstAfter(list: TrackRhythmPoint[] | undefined, positionSec: number): number {
  if (!list) return 0;
  let i = 0;
  while (i < list.length && list[i]![0] <= positionSec) i++;
  return i;
}

function firstAfterRoll(list: TrackRhythmRoll[] | undefined, positionSec: number): number {
  if (!list) return 0;
  let i = 0;
  while (i < list.length && list[i]![0] <= positionSec) i++;
  return i;
}
