// Audio source tracks, compressed to AAC (.m4a, 192 kbps) and served from
// public/audio. The audio engine loads one, plays it, and an AnalyserNode runs
// the FFT that drives the visuals. Only unique tracks over 3 min are kept.
// Filenames mirror Downloads/LorenzClash-Songs/selection (numbered = play order).
// Add/remove entries here as sources change.

export interface Track {
  name: string;
  src: string; // served at the site root (Vite public/)
}

export const TRACKS: Track[] = [
  { name: 'Chrome Serpent', src: '/audio/01_chrome_serpent.m4a' },
  { name: 'Glacier Drift', src: '/audio/02_glacier_drift.m4a' },
  { name: 'Mandelbrot Mary', src: '/audio/03_mandelbrot_mary.m4a' },
  { name: 'Mandelbrot Mirage', src: '/audio/04_mandelbrot_mirage.m4a' },
  { name: 'Ritual Trace', src: '/audio/05_ritual_trace.m4a' },
  { name: 'Sea Ice Drift', src: '/audio/06_sea_ice_drift.m4a' },
  { name: 'Serpent Coil', src: '/audio/07_serpent_coil.m4a' },
  { name: 'Serpent Helix', src: '/audio/08_serpent_helix.m4a' },
  { name: 'Solar Halo Pulse', src: '/audio/09_solar_halo_pulse.m4a' },
  { name: 'Spirale de Lorenz', src: '/audio/10_spirale_de_lorenz.m4a' },
  { name: 'Tribal Trace', src: '/audio/11_tribal_trace.m4a' },
];
