import type { Shape } from '../../../server/types';

/** Canvas renderer for normalized shapes. Kept geometrically in sync with server/render.ts. */
export function drawShape(ctx: CanvasRenderingContext2D, s: Shape, w: number, h: number, alpha = 1) {
  const P = s.points.map(([x, y]) => [x * w, y * h] as [number, number]);
  if (!P.length) return;
  const lw = Math.max(1, s.width * h);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const path = new Path2D();
  const a = P[0], b = P[P.length - 1];
  switch (s.tool) {
    case 'pen': {
      path.moveTo(a[0], a[1]);
      if (P.length < 3) { for (const p of P) path.lineTo(p[0], p[1]); if (P.length === 1) path.lineTo(a[0] + 0.01, a[1]); }
      else {
        for (let i = 1; i < P.length - 1; i++) {
          const mx = (P[i][0] + P[i + 1][0]) / 2, my = (P[i][1] + P[i + 1][1]) / 2;
          path.quadraticCurveTo(P[i][0], P[i][1], mx, my);
        }
        path.lineTo(b[0], b[1]);
      }
      break;
    }
    case 'rect':
      path.rect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
      break;
    case 'ellipse':
      path.ellipse((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.abs(b[0] - a[0]) / 2, Math.abs(b[1] - a[1]) / 2, 0, 0, Math.PI * 2);
      break;
    case 'arrow': {
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const head = Math.min(len * 0.45, lw * 4.5 + 8);
      path.moveTo(a[0], a[1]); path.lineTo(b[0], b[1]);
      path.moveTo(b[0] - head * Math.cos(ang - 0.5), b[1] - head * Math.sin(ang - 0.5));
      path.lineTo(b[0], b[1]);
      path.lineTo(b[0] - head * Math.cos(ang + 0.5), b[1] - head * Math.sin(ang + 0.5));
      break;
    }
  }
  // soft halo for legibility on any footage, then the stroke
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = lw + Math.max(3, lw);
  ctx.stroke(path);
  ctx.strokeStyle = s.color;
  ctx.lineWidth = lw;
  ctx.stroke(path);
  ctx.restore();
}

/** Douglas–Peucker simplification keeps stored pen strokes small. */
export function simplify(pts: [number, number][], eps = 0.0012): [number, number][] {
  if (pts.length < 3) return pts;
  const [a, b] = [pts[0], pts[pts.length - 1]];
  let idx = -1, max = 0;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1e-9;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + b[0] * a[1] - b[1] * a[0]) / len;
    if (d > max) { max = d; idx = i; }
  }
  if (max <= eps) return [a, b];
  return [...simplify(pts.slice(0, idx + 1), eps).slice(0, -1), ...simplify(pts.slice(idx), eps)];
}

export const DRAW_COLORS = ['#ff5a4e', '#ffd23f', '#b9ec8f', '#4fb3ff', '#ffffff'];
