// QR end-card overlay for the video export. The export appends a short "outro"
// clip where the live composite keeps swirling behind a dark end card
// holding a QR code that links back to the site. This module owns the look: it
// builds the QR matrix and paints one outro frame onto the recorder's 2D canvas.
//
// The QR + caption are STATIC, so they're baked once into an offscreen card (crisp,
// integer-sized modules → scannable) and blitted each frame; only the dark backdrop
// and the fade/scale-in animation are recomputed per frame.
import encodeQR from 'qr';

export interface QrMatrix {
  count: number; // module count per side (square)
  isDark(row: number, col: number): boolean;
  caption: string; // host shown under the QR (e.g. "lorenzclash.andrefrelicot.dev")
}

type Ctx2D = OffscreenCanvasRenderingContext2D;

const qrCache = new Map<string, QrMatrix>();
const cardCache = new Map<string, OffscreenCanvas>();

// Build (and memoise) the QR module matrix for `url`. `ecc: 'medium'` survives the video
// recompression + the small on-screen size while staying compact.
export function buildQr(url: string): QrMatrix {
  const cached = qrCache.get(url);
  if (cached) return cached;
  const m = encodeQR(url, 'raw', { ecc: 'medium' });
  let caption = url;
  try {
    caption = new URL(url).host;
  } catch {
    /* keep the raw url if it doesn't parse */
  }
  const matrix: QrMatrix = {
    count: m.length,
    isDark: (row, col) => m[row]?.[col] === true,
    caption,
  };
  qrCache.set(url, matrix);
  return matrix;
}

// All card geometry derived from the frame's short edge so it scales portrait + landscape.
function metrics(
  short: number,
  count: number,
): {
  moduleSize: number;
  pad: number;
  cardSize: number;
  gap: number;
  logoW: number;
  logoH: number;
  logoTitleGap: number;
  capTitle: number;
  capSub: number;
  capTag: number;
  cpad: number;
  contW: number;
  contH: number;
  radius: number;
} {
  const moduleSize = Math.max(2, Math.floor((short * 0.34) / count));
  const qrPx = moduleSize * count;
  const pad = Math.max(Math.round(short * 0.028), moduleSize * 4); // ≥ 4-module quiet zone
  const cardSize = qrPx + pad * 2;
  const gap = Math.round(short * 0.035);
  const logoW = Math.round(short * 0.13);
  const logoH = Math.round((logoW * 263) / 300);
  const logoTitleGap = Math.round(short * 0.032);
  const capTitle = Math.round(short * 0.03);
  const capSub = Math.round(short * 0.02);
  const capTag = Math.round(short * 0.026);
  const cpad = Math.round(short * 0.05);
  const capBlock =
    gap +
    logoH +
    logoTitleGap +
    capTitle +
    Math.round(short * 0.026) +
    capSub +
    Math.round(short * 0.022) +
    capTag;
  const contW = cardSize + cpad * 2;
  const contH = cpad + cardSize + capBlock + cpad;
  const radius = Math.round(short * 0.04);
  return {
    moduleSize,
    pad,
    cardSize,
    gap,
    logoW,
    logoH,
    logoTitleGap,
    capTitle,
    capSub,
    capTag,
    cpad,
    contW,
    contH,
    radius,
  };
}

