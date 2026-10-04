// Draws the boundary of each fundamental domain on the 2D overlay, with
// identified edges in the same color, so the player can see the topology.
import { C, R } from './geometry.js';

const pairColors = ['#e0a458', '#5fb3d9', '#9ad46a', '#e36d8e'];

// disk coordinates ([-1,1]^2, y up) -> canvas pixels
function toCanvas(ctx, x, y) {
  return [(x + 1) / 2 * ctx.canvas.width, (1 - y) / 2 * ctx.canvas.height];
}

function arrowHead(ctx, x, y, angle, size) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(size, 0);
  ctx.lineTo(-size, -size * 0.8);
  ctx.lineTo(-size, size * 0.8);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// Torus: left/right and top/bottom edges glued by translation; the usual
// single/double arrows show they are glued with the same orientation.
function drawTorus(ctx, s) {
  const { width: w, height: h } = ctx.canvas;
  const o = ctx.lineWidth / 2;
  const edges = [
    [pairColors[0], [o, h], [o, 0], 1],
    [pairColors[0], [w - o, h], [w - o, 0], 1],
    [pairColors[1], [0, h - o], [w, h - o], 2],
    [pairColors[1], [0, o], [w, o], 2],
  ];
  for (const [color, [x0, y0], [x1, y1], arrows] of edges) {
    ctx.strokeStyle = ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    const angle = Math.atan2(y1 - y0, x1 - x0);
    // the edge lies on the canvas border: push the arrows inwards
    const nx = x0 === x1 ? (x0 < w / 2 ? 10 : -10) * s : 0;
    const ny = y0 === y1 ? (y0 < h / 2 ? 10 : -10) * s : 0;
    for (let k = 0; k < arrows; k++) {
      const t = 0.5 + 0.07 * (k - (arrows - 1) / 2);
      arrowHead(ctx, x0 + t * (x1 - x0) + nx, y0 + t * (y1 - y0) + ny, angle, 9 * s);
    }
  }
}

// Projective plane: antipodal boundary points are glued, so the hue goes
// around twice and opposite points get the same color.
function drawProjective(ctx) {
  const [cx, cy] = toCanvas(ctx, 0, 0);
  const r = ctx.canvas.width / 2 - ctx.lineWidth / 2;
  const n = 96;
  for (let i = 0; i < n; i++) {
    ctx.strokeStyle = `hsl(${Math.round(720 * i / n) % 360}, 65%, 60%)`;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 2 * Math.PI * i / n, 2 * Math.PI * (i + 1) / n + 0.01);
    ctx.stroke();
  }
}

// Genus-2 surface: side i of the octagon is glued to side i+4.
function drawBitorus(ctx) {
  const scale = ctx.canvas.width / 2;
  const phi = Math.PI / 8;
  // vertices: where adjacent side circles meet, at angles (2i+1) pi/8
  const rv = C * Math.cos(phi) - Math.sqrt(R * R - (C * Math.sin(phi)) ** 2);
  for (let i = 0; i < 8; i++) {
    const th = i * Math.PI / 4;
    const [cx, cy] = toCanvas(ctx, C * Math.cos(th), C * Math.sin(th));
    const [x0, y0] = toCanvas(ctx, rv * Math.cos(th - phi), rv * Math.sin(th - phi));
    const [x1, y1] = toCanvas(ctx, rv * Math.cos(th + phi), rv * Math.sin(th + phi));
    const a0 = Math.atan2(y0 - cy, x0 - cx);
    const a1 = Math.atan2(y1 - cy, x1 - cx);
    // take the short arc, the one facing the origin
    let d = a1 - a0;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d <= -Math.PI) d += 2 * Math.PI;
    ctx.strokeStyle = pairColors[i % 4];
    ctx.beginPath();
    ctx.arc(cx, cy, R * scale, a0, a1, d < 0);
    ctx.stroke();
  }
}

// s: pixel scale relative to the 768px layout
export function drawGluing(ctx, geometry, s) {
  ctx.save();
  ctx.globalAlpha = 0.85;
  ctx.lineWidth = 4 * s;
  if (geometry === 'euclidean') drawTorus(ctx, s);
  else if (geometry === 'elliptic') drawProjective(ctx);
  else if (geometry === 'hyperbolic') drawBitorus(ctx);
  ctx.restore();
}
