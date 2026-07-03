// Procedural "synthetic source": when the camera is off, this renders a
// time-evolving offscreen texture that feeds the same ring + HD still pool the
// camera would (FrameRingBuffer.captureFrom). Because every deposit captures "the
// instant T" of this source, the ribbon's temporal history, the HD dissolve and
// the key-frame glow all come for free — the renderer is agnostic to the source.
//
// Two stages:
//  - splat (every frame): the live Lorenz deposits are inked as soft additive
//    blobs into a persistent square texture that decays each frame (feedback
//    trail), through a slowly-rotating orthographic "butterfly portrait". The
//    attractor draws itself and fades.
//  - synth (on-demand): the splat density is read into the final target with a
//    domain-warp + IQ palette colorisation.
//
// Evolution is "natural but not linear": the live Lorenz point (bounded chaos) +
// a few incommensurate sine LFOs + optional audio drive the warp/hue/rotation,
// all eased so no raw value reaches the shader.
import synthShader from './shaders/synth.wgsl?raw';
import splatInkShader from './shaders/splatInk.wgsl?raw';
import trailFadeShader from './shaders/trailFade.wgsl?raw';
import { createModule } from './shaderModule.ts';

const TARGET_HEIGHT = 512; // matches the HD still pool height
const TARGET_FORMAT: GPUTextureFormat = 'rgba8unorm';
const MIN_WIDTH = 16;
const MAX_WIDTH = 1024;
const ASPECT_EPSILON = 0.02;

// The splat (feedback) texture is square — it holds a butterfly portrait that the
// synth pass then maps into the target. Kept fixed-size (never resized).
const SPLAT_SIZE = 512;
const SPLAT_SCALE = 0.5; // world (~±1.5) → NDC framing
const SPLAT_POINT = 0.02; // blob radius (NDC)
const SPLAT_INK = 0.5; // ink intensity
const TILT = 0.35; // base X tilt of the butterfly portrait
const PAL_CROSS = 0.05; // palette crossfade LFO speed
const EASE = 0.08; // modulation smoothing (no raw value into the shader)

// Base gains for the procedural material; live-tunable via the Synth panel.
export interface SynthParams {
  decay: number; // splat trail length (per-frame fade)
  warpAmp: number; // domain-warp amplitude
  flow: number; // warp animation speed
  scale: number; // fBm frequency
  hue: number; // hue drift speed (turns/s)
  hueRange: number; // density → hue span
  palette: number; // base palette select (0 rainbow / 1 sunset / 2 warm)
  rotate: number; // view rotation speed (rad/s)
  audio: number; // audio reactivity gain
}

// Per-frame modulation inputs from the scene (App/WebGPUContext side).
export interface SynthMods {
  px: number; // live Lorenz point, normalized to ~[-1, 1]
  py: number;
  pz: number;
  audio: boolean; // audio analysed (gates the audio terms to 0 when off)
  bass: number;
  treble: number;
  centroid: number;
  beat: number;
  level: number;
}

export class SyntheticSource {
  readonly params: SynthParams = {
    decay: 0.95,
    warpAmp: 0.15,
    flow: 0.26,
    scale: 5.1,
    hue: 0.06,
    hueRange: 0.6,
    palette: 0,
    rotate: 0.3,
    audio: 1.2,
  };

  private target!: GPUTexture;
  private targetView!: GPUTextureView;
  private aspect = 0;

  // Persistent splat feedback texture (square; decayed in place each frame).
  private readonly splat: GPUTexture;
  private readonly splatView: GPUTextureView;
  private splatInit = false;

  // Ink bind group cached on the deposits buffer's identity (it only changes on a
  // Length-slider reallocation) — no per-frame bind-group creation.
  private inkBindGroup: GPUBindGroup | null = null;
  private inkBindBuffer: GPUBuffer | null = null;

  private readonly synthData = new Float32Array(12); // u0 + u1 + u2
  private readonly splatData = new Float32Array(8); // rot(4) + meta(4)

  // Eased modulation state (smoothed; never raw values into the uniform).
  private readonly eased = {
    lpx: 0,
    lpy: 0,
    lpz: 0,
    warp: 0,
    flow: 0,
    scale: 0,
    pShift: 0,
    abeat: 0,
    abass: 0,
    acent: 0,
  };

  private constructor(
    private readonly device: GPUDevice,
    private readonly synthPipeline: GPURenderPipeline,
    private readonly synthUniform: GPUBuffer,
    private readonly synthBindGroup: GPUBindGroup,
    private readonly fadePipeline: GPURenderPipeline,
    private readonly inkPipeline: GPURenderPipeline,
    private readonly splatUniform: GPUBuffer,
    splat: GPUTexture,
    initialAspect: number,
  ) {
    this.splat = splat;
    this.splatView = splat.createView();
    this.allocate(initialAspect);
  }

