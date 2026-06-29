// Lorenz system parameters.
//
//   dx/dt = sigma * (y - x)
//   dy/dt = x * (rho - z) - y
//   dz/dt = x * y - beta * z

export interface LorenzParams {
  sigma: number;
  rho: number;
  beta: number;
  // Curve-generation speed in WORLD units per second. The point traverses the
  // attractor at constant speed (normalized field), so this is steady regardless
  // of the raw Lorenz velocity. Audio and pointer gestures modulate sigma/rho/beta.
  speed: number;
}

export const DEFAULT_LORENZ_PARAMS: LorenzParams = {
  sigma: 10.0,
  rho: 28.0,
  beta: 8.0 / 3.0,
  speed: 1.0,
};
