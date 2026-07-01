// Application lifecycle phases.
export type AppPhase =
  | 'boot'
  | 'unsupported'
  | 'start-screen'
  | 'requesting-permissions'
  | 'calibration'
  | 'running'
  | 'paused'
  | 'error';

// Layers the user opts into from the start screen.
export interface StartOptions {
  camera: boolean;
  audio: boolean;
  initialTrackSrc?: string;
}

export const DEFAULT_START_OPTIONS: StartOptions = {
  camera: true,
  audio: true,
};

export const OPTION_START_TRACK_SRC = '/audio/11_tribal_trace.m4a';