function roundRectPath(ctx: Ctx2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

const LOGO_POLYGONS = [
  {
    fill: 'rgb(169, 0, 0)',
    points: [
      [-0.002, -0.001],
      [236.845, 69.469],
      [69.469, 236.845],
    ],
  },
  {
    fill: 'rgb(169, 0, 0)',
    points: [
      [299.323, 25.908],
      [229.852, 262.755],
      [62.476, 95.379],
    ],
  },
  {
    fill: 'rgb(246, 247, 250)',
    points: [
      [232.003, 98.557],
      [211.883, 167.154],
      [163.406, 118.677],
    ],
  },
  {
    fill: 'rgb(246, 247, 250)',
    points: [
      [68.435, 77.614],
      [137.033, 97.735],
      [88.556, 146.212],
    ],
  },
] as const;

function drawLogo(ctx: Ctx2D, x: number, y: number, w: number, h: number): void {
  for (const poly of LOGO_POLYGONS) {
    ctx.beginPath();
    poly.points.forEach(([px, py], i) => {
      const sx = x + (px / 300) * w;
      const sy = y + (py / 263) * h;
      if (i === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    });
    ctx.closePath();
    ctx.fillStyle = poly.fill;
    ctx.fill();
  }
}

// Bake the white QR card + caption (transparent background) once per (url, size).
function getCard(qr: QrMatrix, short: number): OffscreenCanvas {
  const key = `${qr.caption}|${short}|${qr.count}`;
  const hit = cardCache.get(key);
  if (hit) return hit;

  const m = metrics(short, qr.count);
  const canvas = new OffscreenCanvas(m.contW, m.contH);
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  const cardX = Math.round((m.contW - m.cardSize) / 2);
  const cardY = m.cpad;

  // White card.
  ctx.fillStyle = 'rgb(246, 247, 250)';
  roundRectPath(ctx, cardX, cardY, m.cardSize, m.cardSize, Math.round(short * 0.018));
  ctx.fill();

  // QR modules — integer rects on the white quiet zone, near-black for max contrast.
  ctx.fillStyle = '#0b0b12';
  const ox = cardX + m.pad;
  const oy = cardY + m.pad;
  for (let row = 0; row < qr.count; row++) {
    for (let col = 0; col < qr.count; col++) {
      if (qr.isDark(row, col)) {
        ctx.fillRect(ox + col * m.moduleSize, oy + row * m.moduleSize, m.moduleSize, m.moduleSize);
      }
    }
  }

  // Caption: host (bold) + a spaced uppercase call-to-action.
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const logoX = Math.round((m.contW - m.logoW) / 2);
  const logoY = cardY + m.cardSize + m.gap;
  drawLogo(ctx, logoX, logoY, m.logoW, m.logoH);

  const titleY = logoY + m.logoH + m.logoTitleGap + m.capTitle;
  ctx.font = `700 ${m.capTitle}px "Space Grotesk", system-ui, sans-serif`;
  ctx.fillStyle = 'rgba(247, 249, 252, 0.96)';
  ctx.fillText(qr.caption, m.contW / 2, titleY);

  ctx.font = `600 ${m.capSub}px "Space Grotesk", system-ui, sans-serif`;
  ctx.fillStyle = 'rgba(170, 182, 200, 0.82)';
  ctx.letterSpacing = `${Math.max(1, Math.round(short * 0.004))}px`;
  const subY = titleY + Math.round(short * 0.026) + m.capSub;
  ctx.fillText('SCAN TO ENTER THE CHAOS', m.contW / 2, subY);
  ctx.letterSpacing = '0px';

  // Red hashtag handle under the CTA.
  ctx.font = `700 ${m.capTag}px "Space Grotesk", system-ui, sans-serif`;
  ctx.fillStyle = '#ff3b3b';
  ctx.fillText('#lorenzclash', m.contW / 2, subY + Math.round(short * 0.022) + m.capTag);

  cardCache.set(key, canvas);
  return canvas;
}

// Eased 0→1 over [a,b].
function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// Paint one outro frame. The live composite is ALREADY drawn full-bleed by the recorder;
// here we add the frosted dark card + QR on top. `progress` is 0→1 across the whole outro;
// the card fades + scales in over the first ~18% then holds.
export function drawOutroOverlay(
  ctx: Ctx2D,
  _frame: CanvasImageSource,
  qr: QrMatrix,
  progress: number,
): void {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const short = Math.min(w, h);
  const m = metrics(short, qr.count);

  const contX = Math.round((w - m.contW) / 2);
  const contY = Math.round((h - m.contH) / 2);
  const cx = w / 2;
  const cy = h / 2;

  const appear = smoothstep(0, 0.18, progress);
  const scale = 0.92 + 0.08 * appear;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.translate(-cx, -cy);
  ctx.globalAlpha = appear;

  // Soft drop shadow + opaque dark base.
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
  ctx.shadowBlur = Math.round(short * 0.05);
  ctx.shadowOffsetY = Math.round(short * 0.012);
  ctx.fillStyle = 'rgb(8, 10, 16)';
  roundRectPath(ctx, contX, contY, m.contW, m.contH, m.radius);
  ctx.fill();
  ctx.restore();

  // Border in the logo red — exactly the help window's frame colour (CSS --logo-red).
  ctx.lineWidth = Math.max(1, Math.round(short * 0.0016));
  ctx.strokeStyle = 'rgb(169, 0, 0)';
  roundRectPath(ctx, contX, contY, m.contW, m.contH, m.radius);
  ctx.stroke();

  // Static QR + caption card (crisp).
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(getCard(qr, short), contX, contY);

  ctx.restore();
}
