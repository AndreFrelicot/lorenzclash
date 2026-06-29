// Inline-SVG icon system for the UI. Each icon is the inner markup of a 24×24
// stroke icon, drawn in `currentColor` (so it inherits the white UI foreground and
// can be themed/animated via CSS). These are SEMANTIC PLACEHOLDERS — coherent with
// each function but rough; replace the entries in ICONS with polished SVG paths
// later without touching any call site.

export type IconName =
  | 'camera'
  | 'synthetic'
  | 'split'
  | 'view'
  | 'trail'
  | 'shape'
  | 'auto'
  | 'music'
  | 'music-muted'
  | 'track'
  | 'slowmo'
  | 'speed'
  | 'margin'
  | 'rotate'
  | 'aspect'
  | 'help'
  | 'close'
  | 'warning'
  | 'headphones'
  | 'drag'
  | 'arrow-left'
  | 'arrow-right'
  | 'snapshot'
  | 'export'
  | 'sound'
  | 'check'
  | 'keep'
  | 'zoom'
  | 'lock'
  | 'trash';

const ICONS: Record<IconName, string> = {
  // Camera body + lens.
  camera:
    '<rect x="3" y="6.5" width="18" height="12.5" rx="2"/><circle cx="12" cy="12.5" r="3.4"/><path d="M8 6.5l1.4-2.2h5.2L16 6.5"/>',
  // Procedural wave (synthetic material).
  synthetic: '<path d="M3 13c2.2-4.5 4.4-4.5 6.6 0s4.4 4.5 6.6 0 2.2-4.5 4.8 0"/>',
  // Split frame: camera lens (left half) ↔ procedural wave (right half).
  split:
    '<rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="M12 5.5v13"/><circle cx="7.5" cy="12" r="2.1"/><path d="M14 13c0.8-1.7 1.6-1.7 2.4 0s1.6 1.7 2.4 0"/>',
  // Eye (the view / follow camera).
  view: '<path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  // Fading dashes (the trail).
  trail:
    '<path d="M3 12h4"/><path d="M10.5 12h3.2" opacity="0.65"/><path d="M17.5 12h2.2" opacity="0.35"/>',
  // Square + circle (plane ↔ cube ↔ sphere).
  shape: '<rect x="3.5" y="3.5" width="11" height="11" rx="1.2"/><circle cx="15" cy="15" r="5.2"/>',
  // Wand + sparkle (auto-director).
  auto: '<path d="M5 19L15.5 8.5"/><path d="M13.5 6.5l4 4"/><path d="M18 3l.9 1.9L21 5.8l-2.1.9L18 8.8l-.9-2.1L15 5.8l2.1-.9z"/>',
  // Music note (two heads + stems).
  music:
    '<circle cx="7" cy="18" r="2.4"/><circle cx="17" cy="16" r="2.4"/><path d="M9.4 18V6.2l10-2.2V16"/>',
  // Music + slash (muted: analysed but silent).
  'music-muted':
    '<circle cx="7" cy="18" r="2.4"/><circle cx="17" cy="16" r="2.4"/><path d="M9.4 18V6.2l10-2.2V16"/><path d="M3.5 3.5l17 17"/>',
  // List + play (next track).
  track: '<path d="M4 7h12"/><path d="M4 11h12"/><path d="M4 15h8"/><path d="M15 13l5 3-5 3z"/>',
  // Hourglass (slow-mo).
  slowmo:
    '<path d="M6 3.5h12"/><path d="M6 20.5h12"/><path d="M7 4.5l10 15"/><path d="M17 4.5L7 19.5"/>',
  // Double chevron (speed).
  speed: '<path d="M5 6.5l6 5.5-6 5.5"/><path d="M12 6.5l6 5.5-6 5.5"/>',
  // Frame + inner crop (margin / framing).
  margin:
    '<rect x="3.5" y="3.5" width="17" height="17" rx="1.5"/><rect x="8" y="8" width="8" height="8" rx="1" opacity="0.55"/>',
  // Circular arrow (rotate the camera feed by 90°).
  rotate: '<path d="M20 11.5a8 8 0 1 0-2.1 5.9"/><path d="M20 4.5v5h-5"/>',
  // Overlapping landscape + portrait frames (swap the source aspect — fix stretch).
  aspect:
    '<rect x="2.5" y="7.5" width="14" height="9" rx="1.2"/><rect x="7.5" y="3.5" width="9" height="14" rx="1.2" opacity="0.55"/>',
  // Question mark in a circle (help / legend).
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.3 9.2a2.8 2.8 0 0 1 5.4 1c0 1.9-2.7 2.3-2.7 4"/><path d="M12 17.2h.01"/>',
  // X (close / dismiss).
  close: '<path d="M6 6l12 12"/><path d="M18 6L6 18"/>',
  // Triangle + exclamation (photosensitivity / caution).
  warning: '<path d="M12 3.5L22 19.5H2z"/><path d="M12 9.5v4.5"/><path d="M12 17.2h.01"/>',
  // Headband + ear cups (headphones recommended).
  headphones:
    '<path d="M5 13.5v-1.5a7 7 0 0 1 14 0v1.5"/><rect x="3" y="13" width="4" height="6.5" rx="1.5"/><rect x="17" y="13" width="4" height="6.5" rx="1.5"/>',
  // Touch point + up/down arrows (drag gesture).
  drag: '<circle cx="12" cy="12" r="2.3"/><path d="M12 9V4.5"/><path d="M9.7 6.3L12 4l2.3 2.3"/><path d="M12 15v4.5"/><path d="M9.7 17.7L12 20l2.3-2.3"/>',
  // Arrows (pager navigation).
  'arrow-left': '<path d="M19 12H6"/><path d="M11.5 6l-6 6 6 6"/>',
  'arrow-right': '<path d="M5 12h13"/><path d="M12.5 6l6 6-6 6"/>',
  // Camera aperture / shutter (take a snapshot of the composited frame).
  snapshot:
    '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3"/><path d="M12 3.5a8.5 8.5 0 0 1 7.4 4.3"/><path d="M19.4 16.2A8.5 8.5 0 0 1 12 20.5"/><path d="M4.6 16.2A8.5 8.5 0 0 1 4.6 7.8"/>',
  // Tray with a down arrow (export / download the generated clip).
  export:
    '<path d="M12 3.5v10.5"/><path d="M8 10l4 4 4-4"/><path d="M5 16.5v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2"/>',
  // Speaker + waves (export "include sound" toggle).
  sound:
    '<path d="M4 9.5v5h3.3L12 18V6L7.3 9.5H4z"/><path d="M15 10a3 3 0 0 1 0 4"/><path d="M17.4 7.8a6.4 6.4 0 0 1 0 8.4"/>',
  // Check in a circle (export "include this clip" toggle).
  check: '<circle cx="12" cy="12" r="8.5"/><path d="M8 12.3l2.7 2.7L16.2 9.3"/>',
  // Star (export "keep this clip" toggle — never auto-evicted). Regular 5-point star,
  // symmetric vertices about the centre, outer radius 8.5 to match the check circle.
  keep: '<polygon points="12 3.5 14.63 8.82 20.5 9.68 16.25 13.82 17.25 19.67 12 16.9 6.75 19.67 7.75 13.82 3.5 9.68 9.37 8.82"/>',
  // Diagonal expand arrows (pinch-out / zoom gesture).
  zoom: '<path d="M4 9.5V5a1 1 0 0 1 1-1h4.5"/><path d="M4 4l6 6"/><path d="M20 14.5V19a1 1 0 0 1-1 1h-4.5"/><path d="M20 20l-6-6"/>',
  // Padlock (privacy / on-device, nothing uploaded).
  lock: '<rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/><path d="M12 14.2v2.6"/>',
  // Trash can — delete a clip.
  trash:
    '<path d="M4 7h16"/><path d="M6.5 7l1 12.5h9l1-12.5"/><path d="M9.5 7V4.5h5V7"/><path d="M10 10.5v6"/><path d="M14 10.5v6"/>',
};

