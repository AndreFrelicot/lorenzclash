// Compile a WGSL module, surfacing compile errors eagerly. WebKit/iOS rejects
// some WGSL that Chrome's Tint accepts, and validation errors otherwise surface
// only as a silent black frame.
export async function createModule(device: GPUDevice, code: string): Promise<GPUShaderModule> {
  const module = device.createShaderModule({ code });
  const compilation = await module.getCompilationInfo();
  const errors = compilation.messages.filter((m) => m.type === 'error');
  if (errors.length > 0) {
    const detail = errors.map((m) => `${m.lineNum}:${m.linePos} ${m.message}`).join('; ');
    throw new Error(`Shader compile error: ${detail}`);
  }
  return module;
}
