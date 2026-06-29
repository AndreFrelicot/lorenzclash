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
}

export const DEFAULT_START_OPTIONS: StartOptions = {
  camera: true,
  audio: true,
};