const SVG_NS = 'http://www.w3.org/2000/svg';

// Build an inline <svg> for `name`. Inherits color via currentColor; class `ui-icon`.
export function makeIcon(name: IconName, size = 20): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.6');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('ui-icon');
  svg.innerHTML = ICONS[name];
  return svg;
}

// Brand mark — four triangles (two brand-red, two adaptive) forming the Lorenz Clash
// glyph. It's FILLED + two-tone, so it can't ride the stroke-based makeIcon: the dark pair
// renders in `currentColor` (→ the UI foreground) so it stays visible on the dark start
// screen, while the brand red is fixed. Aspect ≈ 300:263. Source of truth (keep in sync if
// the art changes): ./lorenzclash-logo.svg.
const LOGO_TRI = 'M823.044,3047.08L1016.083,3332.887L630.006,3332.887L823.044,3047.08Z';
const LOGO_RED = 'rgb(169,0,0)';
export function makeLogo(size = 64): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 300 263');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(Math.round((size * 263) / 300)));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('ui-icon'); // base rule: display:block + colour (drives currentColor)
  svg.innerHTML =
    '<g transform="matrix(1,0,0,1,-414.615713,-2829.571737)">' +
    `<g transform="matrix(0.43353,-0.43353,0.535881,0.535881,-1575.072734,1553.512475)"><path d="${LOGO_TRI}" fill="${LOGO_RED}"/></g>` +
    `<g transform="matrix(0.43353,0.43353,-0.535881,0.535881,1989.996309,865.793475)"><path d="${LOGO_TRI}" fill="${LOGO_RED}"/></g>` +
    `<g transform="matrix(0.125563,0.125563,-0.155207,0.155207,1016.20343,2351.856331)"><path d="${LOGO_TRI}" fill="currentColor"/></g>` +
    `<g transform="matrix(0.125563,-0.125563,0.155207,0.155207,-93.220988,2537.601934)"><path d="${LOGO_TRI}" fill="currentColor"/></g>` +
    '</g>';
  return svg;
}
