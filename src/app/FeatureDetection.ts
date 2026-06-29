// Capability detection for the experience. WebGPU is required: if it is
// unavailable, route to the unsupported screen rather than attempting a WebGL
// fallback.

export interface DetectedFeatures {
  webgpu: boolean;
}

export async function detectFeatures(): Promise<DetectedFeatures> {
  if (!('gpu' in navigator) || !navigator.gpu) {
    return { webgpu: false };
  }

  try {
    // `requestAdapter()` can resolve to null even when `navigator.gpu` exists
    // (no compatible device, driver disabled, etc.), so probing for an adapter
    // is the reliable availability check. The device itself is created later by
    // the WebGPU context from a fresh adapter.
    const adapter = await navigator.gpu.requestAdapter();
    return { webgpu: adapter !== null };
  } catch {
    return { webgpu: false };
  }
}
