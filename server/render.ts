import zlib from 'node:zlib';
import type { Shape } from './types.js';
import type { RGBAFrame } from './media.js';

type Pt = [number, number];

/** Expands a shape into polylines in pixel space. Mirrors web/src/lib/shapes.ts. */
export function shapeToPolylines(s: Shape, w: number, h: number): Pt[][] {
  const P = s.points.map(([x, y]) => [x * w, y * h] as Pt);
  if (!P.length) return [];
  const lw = Math.max(1, s.width * h);
  switch (s.tool) {
    case 'pen':
      return [P.length === 1 ? [P[0], P[0]] : P];
    case 'rect': {
      const [a, b] = [P[0], P[P.length - 1]];
      return [[a, [b[0], a[1]], b, [a[0], b[1]], a]];
    }
    case 'ellipse': {
      const [a, b] = [P[0], P[P.length - 1]];
      const cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2;
      const rx = Math.abs(b[0] - a[0]) / 2, ry = Math.abs(b[1] - a[1]) / 2;
      const n = Math.max(24, Math.ceil((rx + ry) / 3));
      const pts: Pt[] = [];
      for (let i = 0; i <= n; i++) {
        const t = (i / n) * Math.PI * 2;
        pts.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]);
      }
      return [pts];
    }
    case 'arrow': {
      const [a, b] = [P[0], P[P.length - 1]];
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const head = Math.min(len * 0.45, lw * 4.5 + 8);
      const l: Pt = [b[0] - head * Math.cos(ang - 0.5), b[1] - head * Math.sin(ang - 0.5)];
      const r: Pt = [b[0] - head * Math.cos(ang + 0.5), b[1] - head * Math.sin(ang + 0.5)];
      return [[a, b], [l, b, r]];
    }
  }
}

function hex(c: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(c);
  const n = m ? parseInt(m[1], 16) : 0xff4d4d;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Anti-aliased thick polyline rasterizer. Coverage is accumulated with `max` into a per-shape
 * mask so overlapping segments/joints never double-blend, then composited once.
 */
function strokeMask(frame: RGBAFrame, lines: Pt[][], radius: number, rgb: [number, number, number], opacity: number) {
  const { width: W, height: H, data } = frame;
  let minX = W, minY = H, maxX = 0, maxY = 0;
  for (const l of lines) for (const [x, y] of l) {
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  const pad = radius + 2;
  const x0 = Math.max(0, Math.floor(minX - pad)), y0 = Math.max(0, Math.floor(minY - pad));
  const x1 = Math.min(W - 1, Math.ceil(maxX + pad)), y1 = Math.min(H - 1, Math.ceil(maxY + pad));
  if (x1 < x0 || y1 < y0) return;
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  const mask = new Float32Array(bw * bh);
  for (const l of lines) {
    for (let i = 0; i < l.length - 1 || (l.length === 1 && i === 0); i++) {
      const [ax, ay] = l[i];
      const [bx, by] = l[Math.min(i + 1, l.length - 1)];
      const sx0 = Math.max(x0, Math.floor(Math.min(ax, bx) - pad)), sx1 = Math.min(x1, Math.ceil(Math.max(ax, bx) + pad));
      const sy0 = Math.max(y0, Math.floor(Math.min(ay, by) - pad)), sy1 = Math.min(y1, Math.ceil(Math.max(ay, by) + pad));
      const dx = bx - ax, dy = by - ay;
      const len2 = dx * dx + dy * dy || 1e-9;
      for (let y = sy0; y <= sy1; y++) {
        for (let x = sx0; x <= sx1; x++) {
          const px = x + 0.5 - ax, py = y + 0.5 - ay;
          const t = Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
          const d = Math.hypot(px - t * dx, py - t * dy);
          const cov = Math.max(0, Math.min(1, radius + 0.5 - d));
          if (cov > 0) {
            const k = (y - y0) * bw + (x - x0);
            if (cov > mask[k]) mask[k] = cov;
          }
        }
      }
    }
  }
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const a = mask[y * bw + x] * opacity;
      if (a <= 0) continue;
      const o = ((y + y0) * W + (x + x0)) * 4;
      data[o] = data[o] + (rgb[0] - data[o]) * a;
      data[o + 1] = data[o + 1] + (rgb[1] - data[o + 1]) * a;
      data[o + 2] = data[o + 2] + (rgb[2] - data[o + 2]) * a;
    }
  }
}

/** Burns shapes into the frame in place: a soft dark halo first (legibility), then the color. */
export function burnShapes(frame: RGBAFrame, shapes: Shape[]): void {
  for (const s of shapes) {
    const lines = shapeToPolylines(s, frame.width, frame.height);
    const r = Math.max(1, (s.width * frame.height) / 2);
    strokeMask(frame, lines, r + Math.max(1.5, r * 0.5), [0, 0, 0], 0.35);
    strokeMask(frame, lines, r, hex(s.color), 1);
  }
}

// ---------- Minimal PNG encoder (RGBA, filter 0) ----------
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
export function encodePNG(frame: RGBAFrame): Buffer {
  const { width: W, height: H, data } = frame;
  const raw = Buffer.alloc((W * 4 + 1) * H);
  for (let y = 0; y < H; y++) {
    raw[y * (W * 4 + 1)] = 0;
    data.copy(raw, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
