/** Pure image maths (no DOM) — perspective warp, card detection, contrast. Unit-tested. */

export interface Pt {
  x: number;
  y: number;
}
/** Corners in order: top-left, top-right, bottom-right, bottom-left. */
export type Quad = [Pt, Pt, Pt, Pt];

export interface Gray {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** ISO/IEC 7810 ID-1 (85.60 × 53.98 mm) — standard business card ratio. */
export const CARD_RATIO = 85.6 / 53.98;

export const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

export function insetQuad(w: number, h: number, inset = 0.06): Quad {
  const dx = w * inset;
  const dy = h * inset;
  return [
    { x: dx, y: dy },
    { x: w - dx, y: dy },
    { x: w - dx, y: h - dy },
    { x: dx, y: h - dy },
  ];
}

/** Solves A·x = b (n×n) by Gaussian elimination with partial pivoting. */
function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[p]![c]!)) p = r;
    [M[c], M[p]] = [M[p]!, M[c]!];
    const pivot = M[c]![c]!;
    if (Math.abs(pivot) < 1e-12) throw new Error('Quadrilatero degenere');
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r]![c]! / pivot;
      for (let k = c; k <= n; k++) M[r]![k]! -= f * M[c]![k]!;
    }
  }
  return M.map((row, i) => row[n]! / row[i]!);
}

/** 3×3 homography (row-major, h33 = 1) mapping each `from` point onto the matching `to` point. */
export function homography(from: Quad, to: Quad): number[] {
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i]!;
    const { x: u, y: v } = to[i]!;
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  return [...solve(A, b), 1];
}

export function apply(H: number[], p: Pt): Pt {
  const w = H[6]! * p.x + H[7]! * p.y + H[8]!;
  return { x: (H[0]! * p.x + H[1]! * p.y + H[2]!) / w, y: (H[3]! * p.x + H[4]! * p.y + H[5]!) / w };
}

/** Output size for a quad: keeps its own aspect, longest side ≤ maxSide. */
export function warpSize(q: Quad, maxSide: number): { width: number; height: number } {
  const w = Math.max(dist(q[0], q[1]), dist(q[3], q[2]));
  const h = Math.max(dist(q[0], q[3]), dist(q[1], q[2]));
  const k = Math.min(1, maxSide / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) };
}

/** Perspective-corrects the quad of an RGBA image into a width×height rectangle (bilinear). */
export function warpRGBA(
  src: { data: Uint8ClampedArray; width: number; height: number },
  quad: Quad,
  width: number,
  height: number,
): Uint8ClampedArray<ArrayBuffer> {
  const rect: Quad = [
    { x: 0, y: 0 },
    { x: width - 1, y: 0 },
    { x: width - 1, y: height - 1 },
    { x: 0, y: height - 1 },
  ];
  const H = homography(rect, quad); // output pixel → source pixel
  const out = new Uint8ClampedArray(width * height * 4);
  const sw = src.width;
  const sh = src.height;
  const s = src.data;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const w = H[6]! * x + H[7]! * y + H[8]!;
      let sx = (H[0]! * x + H[1]! * y + H[2]!) / w;
      let sy = (H[3]! * x + H[4]! * y + H[5]!) / w;
      sx = Math.min(Math.max(sx, 0), sw - 1.001);
      sy = Math.min(Math.max(sy, 0), sh - 1.001);
      const x0 = sx | 0;
      const y0 = sy | 0;
      const fx = sx - x0;
      const fy = sy - y0;
      const i00 = (y0 * sw + x0) * 4;
      const i10 = i00 + 4;
      const i01 = i00 + sw * 4;
      const i11 = i01 + 4;
      const o = (y * width + x) * 4;
      for (let c = 0; c < 4; c++) {
        const top = s[i00 + c]! + (s[i10 + c]! - s[i00 + c]!) * fx;
        const bot = s[i01 + c]! + (s[i11 + c]! - s[i01 + c]!) * fx;
        out[o + c] = top + (bot - top) * fy;
      }
    }
  }
  return out;
}

export function toGray(src: { data: Uint8ClampedArray; width: number; height: number }): Gray {
  const n = src.width * src.height;
  const g = new Uint8ClampedArray(n);
  const d = src.data;
  for (let i = 0; i < n; i++) g[i] = (d[i * 4]! * 299 + d[i * 4 + 1]! * 587 + d[i * 4 + 2]! * 114) / 1000;
  return { data: g, width: src.width, height: src.height };
}

export function histogram(g: Uint8ClampedArray): Uint32Array {
  const h = new Uint32Array(256);
  for (let i = 0; i < g.length; i++) h[g[i]!]!++;
  return h;
}

