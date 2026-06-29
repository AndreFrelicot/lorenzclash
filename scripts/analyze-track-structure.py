#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11,<3.13"
# dependencies = [
#   "audioread>=3.0.1",
#   "librosa>=0.11.0,<0.12",
#   "numpy>=1.26,<3",
#   "scipy>=1.11",
# ]
# ///
"""Offline music-structure analysis for Lorenz Clash.

Run from the repository root:

  uv run --python 3.12 scripts/analyze-track-structure.py

The script analyses public/audio/*.m4a with librosa and writes a compact JSON
timeline used by the Auto Director and rhythm-triggered effects.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import warnings
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import librosa
import numpy as np
from scipy.signal import find_peaks


warnings.filterwarnings("ignore", message="PySoundFile failed. Trying audioread instead.")
warnings.filterwarnings("ignore", message="librosa.core.audio.__audioread_load", category=FutureWarning)

SR = 22_050
HOP = 512
FRAME = 2_048
GRID_SEC = 1.0
MIN_SECTION_SEC = 18.0
NOVELTY_CONTEXT_SEC = 8.0
MAX_BOUNDARIES = 10
MAX_EVENTS = 512


@dataclass(frozen=True)
class TrackSpec:
    name: str
    src: str


def repo_app_root() -> Path:
    return Path(__file__).resolve().parents[1]


def parse_tracks(path: Path) -> list[TrackSpec]:
    text = path.read_text(encoding="utf-8")
    rows = re.findall(r"\{\s*name:\s*'([^']+)'\s*,\s*src:\s*'([^']+)'\s*\}", text)
    return [TrackSpec(name=name, src=src) for name, src in rows]


def clamp01(x: float) -> float:
    return max(0.0, min(1.0, x))


def round_list(values: np.ndarray | list[float], ndigits: int = 3) -> list[float]:
    return [round(float(v), ndigits) for v in values]


def robust_norm(values: np.ndarray, lo_q: float = 10, hi_q: float = 95) -> np.ndarray:
    lo = float(np.percentile(values, lo_q))
    hi = float(np.percentile(values, hi_q))
    if hi <= lo + 1e-9:
        return np.zeros_like(values, dtype=np.float32)
    return np.clip((values - lo) / (hi - lo), 0, 1).astype(np.float32)


def smooth(values: np.ndarray, seconds: float) -> np.ndarray:
    n = max(1, int(round(seconds / GRID_SEC)))
    if n <= 1:
        return values
    kernel = np.ones(n, dtype=np.float32) / n
    return np.convolve(values, kernel, mode="same")


def smooth_frames(values: np.ndarray, frames: int) -> np.ndarray:
    n = max(1, frames)
    if n <= 1:
        return values
    kernel = np.ones(n, dtype=np.float32) / n
    return np.convolve(values, kernel, mode="same")


def interp_feature(times: np.ndarray, values: np.ndarray, grid: np.ndarray) -> np.ndarray:
    if len(times) == 0 or len(values) == 0:
        return np.zeros_like(grid, dtype=np.float32)
    return np.interp(grid, times, values).astype(np.float32)


def times_for(values: np.ndarray, sr: int) -> np.ndarray:
    return librosa.frames_to_time(np.arange(len(values)), sr=sr, hop_length=HOP)


def local_mean(features: np.ndarray, center: int, radius: int, left: bool) -> np.ndarray:
    if left:
        a = max(0, center - radius)
        b = center
    else:
        a = center
        b = min(features.shape[1], center + radius)
    if b <= a:
        return np.zeros(features.shape[0], dtype=np.float32)
    return np.mean(features[:, a:b], axis=1)


def reduce_boundaries(candidates: list[float], duration: float) -> list[float]:
    bounds = [0.0]
    for t in sorted(candidates):
        if t < MIN_SECTION_SEC or t > duration - MIN_SECTION_SEC:
            continue
        if t - bounds[-1] < MIN_SECTION_SEC:
            continue
        bounds.append(float(t))
    if duration - bounds[-1] < MIN_SECTION_SEC and len(bounds) > 1:
        bounds.pop()
    bounds.append(duration)
    return bounds


def classify_section(
    index: int,
    count: int,
    energy: float,
    rhythm: float,
    brightness: float,
    energy_low: float,
    energy_high: float,
    rhythm_low: float,
    rhythm_high: float,
    brightness_high: float,
) -> str:
    if index == 0 and (energy <= energy_low or rhythm <= rhythm_low):
        return "intro"
    if index == count - 1 and energy <= energy_low and rhythm <= rhythm_low:
        return "outro"
    if energy >= energy_high and rhythm >= rhythm_high:
        return "drive"
    if energy >= energy_high or rhythm >= rhythm_high:
        return "groove"
    if energy <= energy_low and rhythm <= rhythm_low:
        return "break"
    if brightness >= brightness_high and rhythm <= rhythm_low:
        return "float"
    return "bridge"


def director_for(role: str, index: int) -> dict[str, Any]:
    if role in {"intro", "outro", "float"}:
        return {"view": "orbit", "shape": "plane", "comet": False}
    if role == "break":
        return {"view": "tailA" if index % 2 == 0 else "tailB", "shape": "plane", "comet": False}
    if role == "drive":
        return {
            "view": "followA" if index % 2 == 0 else "followB",
            "shape": "cube" if index % 2 == 0 else "sphere",
            "comet": True,
        }
    if role == "groove":
        return {
            "view": "followA" if index % 2 == 0 else "tailA",
            "shape": "cube",
            "comet": True,
        }
    return {"view": "tailA" if index % 2 == 0 else "orbit", "shape": "sphere", "comet": False}


def band_flux(mag: np.ndarray, freqs: np.ndarray, lo_hz: float, hi_hz: float) -> np.ndarray:
    mask = (freqs >= lo_hz) & (freqs <= hi_hz)
    if not np.any(mask):
        return np.zeros(mag.shape[1], dtype=np.float32)
    energy = np.mean(np.log1p(mag[mask]), axis=0)
    flux = np.maximum(0, np.diff(energy, prepend=energy[0]))
    return smooth_frames(robust_norm(flux, 50, 99), 2)


def peak_events(
    flux: np.ndarray,
    sr: int,
    min_gap_sec: float,
    q: float,
    min_strength: float,
    limit: int = MAX_EVENTS,
) -> list[list[float]]:
    if len(flux) == 0:
        return []
    height = max(float(np.percentile(flux, q)), float(np.mean(flux) + np.std(flux) * 0.35), min_strength)
    distance = max(1, int(round(min_gap_sec * sr / HOP)))
    peaks, props = find_peaks(flux, height=height, distance=distance)
    heights = props.get("peak_heights", np.zeros(len(peaks), dtype=np.float32))
    scored = sorted(zip(peaks, heights), key=lambda x: float(x[1]), reverse=True)[:limit]
    scored.sort(key=lambda x: int(x[0]))
    times = librosa.frames_to_time([int(p) for p, _ in scored], sr=sr, hop_length=HOP)
    return [[round(float(t), 3), round(clamp01(float(h)), 3)] for t, (_, h) in zip(times, scored)]


def make_beat_events(beat_times: np.ndarray, frame_times: np.ndarray, onset_norm: np.ndarray) -> list[list[float]]:
    strengths = np.interp(beat_times, frame_times, onset_norm) if len(beat_times) else np.array([], dtype=np.float32)
    return [[round(float(t), 3), round(clamp01(float(s)), 3)] for t, s in zip(beat_times, strengths)]


def detect_rolls(snare_events: list[list[float]]) -> list[list[float]]:
    strong = [e for e in snare_events if e[1] >= 0.58]
    rolls: list[list[float]] = []
    seq: list[list[float]] = []

    def flush() -> None:
        nonlocal seq
        if len(seq) >= 4:
            start = seq[0][0]
            end = seq[-1][0]
            dur = max(0.001, end - start)
            if 0.25 <= dur <= 3.2:
                density = len(seq) / dur
                intensity = sum(e[1] for e in seq) / len(seq)
                if density >= 5.0:
                    rolls.append([round(start, 3), round(end, 3), round(float(density), 3), round(clamp01(float(intensity)), 3)])
        seq = []

    for event in strong:
        if not seq or event[0] - seq[-1][0] <= 0.28:
            seq.append(event)
        else:
            flush()
            seq.append(event)
    flush()

    merged: list[list[float]] = []
    for roll in rolls:
        if merged and roll[0] - merged[-1][1] <= 0.35:
            prev = merged[-1]
            prev[1] = roll[1]
            prev[2] = round(max(prev[2], roll[2]), 3)
            prev[3] = round(max(prev[3], roll[3]), 3)
        else:
            merged.append(roll)
    return merged[:128]


def rhythmic_events(
    y: np.ndarray,
    sr: int,
    beat_times: np.ndarray,
    frame_times: np.ndarray,
    onset_env: np.ndarray,
) -> dict[str, Any]:
    mag = np.abs(librosa.stft(y, n_fft=FRAME, hop_length=HOP))
    freqs = librosa.fft_frequencies(sr=sr, n_fft=FRAME)
    onset_norm = robust_norm(onset_env, 50, 99)
    kick_flux = band_flux(mag, freqs, 35, 180)
    tom_flux = band_flux(mag, freqs, 120, 900)
    snare_flux = band_flux(mag, freqs, 900, 6500)

    kicks = peak_events(kick_flux, sr, 0.2, 92, 0.48, limit=384)
    snares = peak_events(snare_flux, sr, 0.11, 95, 0.58, limit=384)
    toms = peak_events(tom_flux, sr, 0.16, 96, 0.6, limit=128)
    rolls = detect_rolls(snares)
    beat_events = make_beat_events(beat_times, frame_times, onset_norm)

    return {
        "beats": beat_events,
        "kicks": kicks,
        "snares": snares,
        "toms": toms,
        "rolls": rolls,
        "summary": {
            "beats": len(beat_events),
            "kicks": len(kicks),
            "snares": len(snares),
            "toms": len(toms),
            "rolls": len(rolls),
        },
    }


def analyse_track(track: TrackSpec, audio_path: Path) -> dict[str, Any]:
    y, sr = librosa.load(audio_path, sr=SR, mono=True)
    duration = float(librosa.get_duration(y=y, sr=sr))
    if duration <= 0:
        raise ValueError(f"empty audio: {audio_path}")

    onset_env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=HOP)
    frame_times = librosa.frames_to_time(np.arange(len(onset_env)), sr=sr, hop_length=HOP)
    tempo, beat_frames = librosa.beat.beat_track(
        onset_envelope=onset_env,
        sr=sr,
        hop_length=HOP,
        units="frames",
        trim=False,
    )
    beat_times = librosa.frames_to_time(beat_frames, sr=sr, hop_length=HOP)
    onset_times = librosa.onset.onset_detect(
        onset_envelope=onset_env,
        sr=sr,
        hop_length=HOP,
        units="time",
        backtrack=True,
    )

    events = rhythmic_events(y, sr, beat_times, frame_times, onset_env)

    rms = librosa.feature.rms(y=y, frame_length=FRAME, hop_length=HOP)[0]
    centroid = librosa.feature.spectral_centroid(y=y, sr=sr, hop_length=HOP)[0]
    centroid_log = np.clip((np.log2(np.maximum(centroid, 1.0)) - math.log2(100)) / (math.log2(6000) - math.log2(100)), 0, 1)

    chroma = librosa.feature.chroma_stft(y=y, sr=sr, hop_length=HOP)
    mfcc = librosa.feature.mfcc(y=y, sr=sr, hop_length=HOP, n_mfcc=8)

    grid = np.arange(0, duration + GRID_SEC, GRID_SEC, dtype=np.float32)
    energy = smooth(interp_feature(times_for(rms, sr), robust_norm(rms), grid), 4.0)
    rhythm = smooth(interp_feature(times_for(onset_env, sr), robust_norm(onset_env), grid), 4.0)
    brightness = smooth(interp_feature(times_for(centroid_log, sr), centroid_log, grid), 4.0)

    # Structure candidates from a novelty curve: compare the local 8-second
    # feature profile before and after each grid time.
    feature_rows = [energy, rhythm, brightness]
    for row in chroma:
        feature_rows.append(interp_feature(times_for(row, sr), robust_norm(row), grid))
    for row in mfcc:
        feature_rows.append(interp_feature(times_for(row, sr), robust_norm(row), grid))
    features = np.vstack(feature_rows).astype(np.float32)
    radius = max(2, int(round(NOVELTY_CONTEXT_SEC / GRID_SEC)))
    novelty = np.zeros(len(grid), dtype=np.float32)
    for i in range(radius, len(grid) - radius):
        novelty[i] = float(np.linalg.norm(local_mean(features, i, radius, True) - local_mean(features, i, radius, False)))
    novelty = smooth(novelty, 3.0)
    threshold = max(float(np.percentile(novelty, 72)), float(np.mean(novelty) + np.std(novelty) * 0.35))
    peaks, props = find_peaks(
        novelty,
        height=threshold,
        distance=max(1, int(round(MIN_SECTION_SEC / GRID_SEC))),
    )
    scored = sorted(
        ((float(novelty[p]), float(grid[p])) for p in peaks),
        reverse=True,
    )[:MAX_BOUNDARIES]

    candidates = [t for _, t in scored]
    # Many tracks have a quiet/texture intro before the groove. Add the first
    # sustained energy/rhythm lift if novelty missed it.
    lift = np.where((energy > 0.46) & (rhythm > 0.38))[0]
    if len(lift):
        t = float(grid[int(lift[0])])
        if 8 <= t <= min(70, duration * 0.45):
            candidates.append(t)

    bounds = reduce_boundaries(candidates, duration)
    raw_sections: list[dict[str, float]] = []
    section_count = len(bounds) - 1
    for start, end in zip(bounds[:-1], bounds[1:]):
        mask = (grid >= start) & (grid < end)
        if not np.any(mask):
            mask = np.array([True])
        raw_sections.append(
            {
                "start": float(start),
                "end": float(end),
                "energy": clamp01(float(np.mean(energy[mask]))),
                "rhythm": clamp01(float(np.mean(rhythm[mask]))),
                "brightness": clamp01(float(np.mean(brightness[mask]))),
            }
        )

    section_energy = np.array([s["energy"] for s in raw_sections], dtype=np.float32)
    section_rhythm = np.array([s["rhythm"] for s in raw_sections], dtype=np.float32)
    section_brightness = np.array([s["brightness"] for s in raw_sections], dtype=np.float32)
    energy_low = float(np.percentile(section_energy, 32))
    energy_high = float(np.percentile(section_energy, 62))
    rhythm_low = float(np.percentile(section_rhythm, 32))
    rhythm_high = float(np.percentile(section_rhythm, 62))
    brightness_high = float(np.percentile(section_brightness, 62))

    sections: list[dict[str, Any]] = []
    for i, raw in enumerate(raw_sections):
        e = raw["energy"]
        r = raw["rhythm"]
        b = raw["brightness"]
        role = classify_section(
            i,
            section_count,
            e,
            r,
            b,
            energy_low,
            energy_high,
            rhythm_low,
            rhythm_high,
            brightness_high,
        )
        sections.append(
            {
                "start": round(float(raw["start"]), 3),
                "end": round(float(raw["end"]), 3),
                "role": role,
                "energy": round(e, 3),
                "rhythm": round(r, 3),
                "brightness": round(b, 3),
                "director": director_for(role, i),
            }
        )

    return {
        "name": track.name,
        "src": track.src,
        "duration": round(duration, 3),
        "tempo": round(float(np.atleast_1d(tempo)[0]), 3),
        "beats": round_list(beat_times[:512], 3),
        "onsets": round_list(onset_times[:512], 3),
        "events": events,
        "sections": sections,
        "summary": {
            "energy": round(float(np.mean(energy)), 3),
            "rhythm": round(float(np.mean(rhythm)), 3),
            "brightness": round(float(np.mean(brightness)), 3),
            "noveltyThreshold": round(threshold, 3),
        },
    }


def print_summary(results: list[dict[str, Any]]) -> None:
    for track in results:
        es = track["events"]["summary"]
        print(
            f"\n{track['name']}  tempo={track['tempo']:.1f}  duration={track['duration']:.1f}s  "
            f"events=b{es['beats']}/k{es['kicks']}/s{es['snares']}/t{es['toms']}/r{es['rolls']}"
        )
        for s in track["sections"]:
            d = s["director"]
            print(
                f"  {s['start']:7.1f}-{s['end']:7.1f}  "
                f"{s['role']:<6}  e={s['energy']:.2f} r={s['rhythm']:.2f} b={s['brightness']:.2f}  "
                f"{d['view']}/{d['shape']}{' +comet' if d['comet'] else ''}"
            )


def main() -> None:
    app = repo_app_root()
    parser = argparse.ArgumentParser()
    parser.add_argument("--tracks", type=Path, default=app / "src/audio/tracks.ts")
    parser.add_argument("--audio-dir", type=Path, default=app / "public/audio")
    parser.add_argument("--out", type=Path, default=app / "src/audio/track-analysis.json")
    args = parser.parse_args()

    tracks = parse_tracks(args.tracks)
    if not tracks:
        raise SystemExit(f"no tracks found in {args.tracks}")

    results = []
    for track in tracks:
        rel = track.src.lstrip("/")
        audio_path = args.audio_dir.parent / rel
        if not audio_path.exists():
            print(f"skip missing: {audio_path}")
            continue
        print(f"analysing {track.name}...")
        results.append(analyse_track(track, audio_path))

    payload = {
        "version": 1,
        "generatedBy": "scripts/analyze-track-structure.py",
        "sampleRate": SR,
        "hopLength": HOP,
        "notes": "Offline draft for AutoDirector. FFT live features still drive color/intensity.",
        "tracks": results,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print_summary(results)
    print(f"\nwrote {args.out}")


if __name__ == "__main__":
    main()
