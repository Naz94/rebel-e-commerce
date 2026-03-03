// ============================================================
// REBEL ENGINE — Visual Engine (lib/visual.js)
//
// Static  → DALL-E 3 with rotation-specific prompt + random style variant
// Animated → GIF via pureimage (pure JS, zero native deps)
//
// Returns: { type, buffer, mimeType, styleUsed, imageUrl }
// ============================================================

import * as PImage     from "pureimage";
import GIFEncoder      from "gifencoder";
import { PassThrough } from "stream";
import { generateImage, downloadImage } from "./generate.js";

const W  = "#FFFFFF";
const BG = "#080808";
const R  = "#FF2D2D";

// ─────────────────────────────────────────────────────────────
// PUBLIC
// ─────────────────────────────────────────────────────────────

export async function generateVisual(rotation) {
  const isAnimated = Math.random() < 0.5;
  return isAnimated
    ? generateAnimatedGIF(rotation.id)
    : generateStaticImage(rotation);
}

// ─────────────────────────────────────────────────────────────
// STATIC — DALL-E 3 with framing variant
// ─────────────────────────────────────────────────────────────

const STATIC_STYLE_VARIANTS = [
  {
    name:     "extreme-closeup",
    modifier: "Framing: extreme close-up — fill the frame completely. No context, no environment. Just the subject at maximum proximity.",
  },
  {
    name:     "wide-negative-space",
    modifier: "Framing: subject occupies only 30% of the frame, centred. The rest is pure black void. Vast negative space. Lonely and precise.",
  },
  {
    name:     "dutch-angle",
    modifier: "Framing: camera tilted 20 degrees — Dutch angle. Creates tension without being chaotic. Premium editorial photography technique.",
  },
  {
    name:     "overhead-flatlay",
    modifier: "Framing: shot directly from above, flat-lay style. Pure black surface. Subject arranged with mathematical precision.",
  },
  {
    name:     "motion-blur-still",
    modifier: "Framing: the subject is pin-sharp but the environment has subtle horizontal motion blur — frozen mid-movement.",
  },
];

async function generateStaticImage(rotation) {
  const variant = STATIC_STYLE_VARIANTS[Math.floor(Math.random() * STATIC_STYLE_VARIANTS.length)];

  const fullPrompt = `${rotation.imagePrompt}

${variant.modifier}

Non-negotiable: pure black background (#080808), white (#FFFFFF) as primary colour, red (#FF2D2D) used once as a single accent only. No gradients. No other colours. Square 1:1 format.`;

  const imageUrl = await generateImage({ ...rotation, imagePrompt: fullPrompt });
  const buffer   = await downloadImage(imageUrl);

  return {
    type:      "static",
    buffer,
    mimeType:  "image/png",
    styleUsed: `static-${variant.name}`,
    imageUrl,
  };
}

// ─────────────────────────────────────────────────────────────
// ANIMATED — GIF via pureimage
// ─────────────────────────────────────────────────────────────

const GIF_SIZE   = 480;
const GIF_FRAMES = 60;
const GIF_DELAY  = 60;

async function generateAnimatedGIF(rotationId) {
  const encoder = new GIFEncoder(GIF_SIZE, GIF_SIZE);
  const pass    = new PassThrough();
  const chunks  = [];

  pass.on("data", chunk => chunks.push(chunk));
  encoder.createReadStream().pipe(pass);
  encoder.start();
  encoder.setRepeat(0);
  encoder.setDelay(GIF_DELAY);
  encoder.setQuality(10);

  const animFn = getAnimationFn(rotationId);

  for (let frame = 0; frame < GIF_FRAMES; frame++) {
    const img = PImage.make(GIF_SIZE, GIF_SIZE);
    const ctx = img.getContext("2d");
    animFn(ctx, GIF_SIZE, frame, GIF_FRAMES);
    encoder.addFrame(ctx);
  }

  encoder.finish();
  await new Promise(resolve => pass.on("end", resolve));
  const buffer = Buffer.concat(chunks);

  return {
    type:      "animated",
    buffer,
    mimeType:  "image/gif",
    styleUsed: `animated-${rotationId}`,
    imageUrl:  null,
  };
}