export function otsu(hist: Uint32Array): number {
  let total = 0;
  let sum = 0;
  for (let i = 0; i < 256; i++) {
    total += hist[i]!;
    sum += i * hist[i]!;
  }
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let threshold = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]!;
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t]!;
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  return threshold;
}

function percentile(hist: Uint32Array, total: number, p: number): number {
  let acc = 0;
  for (let i = 0; i < 256; i++) {
    acc += hist[i]!;
    if (acc >= total * p) return i;
  }
  return 255;
}

/**
 * OCR pre-processing: grayscale, 1–99 % contrast stretch, inverted when the card is
 * dark (light text on dark stock reads better as dark-on-light).
 */
export function enhanceForOcr(g: Gray): Gray {
  const hist = histogram(g.data);
  const n = g.data.length;
  const lo = percentile(hist, n, 0.01);
  const hi = Math.max(lo + 1, percentile(hist, n, 0.99));
  const invert = percentile(hist, n, 0.5) < 110;
  const out = new Uint8ClampedArray(n);
  const k = 255 / (hi - lo);
  for (let i = 0; i < n; i++) {
    const v = (g.data[i]! - lo) * k;
    out[i] = invert ? 255 - v : v;
  }
  return { data: out, width: g.width, height: g.height };
}

/**
 * Finds the card as the largest blob that contrasts with the background (Otsu split,
 * flood fill from the centre) and returns its corners. Works for a light card on a dark
 * table and vice versa; returns null when unsure so the caller falls back to the guide.
 */
export function detectCard(g: Gray): Quad | null {
  const { width: w, height: h, data } = g;
  if (w < 20 || h < 20) return null;
  const t = otsu(histogram(data));

  // which side of the threshold is the card? the one dominating the centre
  let bright = 0;
  let count = 0;
  for (let y = Math.floor(h * 0.35); y < h * 0.65; y++) {
    for (let x = Math.floor(w * 0.35); x < w * 0.65; x++) {
      bright += data[y * w + x]! > t ? 1 : 0;
      count++;
    }
  }
  const cardBright = bright >= count / 2;
  const isCard = (i: number) => (data[i]! > t) === cardBright;

  // seed: nearest card pixel to the centre
  let seed = -1;
  const cx = w >> 1;
  const cy = h >> 1;
  for (let r = 0; r < Math.min(w, h) / 4 && seed < 0; r++) {
    for (let dy = -r; dy <= r && seed < 0; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const i = (cy + dy) * w + (cx + dx);
        if (isCard(i)) {
          seed = i;
          break;
        }
      }
    }
  }
  if (seed < 0) return null;

  const seen = new Uint8Array(w * h);
  const stack = [seed];
  seen[seed] = 1;
  let area = 0;
  let tl = seed;
  let br = seed;
  let tr = seed;
  let bl = seed;
  const sumOf = (i: number) => (i % w) + ((i / w) | 0);
  const diffOf = (i: number) => (i % w) - ((i / w) | 0);
  let touchesBorder = 0;
  const visit = (j: number) => {
    if (!seen[j] && isCard(j)) {
      seen[j] = 1;
      stack.push(j);
    }
  };
  while (stack.length) {
    const i = stack.pop()!;
    area++;
    const x = i % w;
    const y = (i / w) | 0;
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touchesBorder++;
    if (sumOf(i) < sumOf(tl)) tl = i;
    if (sumOf(i) > sumOf(br)) br = i;
    if (diffOf(i) > diffOf(tr)) tr = i;
    if (diffOf(i) < diffOf(bl)) bl = i;
    if (x > 0) visit(i - 1);
    if (x < w - 1) visit(i + 1);
    if (y > 0) visit(i - w);
    if (y < h - 1) visit(i + w);
  }
  const frac = area / (w * h);
  // the blob leaking along the frame means background and card were not separated
  if (frac < 0.12 || frac > 0.95 || touchesBorder > (w + h) * 0.5) return null;
  const pt = (i: number): Pt => ({ x: i % w, y: (i / w) | 0 });
  const quad: Quad = [pt(tl), pt(tr), pt(br), pt(bl)];
  if (quadArea(quad) < w * h * 0.1) return null;
  return quad;
}

export function quadArea(q: Quad): number {
  let a = 0;
  for (let i = 0; i < 4; i++) {
    const p = q[i]!;
    const n = q[(i + 1) % 4]!;
    a += p.x * n.y - n.x * p.y;
  }
  return Math.abs(a) / 2;
}

export function scaleQuad(q: Quad, k: number): Quad {
  return q.map((p) => ({ x: p.x * k, y: p.y * k })) as Quad;
}
