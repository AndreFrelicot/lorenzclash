// Ring buffer of camera frames stored as layers of a texture_2d_array.
//
// importExternalTexture() is transient (valid one frame), so to keep past frames
// we blit each captured frame into a layer we own. Layers are overwritten
// cyclically — bounded memory, allocated once, no GC churn. The layer index of a
// card equals its instance index in the ribbon (same ring head).
//
// Layers are sized to the camera's aspect ratio so portrait/landscape frames are
// stored without cropping.
import frameCaptureShader from './shaders/frameCapture.wgsl?raw';
import frameCaptureTexShader from './shaders/frameCaptureTex.wgsl?raw';
import { createModule } from './shaderModule.ts';

const DEFAULT_LAYER_HEIGHT = 256;
const MIN_WIDTH = 16;
const MAX_WIDTH = 1024;
const ASPECT_EPSILON = 0.02;

export class FrameRingBuffer {
  private texture!: GPUTexture;
  private layerViews: GPUTextureView[] = [];
  arrayView!: GPUTextureView;
  private aspect = 0;

  // Current layer aspect (width/height), for cover-fitting the stored frame.
  get layerAspect(): number {
    return this.aspect;
  }

  // rotation + colour grade (enabled, hue, saturation, vibrance, contrast, exposure, lift)
  // + optional output-space crop (left, top, right, bottom) for copied camera frames.
  private readonly uniformData = new Float32Array(12);

  private constructor(
    private readonly device: GPUDevice,
    private capacity: number,
    private readonly pipeline: GPURenderPipeline,
    private readonly texPipeline: GPURenderPipeline,
    private readonly sampler: GPUSampler,
    private readonly uniformBuffer: GPUBuffer,
    private readonly layerHeight: number,
    initialAspect: number,
    // Bound the layer AREA by capping its longer edge to layerHeight (preserving aspect). For
    // the big-capacity ribbon rings this keeps a wide/landscape camera from tripling the GPU
    // footprint vs portrait. Off for the small HD pool (fullscreen — wants full width).
    private readonly capLongEdge: boolean,
  ) {
    this.allocate(initialAspect);
  }

  static async create(
    device: GPUDevice,
    capacity: number,
    initialAspect: number,
    layerHeight: number = DEFAULT_LAYER_HEIGHT,
    capLongEdge = false,
  ): Promise<FrameRingBuffer> {
    const module = await createModule(device, frameCaptureShader);
    const pipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] },
      primitive: { topology: 'triangle-list' },
    });
    // Sibling pipeline that blits from a texture_2d (the synthetic source) instead
    // of the camera's external texture — used by captureFrom() when the camera is off.
    const texModule = await createModule(device, frameCaptureTexShader);
    const texPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: texModule, entryPoint: 'vs' },
      fragment: { module: texModule, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] },
      primitive: { topology: 'triangle-list' },
    });
    const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
    const uniformBuffer = device.createBuffer({
      size: 12 * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    return new FrameRingBuffer(
      device,
      capacity,
      pipeline,
      texPipeline,
      sampler,
      uniformBuffer,
      layerHeight,
      initialAspect,
      capLongEdge,
    );
  }

  // Resize the layers to a new aspect ratio. Returns true if it actually
  // reallocated (the caller must then rebuild any bind group using arrayView).
  resize(aspect: number): boolean {
    if (Math.abs(aspect - this.aspect) < ASPECT_EPSILON) return false;
    this.texture.destroy();
    this.allocate(aspect);
    return true;
  }

  // Resize the ring to a new number of layers (ribbon length). Reallocates the
  // texture array at the current aspect; the caller must rebuild any bind group
  // that referenced arrayView (it changes).
  setCapacity(capacity: number): void {
    if (capacity === this.capacity) return;
    this.capacity = capacity;
    this.texture.destroy();
    this.allocate(this.aspect);
  }

  private allocate(aspect: number): void {
    this.aspect = aspect;
    let height = this.layerHeight;
    let width = Math.round(height * aspect);
    // Area cap: for the ribbon rings, a landscape camera (width > height) would otherwise store
    // ~3× the pixels of portrait. Cap the longer edge to layerHeight and shrink the other to
    // keep the camera aspect — so the footprint is orientation-independent (the iPad OOM fix).
    if (this.capLongEdge && width > height) {
      width = height;
      height = Math.max(1, Math.round(this.layerHeight / aspect));
    }
    width = Math.min(Math.max(width, MIN_WIDTH), MAX_WIDTH);
    this.texture = this.device.createTexture({
      label: 'frame-ring',
      size: [width, height, this.capacity],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.arrayView = this.texture.createView({ dimension: '2d-array' });
    this.layerViews = [];
    for (let i = 0; i < this.capacity; i++) {
      this.layerViews.push(
        this.texture.createView({ dimension: '2d', baseArrayLayer: i, arrayLayerCount: 1 }),
      );
    }
  }

  // Blit the current external (camera) frame into each freshly-deposited layer,
  // recording the passes into the caller's command encoder.
  capture(
    encoder: GPUCommandEncoder,
    externalTexture: GPUExternalTexture,
    slots: Int32Array,
    slotCount: number,
    rotation: number,
    // [enabled, hue, saturation, vibrance, contrast, exposure, lift] — the camera grade.
    grade: Float32Array,
  ): void {
    if (slotCount <= 0) return;

    this.uniformData[0] = rotation;
    this.uniformData.set(grade, 1);
    this.uniformData.fill(0, 8, 12);
    this.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniformData);

    const bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: externalTexture },
      ],
    });

    for (let i = 0; i < slotCount; i++) {
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: this.layerViews[slots[i]],
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
      });
      pass.setPipeline(this.pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.draw(3);
      pass.end();
    }
  }

  // Same as capture(), but blits from a regular 2D texture view instead of the camera's
  // external texture. Used by the synthetic source (camera off, grade omitted → none) AND by
  // the live camera (copied once per frame into a persistent texture — see WebGPUContext —
  // to avoid the leaking per-frame importExternalTexture). The bind group is CACHED while the
  // source view is unchanged (it is, frame to frame): no per-frame allocation in the hot loop.
  private cachedTexBind: GPUBindGroup | null = null;
  private cachedTexView: GPUTextureView | null = null;
  captureFrom(
    encoder: GPUCommandEncoder,
    sourceView: GPUTextureView,
    slots: Int32Array,
    slotCount: number,
    rotation: number,
    grade?: Float32Array,
    crop?: Float32Array,
  ): void {
    if (slotCount <= 0) return;

    this.uniformData[0] = rotation;
    if (grade) this.uniformData.set(grade, 1);
    else this.uniformData.fill(0, 1); // synthetic source is already coloured → no grade
    if (crop) this.uniformData.set(crop, 8);
    else this.uniformData.fill(0, 8, 12);
    this.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniformData);

    // Rebuild the bind group only when the source texture changes (resize) — otherwise reuse it.
    if (this.cachedTexView !== sourceView || !this.cachedTexBind) {
      this.cachedTexBind = this.device.createBindGroup({
        layout: this.texPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.uniformBuffer } },
          { binding: 1, resource: this.sampler },
          { binding: 2, resource: sourceView },
        ],
      });
      this.cachedTexView = sourceView;
    }
    const bindGroup = this.cachedTexBind;

    for (let i = 0; i < slotCount; i++) {
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: this.layerViews[slots[i]],
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
      });
      pass.setPipeline(this.texPipeline);
      pass.setBindGroup(0, bindGroup);
      pass.draw(3);
      pass.end();
    }
  }

  destroy(): void {
    this.texture.destroy();
  }
}