  static async create(device: GPUDevice, initialAspect: number): Promise<SyntheticSource> {
    const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });

    // Splat feedback texture + its fade (multiply by decay) and ink (additive
    // blobs) pipelines. Same persistent-single-texture pattern as the ribbon trail.
    const splat = device.createTexture({
      label: 'synthetic-splat',
      size: [SPLAT_SIZE, SPLAT_SIZE],
      format: TARGET_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    const splatView = splat.createView();

    const fadeModule = await createModule(device, trailFadeShader);
    const fadePipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: fadeModule, entryPoint: 'vs' },
      fragment: {
        module: fadeModule,
        entryPoint: 'fs',
        targets: [
          {
            format: TARGET_FORMAT,
            // result = src*0 + dst*constant → multiply the splat by the decay.
            blend: {
              color: { srcFactor: 'zero', dstFactor: 'constant', operation: 'add' },
              alpha: { srcFactor: 'zero', dstFactor: 'constant', operation: 'add' },
            },
          },
        ],
      },
      primitive: { topology: 'triangle-list' },
    });

    const inkModule = await createModule(device, splatInkShader);
    const inkPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: inkModule, entryPoint: 'vs' },
      fragment: {
        module: inkModule,
        entryPoint: 'fs',
        targets: [
          {
            format: TARGET_FORMAT,
            blend: {
              color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
              alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
            },
          },
        ],
      },
      primitive: { topology: 'triangle-strip' },
    });
    const splatUniform = device.createBuffer({
      size: 8 * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Synth (colorise) pass: reads the splat into the final target.
    const synthModule = await createModule(device, synthShader);
    const synthPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: synthModule, entryPoint: 'vs' },
      fragment: { module: synthModule, entryPoint: 'fs', targets: [{ format: TARGET_FORMAT }] },
      primitive: { topology: 'triangle-list' },
    });
    const synthUniform = device.createBuffer({
      size: 12 * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const synthBindGroup = device.createBindGroup({
      layout: synthPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: synthUniform } },
        { binding: 1, resource: sampler },
        { binding: 2, resource: splatView },
      ],
    });

    return new SyntheticSource(
      device,
      synthPipeline,
      synthUniform,
      synthBindGroup,
      fadePipeline,
      inkPipeline,
      splatUniform,
      splat,
      initialAspect,
    );
  }

  get view(): GPUTextureView {
    return this.targetView;
  }

  // The raw splat feedback texture (the attractor's density, pre-colorisation) — for
  // the debug source inspector.
  get splatTextureView(): GPUTextureView {
    return this.splatView;
  }

  // Match the ring's stored-frame aspect so the blit into a ring layer is a
  // straight full-frame copy (no cropping). Cheap: guarded by an epsilon.
  resize(aspect: number): void {
    if (Math.abs(aspect - this.aspect) < ASPECT_EPSILON) return;
    this.target.destroy();
    this.allocate(aspect);
  }

  private allocate(aspect: number): void {
    this.aspect = aspect;
    const width = Math.min(Math.max(Math.round(TARGET_HEIGHT * aspect), MIN_WIDTH), MAX_WIDTH);
    this.target = this.device.createTexture({
      label: 'synthetic-source',
      size: [width, TARGET_HEIGHT],
      format: TARGET_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.targetView = this.target.createView();
  }

  // Fold the live Lorenz point + LFOs + gated audio into the eased modulation
  // state. Run once per frame (from updateSplat) before render() reads it.
  private modulate(time: number, m: SynthMods): void {
    const e = this.eased;
    const p = this.params;
    e.lpx += (m.px - e.lpx) * EASE;
    e.lpy += (m.py - e.lpy) * EASE;
    e.lpz += (m.pz - e.lpz) * EASE;
    // Audio terms, gated to 0 when audio is off so the scene stays alive on
    // Lorenz + LFO alone.
    e.abeat += ((m.audio ? m.beat : 0) - e.abeat) * 0.15;
    e.abass += ((m.audio ? m.bass : 0) - e.abass) * 0.12;
    e.acent += ((m.audio ? m.centroid : 0) - e.acent) * 0.1;
    // Incommensurate sine LFOs → quasi-periodic micro-variation.
    const l1 = Math.sin(time * 0.13);
    const l2 = Math.sin(time * 0.07 + 1.3);
    const l3 = Math.sin(time * 0.19 + 2.7);
    const g = p.audio;
    e.warp += (p.warpAmp * (1 + 0.6 * l1) + g * 0.4 * e.abeat - e.warp) * EASE;
    e.flow += (p.flow * (1 + 0.5 * l3) - e.flow) * EASE;
    e.scale += (p.scale * (1 + 0.15 * l2) + g * 0.8 * e.abass - e.scale) * EASE;
    e.pShift += (0.1 * l1 - e.pShift) * EASE;
  }

  // Advance the splat feedback trail: fade the persistent texture, then ink the
  // live Lorenz deposits on top. Runs EVERY frame the synthetic source is active
  // (else the trail freezes between deposits). Cheap (a small square + few blobs).
  updateSplat(
    encoder: GPUCommandEncoder,
    time: number,
    mods: SynthMods,
    depositsBuffer: GPUBuffer,
    count: number,
    head: number,
    capacity: number,
    ageRef: number,
  ): void {
    this.modulate(time, mods);
    const e = this.eased;
    const p = this.params;
    const oldestSlot = (head - count + capacity) % capacity;
    // Slow view rotation (linear spin + LFO wobble + Lorenz drift); Lorenz tilts it.
    const angleY = time * p.rotate + 0.6 * Math.sin(time * 0.07 + 1.3) + 0.4 * e.lpx;
    const tiltX = TILT + 0.25 * e.lpy;
    this.splatData[0] = angleY; // rot.x = angleY
    this.splatData[1] = tiltX; // rot.y = tiltX
    this.splatData[2] = SPLAT_SCALE; // rot.z = scale
    this.splatData[3] = SPLAT_POINT; // rot.w = pointSize
    this.splatData[4] = ageRef; // info.x = ageRef
    this.splatData[5] = capacity; // info.y = capacity
    this.splatData[6] = oldestSlot; // info.z = oldestSlot
    this.splatData[7] = SPLAT_INK; // info.w = inkIntensity
    this.device.queue.writeBuffer(this.splatUniform, 0, this.splatData);

    // The deposits buffer can be reallocated (Length slider) — cache the bind group
    // on the buffer's identity and rebuild only when it changes (same pattern as
    // FrameRingBuffer.captureFrom), instead of a new GPU object every frame.
    if (this.inkBindGroup === null || this.inkBindBuffer !== depositsBuffer) {
      this.inkBindGroup = this.device.createBindGroup({
        layout: this.inkPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.splatUniform } },
          { binding: 1, resource: { buffer: depositsBuffer } },
        ],
      });
      this.inkBindBuffer = depositsBuffer;
    }
    const inkBindGroup = this.inkBindGroup;

    const decay = p.decay;
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.splatView,
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: this.splatInit ? 'load' : 'clear',
          storeOp: 'store',
        },
      ],
    });
    pass.setBlendConstant({ r: decay, g: decay, b: decay, a: decay });
    pass.setPipeline(this.fadePipeline);
    pass.draw(3); // fullscreen fade (multiply by decay)
    if (count > 0) {
      pass.setPipeline(this.inkPipeline);
      pass.setBindGroup(0, inkBindGroup);
      pass.draw(4, count); // one soft blob per deposit
    }
    pass.end();
    this.splatInit = true;
  }

  // Render the procedural frame into the target by colorising the splat. On-demand:
  // the caller invokes it only when a deposit or still capture will sample it.
  // Reads the eased modulation state advanced by updateSplat this frame.
  render(encoder: GPUCommandEncoder, time: number): void {
    const e = this.eased;
    const p = this.params;
    const g = p.audio;
    const d = this.synthData;
    const hueOffset = (time * p.hue + 0.2 * e.lpz + g * 0.3 * e.acent) % 1;
    d[0] = time; // u0.x = time
    d[1] = e.warp; // u0.y = warpAmp
    d[2] = e.flow; // u0.z = flow
    d[3] = e.scale; // u0.w = noiseScale
    d[4] = hueOffset; // u1.x = hueOffset (drifts)
    d[5] = p.hueRange; // u1.y = hueRange
    d[6] = e.pShift; // u1.z = paletteShift
    d[7] = 0.5 + 0.5 * Math.sin(time * PAL_CROSS); // u1.w = paletteMix (crossfade)
    d[8] = p.palette % 3; // u2.x = palette A
    d[9] = (p.palette + 2) % 3; // u2.y = palette B
    this.device.queue.writeBuffer(this.synthUniform, 0, this.synthData);
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.targetView,
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
    pass.setPipeline(this.synthPipeline);
    pass.setBindGroup(0, this.synthBindGroup);
    pass.draw(3);
    pass.end();
  }

  destroy(): void {
    this.target.destroy();
    this.splat.destroy();
    this.synthUniform.destroy();
    this.splatUniform.destroy();
  }
}