// Map new rotation IDs to animation functions
// value_* and lab_* each get a thematically appropriate animation
function getAnimationFn(id) {
  const map = {
    value_react:    animDeep,       // neural network / component tree
    value_perf:     animPerf,       // performance bars / waterfall
    value_css:      animRoast,      // typographic / layout energy
    value_debug:    animDebug,      // terminal / console aesthetic
    lab_tool:       animLab,        // browser window materialising
    lab_template:   animCompliance, // vault / precision object
  };
  return map[id] ?? animDeep;
}

function col(hex, a = 1) {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${a.toFixed(3)})`;
}

// ── LAB TOOL — Browser window materialising ──────────────────
function animLab(ctx, s, f, total) {
  const t = f / total;

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, s, s);

  const winW  = s * 0.72;
  const winH  = s * 0.58;
  const winX  = (s - winW) / 2;
  const winY  = s * 0.18 + (1 - easeOut(t)) * s * 0.12;
  const alpha = easeOut(t);

  ctx.fillStyle   = col(W, 0.03 * alpha);
  ctx.fillRect(winX - 8, winY - 8, winW + 16, winH + 16);

  ctx.fillStyle   = col("#111111", alpha);
  ctx.fillRect(winX, winY, winW, winH);
  ctx.strokeStyle = col(W, 0.15 * alpha);
  ctx.lineWidth   = 1;
  ctx.strokeRect(winX, winY, winW, winH);

  const barH = winH * 0.1;
  ctx.fillStyle = col("#181818", alpha);
  ctx.fillRect(winX, winY, winW, barH);

  const tlY = winY + barH / 2;
  ["#FF5F57", "#FEBC2E", "#28C840"].forEach((c, i) => {
    ctx.fillStyle = col(c, alpha * 0.9);
    ctx.beginPath();
    ctx.arc(winX + 18 + i * 20, tlY, 5, 0, Math.PI * 2);
    ctx.fill();
  });

  const contentY = winY + barH + winH * 0.08;

  [0.4, 0.6, 0.3].forEach((w, i) => {
    const la = Math.max(0, Math.min(1, (t - 0.04 * (i + 3)) / 0.35));
    ctx.fillStyle = col(W, (i === 0 ? 0.7 : 0.3) * la);
    ctx.fillRect(winX + winW * 0.06, contentY + winH * 0.05 + i * winH * 0.055, winW * w, i === 0 ? winH * 0.04 : winH * 0.025);
  });

  const cardAlpha = Math.max(0, Math.min(1, (t - 0.3) / 0.4));
  const cardY = contentY + winH * 0.32;
  [0, 1, 2].forEach(i => {
    const cx2 = winX + winW * (0.06 + i * 0.31);
    ctx.fillStyle   = col("#1a1a1a", cardAlpha * 0.8);
    ctx.fillRect(cx2, cardY, winW * 0.27, winH * 0.28);
    ctx.strokeStyle = col(W, 0.08 * cardAlpha);
    ctx.lineWidth   = 0.5;
    ctx.strokeRect(cx2, cardY, winW * 0.27, winH * 0.28);
    ctx.fillStyle   = col(W, 0.4 * cardAlpha);
    ctx.fillRect(cx2 + 8, cardY + 12, winW * 0.18, winH * 0.025);
    ctx.fillStyle   = col(W, 0.2 * cardAlpha);
    ctx.fillRect(cx2 + 8, cardY + 22, winW * 0.22, winH * 0.018);
  });

  const dotAlpha = Math.max(0, Math.min(1, (t - 0.6) / 0.2));
  const dotPulse = 0.7 + Math.sin(t * Math.PI * 8) * 0.3;
  ctx.fillStyle = col(R, dotAlpha * dotPulse);
  ctx.beginPath();
  ctx.arc(winX + winW - 20, winY + barH / 2, 4, 0, Math.PI * 2);
  ctx.fill();
}

// ── VALUE_REACT / VALUE_PERF — Neural network / component tree ─
function animDeep(ctx, s, f, total) {
  const t = f / total;

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, s, s);

  const nodes = [
    {x:.5, y:.2, r:8, primary:true},
    {x:.28, y:.38, r:5, primary:false}, {x:.5, y:.38, r:5, primary:false}, {x:.72, y:.38, r:5, primary:false},
    {x:.18, y:.58, r:3, primary:false}, {x:.38, y:.58, r:3, primary:false}, {x:.5, y:.58, r:3, primary:false},
    {x:.62, y:.58, r:3, primary:false}, {x:.82, y:.58, r:3, primary:false},
    {x:.5, y:.76, r:6, primary:true},
  ];

  const edges = [[0,1],[0,2],[0,3],[1,4],[1,5],[2,5],[2,6],[3,6],[3,7],[3,8],[4,9],[5,9],[6,9],[7,9],[8,9]];

  edges.forEach(([a, b], i) => {
    const edgeT = Math.max(0, Math.min(1, (t - i * 0.035) * 4));
    if (edgeT <= 0) return;
    const na = nodes[a], nb = nodes[b];
    const ex = na.x*s + (nb.x*s - na.x*s) * edgeT;
    const ey = na.y*s + (nb.y*s - na.y*s) * edgeT;
    ctx.strokeStyle = col(W, 0.2);
    ctx.lineWidth   = 0.8;
    ctx.beginPath();
    ctx.moveTo(na.x*s, na.y*s);
    ctx.lineTo(ex, ey);
    ctx.stroke();
  });

  nodes.forEach((n, i) => {
    const nodeT = Math.max(0, Math.min(1, (t - i * 0.04 - 0.1) * 5));
    if (nodeT <= 0) return;
    const isRed = i === 9;
    const color = isRed ? R : W;
    const opacity = n.primary ? nodeT : nodeT * 0.6;

    ctx.strokeStyle = col(color, opacity * 0.15);
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.arc(n.x*s, n.y*s, n.r * 2.5, 0, Math.PI*2);
    ctx.stroke();

    ctx.fillStyle = col(color, opacity);
    ctx.beginPath();
    ctx.arc(n.x*s, n.y*s, n.r, 0, Math.PI*2);
    ctx.fill();
  });

  edges.forEach(([a, b], i) => {
    if (t < i * 0.035 + 0.15) return;
    const prog = ((t * 1.8 + i * 0.12) % 1);
    const na = nodes[a], nb = nodes[b];
    ctx.fillStyle = col(b === 9 ? R : W, 0.8);
    ctx.beginPath();
    ctx.arc(na.x*s + (nb.x*s - na.x*s) * prog, na.y*s + (nb.y*s - na.y*s) * prog, 2, 0, Math.PI*2);
    ctx.fill();
  });
}

// ── VALUE_PERF — Performance waterfall bars ───────────────────
function animPerf(ctx, s, f, total) {
  const t = f / total;

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, s, s);

  const bars = [
    { label: "TTFB",  w: 0.15, color: W,  y: 0.22 },
    { label: "FCP",   w: 0.32, color: W,  y: 0.32 },
    { label: "LCP",   w: 0.55, color: R,  y: 0.42 },
    { label: "TTI",   w: 0.70, color: W,  y: 0.52 },
    { label: "CLS",   w: 0.12, color: W,  y: 0.62 },
    { label: "INP",   w: 0.28, color: W,  y: 0.72 },
  ];

  bars.forEach((bar, i) => {
    const barT  = Math.max(0, Math.min(1, (t - i * 0.08) * 3));
    const barX  = s * 0.18;
    const barY  = s * bar.y;
    const barH  = s * 0.045;
    const barW  = s * 0.65 * bar.w * barT;

    // Track
    ctx.fillStyle = col(W, 0.05);
    ctx.fillRect(barX, barY, s * 0.65, barH);

    // Fill
    ctx.fillStyle = col(bar.color, barT * 0.8);
    ctx.fillRect(barX, barY, barW, barH);

    // Label
    ctx.fillStyle = col(W, barT * 0.4);
    ctx.fillRect(s * 0.04, barY + barH * 0.15, s * 0.1, barH * 0.7);
  });

  // Score circle
  const scoreAlpha = Math.max(0, (t - 0.7) * 3);
  ctx.strokeStyle  = col(R, scoreAlpha);
  ctx.lineWidth    = 2;
  ctx.beginPath();
  ctx.arc(s * 0.84, s * 0.47, s * 0.1, -Math.PI/2, -Math.PI/2 + Math.PI * 2 * 0.73 * scoreAlpha);
  ctx.stroke();

  ctx.fillStyle = col(W, scoreAlpha * 0.8);
  ctx.fillRect(s * 0.79, s * 0.45, s * 0.1, s * 0.03);
  ctx.fillRect(s * 0.80, s * 0.50, s * 0.07, s * 0.02);
}

// ── VALUE_CSS — Typographic / layout energy ───────────────────
function animRoast(ctx, s, f, total) {
  const t = f / total;

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, s, s);

  const barProgress = easeOut(Math.min(1, t * 3));
  ctx.fillStyle = col(R, 0.9);
  ctx.fillRect(s * 0.075, s * 0.38, s * 0.85 * barProgress, s * 0.18);

  const blockConfigs = [
    {x:.075, y:.22, w:.38, h:.09},
    {x:.47,  y:.22, w:.45, h:.09},
    {x:.075, y:.33, w:.22, h:.065},
    {x:.31,  y:.33, w:.30, h:.065},
    {x:.63,  y:.33, w:.29, h:.065},
  ];

  blockConfigs.forEach((b, i) => {
    const stagger = Math.max(0, Math.min(1, (t - 0.1 - i * 0.03) * 3));
    ctx.fillStyle = col(W, stagger * easeOut(Math.min(1, t * 2)));
    ctx.fillRect(b.x*s, b.y*s, b.w*s, b.h*s);
  });

  const ruleAlpha = Math.max(0, (t - 0.5) * 2);
  ctx.fillStyle   = col(W, ruleAlpha * 0.4);
  ctx.fillRect(s * 0.075, s * 0.62, s * 0.85, 1);

  [0.65, 0.68, 0.71].forEach((y, i) => {
    const la = Math.max(0, (t - 0.55 - i * 0.04) * 2.5);
    ctx.fillStyle = col(W, la * 0.25);
    ctx.fillRect(s * 0.075, y * s, s * (0.5 - i * 0.08), s * 0.018);
  });
}

// ── VALUE_DEBUG — Terminal / console aesthetic ────────────────
function animDebug(ctx, s, f, total) {
  const t = f / total;

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, s, s);

  const lines = [
    { y: 0.18, w: 0.55, color: W,  opacity: 0.6 },
    { y: 0.24, w: 0.40, color: W,  opacity: 0.3 },
    { y: 0.30, w: 0.65, color: W,  opacity: 0.3 },
    { y: 0.36, w: 0.20, color: W,  opacity: 0.15 },
    { y: 0.44, w: 0.72, color: R,  opacity: 0.9 }, // the error
    { y: 0.50, w: 0.50, color: R,  opacity: 0.5 },
    { y: 0.56, w: 0.30, color: R,  opacity: 0.3 },
    { y: 0.64, w: 0.60, color: W,  opacity: 0.2 },
    { y: 0.70, w: 0.45, color: W,  opacity: 0.2 },
    { y: 0.76, w: 0.35, color: W,  opacity: 0.15 },
  ];

  // Cursor blink
  const cursorVisible = Math.sin(t * Math.PI * 8) > 0;

  lines.forEach((line, i) => {
    const lineT = Math.max(0, Math.min(1, (t - i * 0.06) * 4));
    if (lineT <= 0) return;

    const indent = i > 3 && i < 7 ? s * 0.06 : 0;
    const x = s * 0.08 + indent;
    const y = s * line.y;
    const w = s * line.w * lineT;
    const h = s * 0.022;

    ctx.fillStyle = col(line.color, line.opacity * lineT);
    ctx.fillRect(x, y, w, h);

    // Cursor on last line
    if (i === lines.length - 1 && lineT >= 1 && cursorVisible) {
      ctx.fillStyle = col(W, 0.7);
      ctx.fillRect(x + w + 4, y, 8, h);
    }
  });

  // Bracket decoration
  const bracketAlpha = Math.max(0, (t - 0.15) * 2);
  ctx.strokeStyle = col(W, 0.08 * bracketAlpha);
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.moveTo(s * 0.05, s * 0.15);
  ctx.lineTo(s * 0.03, s * 0.15);
  ctx.lineTo(s * 0.03, s * 0.82);
  ctx.lineTo(s * 0.05, s * 0.82);
  ctx.stroke();
}

// ── COMPLIANCE — Vault door sealing ──────────────────────────
function animCompliance(ctx, s, f, total) {
  const t  = f / total;
  const cx = s * 0.5;
  const cy = s * 0.5;

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, s, s);

  const outerAlpha = easeOut(Math.min(1, t * 2));
  const outerR     = s * 0.38;

  ctx.strokeStyle = col(W, 0.12 * outerAlpha);
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
  ctx.stroke();

  for (let i = 0; i < 24; i++) {
    const tickAlpha = Math.max(0, Math.min(1, (t * 2 - i * 0.03)));
    if (tickAlpha <= 0) continue;
    const angle   = (i / 24) * Math.PI * 2 - Math.PI / 2;
    const isMajor = i % 6 === 0;
    const innerR  = outerR - (isMajor ? 12 : 6);
    ctx.strokeStyle = col(W, tickAlpha * (isMajor ? 0.5 : 0.2));
    ctx.lineWidth   = isMajor ? 1.5 : 0.5;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle) * outerR, cy + Math.sin(angle) * outerR);
    ctx.lineTo(cx + Math.cos(angle) * innerR, cy + Math.sin(angle) * innerR);
    ctx.stroke();
  }

  const innerR    = s * 0.26;
  const spinAngle = t * Math.PI * 0.4;
  ctx.strokeStyle = col(W, 0.25 * outerAlpha);
  ctx.lineWidth   = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
  ctx.stroke();

  for (let i = 0; i < 6; i++) {
    const boltAlpha = Math.max(0, Math.min(1, (t * 3 - i * 0.15)));
    const angle     = (i / 6) * Math.PI * 2 + spinAngle;
    ctx.fillStyle   = col(W, boltAlpha * 0.6);
    ctx.beginPath();
    ctx.arc(cx + Math.cos(angle) * innerR, cy + Math.sin(angle) * innerR, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  const lockAlpha = Math.max(0, Math.min(1, (t - 0.3) * 3));
  const lockW = s * 0.12;
  const lockH = s * 0.1;
  const lockX = cx - lockW / 2;
  const lockY = cy - lockH * 0.3;

  ctx.fillStyle   = col(W, 0.08 * lockAlpha);
  ctx.strokeStyle = col(W, 0.6 * lockAlpha);
  ctx.lineWidth   = 1.5;
  ctx.fillRect(lockX, lockY, lockW, lockH);
  ctx.strokeRect(lockX, lockY, lockW, lockH);

  const shackleH = lockH * 0.7 * Math.min(1, Math.max(0, (t - 0.4) * 2.5));
  ctx.strokeStyle = col(W, 0.6 * lockAlpha);
  ctx.lineWidth   = 1.5;
  ctx.beginPath();
  ctx.moveTo(lockX + lockW * 0.25, lockY);
  ctx.lineTo(lockX + lockW * 0.25, lockY - shackleH);
  ctx.arc(cx, lockY - shackleH, lockW * 0.25, Math.PI, 0);
  ctx.lineTo(lockX + lockW * 0.75, lockY);
  ctx.stroke();

  const redAlpha = Math.max(0, (t - 0.7) * 4);
  const redPulse = 0.6 + Math.sin(t * Math.PI * 6) * 0.4;
  ctx.fillStyle  = col(R, redAlpha * redPulse);
  ctx.beginPath();
  ctx.arc(cx, lockY + lockH * 0.45, 3, 0, Math.PI * 2);
  ctx.fill();

  const sweepAlpha = Math.max(0, (t - 0.6) * 2.5);
  if (sweepAlpha > 0) {
    ctx.strokeStyle = col(W, 0.4 * sweepAlpha);
    ctx.lineWidth   = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, outerR, -Math.PI / 2, -Math.PI / 2 + (t - 0.6) * 2.5 * Math.PI * 2);
    ctx.stroke();
  }
}

function easeOut(t) {
  return 1 - Math.pow(1 - t, 3);
}
