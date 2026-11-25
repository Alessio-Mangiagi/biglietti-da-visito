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

/**
 * Opponent colour channels (red-green, blue-yellow) as grays. Edges that brightness alone
 * misses: a navy stripe on a dark desk, a white card on a brown wooden table.
 */
export function toChroma(src: { data: Uint8ClampedArray; width: number; height: number }): Gray[] {
  const n = src.width * src.height;
  const rg = new Uint8ClampedArray(n);
  const by = new Uint8ClampedArray(n);
  const d = src.data;
  for (let i = 0; i < n; i++) {
    const r = d[i * 4]!;
    const g = d[i * 4 + 1]!;
    const b = d[i * 4 + 2]!;
    rg[i] = 128 + (r - g) / 2;
    by[i] = 128 + (b - (r + g) / 2) / 2;
  }
  return [
    { data: rg, width: src.width, height: src.height },
    { data: by, width: src.width, height: src.height },
  ];
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

/** Separable box blur, radius r (edge pixels clamped). Kills paper texture and sensor noise. */
export function boxBlur(g: Gray, r = 2): Gray {
  const { width: w, height: h } = g;
  const tmp = new Float32Array(w * h);
  const out = new Uint8ClampedArray(w * h);
  const n = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = -r; k <= r; k++) s += g.data[row + Math.min(w - 1, Math.max(0, x + k))]!;
      tmp[row + x] = s / n;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = -r; k <= r; k++) s += tmp[Math.min(h - 1, Math.max(0, y + k)) * w + x]!;
      out[y * w + x] = s / n;
    }
  }
  return { data: out, width: w, height: h };
}

/** Sobel gradient magnitude (|gx| + |gy|, scaled to ~0-255); the frame is left at 0. */
export function gradient(g: Gray): Float32Array {
  const { width: w, height: h, data: d } = g;
  const mag = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = d[i - w + 1]! + 2 * d[i + 1]! + d[i + w + 1]! - d[i - w - 1]! - 2 * d[i - 1]! - d[i + w - 1]!;
      const gy = d[i + w - 1]! + 2 * d[i + w]! + d[i + w + 1]! - d[i - w - 1]! - 2 * d[i - w]! - d[i - w + 1]!;
      mag[i] = (Math.abs(gx) + Math.abs(gy)) / 4;
    }
  }
  return mag;
}

/** The card is the bright or the dark side of the Otsu split: whichever fills the centre. */
function maskByBrightness(b: Gray): Uint8Array {
  const { width: w, height: h, data } = b;
  const t = otsu(histogram(data));
  let bright = 0;
  let count = 0;
  for (let y = Math.floor(h * 0.35); y < h * 0.65; y++) {
    for (let x = Math.floor(w * 0.35); x < w * 0.65; x++) {
      bright += data[y * w + x]! > t ? 1 : 0;
      count++;
    }
  }
  const cardBright = bright >= count / 2;
  const m = new Uint8Array(w * h);
  for (let i = 0; i < m.length; i++) m[i] = data[i]! > t === cardBright ? 1 : 0;
  return m;
}

/**
 * Whatever the background cannot reach without crossing an edge: flood from the frame
 * through edge-free pixels. Works when card and table have the same brightness but the
 * card still has an outline (white card on a light desk, a shadow, a printed border).
 */
function maskByEdges(mag: Float32Array, w: number, h: number, edgeT: number): Uint8Array {
  const edge = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (mag[i]! < edgeT) continue;
      // dilate by one pixel: closes the small gaps a faint side leaves in the outline
      edge[i] = edge[i - 1] = edge[i + 1] = edge[i - w] = edge[i + w] = 1;
    }
  }
  const bg = new Uint8Array(w * h);
  const stack: number[] = [];
  const push = (i: number) => {
    if (!bg[i] && !edge[i]) {
      bg[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < w; x++) {
    push(x);
    push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    push(y * w);
    push(y * w + w - 1);
  }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (i >= w) push(i - w);
    if (i < w * (h - 1)) push(i + w);
  }
  for (let i = 0; i < bg.length; i++) bg[i] = bg[i] ? 0 : 1;
  return bg;
}

/** Morphological erosion (4-neighbour, r passes): breaks thin bridges to objects nearby. */
function erode(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  let cur = mask;
  for (let k = 0; k < r; k++) {
    const next = new Uint8Array(w * h);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        next[i] = cur[i] && cur[i - 1] && cur[i + 1] && cur[i - w] && cur[i + w] ? 1 : 0;
      }
    }
    cur = next;
  }
  return cur;
}

/** The connected part of `mask` nearest the centre: its area, boundary pixels and frame contact. */
function centreBlob(mask: Uint8Array, w: number, h: number) {
  let seed = -1;
  const cx = w >> 1;
  const cy = h >> 1;
  for (let r = 0; r < Math.min(w, h) / 4 && seed < 0; r++) {
    for (let dy = -r; dy <= r && seed < 0; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const i = (cy + dy) * w + (cx + dx);
        if (mask[i]) {
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
  const boundary: Pt[] = [];
  let area = 0;
  let onFrame = 0;
  while (stack.length) {
    const i = stack.pop()!;
    area++;
    const x = i % w;
    const y = (i / w) | 0;
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1) {
      onFrame++;
      boundary.push({ x, y });
    } else if (!mask[i - 1] || !mask[i + 1] || !mask[i - w] || !mask[i + w]) {
      boundary.push({ x, y });
    }
    const visit = (j: number) => {
      if (!seen[j] && mask[j]) {
        seen[j] = 1;
        stack.push(j);
      }
    };
    if (x > 0) visit(i - 1);
    if (x < w - 1) visit(i + 1);
    if (y > 0) visit(i - w);
    if (y < h - 1) visit(i + w);
  }
  return { area, boundary, onFrame };
}

const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** Convex hull (Andrew's monotone chain). */
export function convexHull(points: Pt[]): Pt[] {
  const p = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const lower: Pt[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: Pt[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, q) <= 0) upper.pop();
    upper.push(q);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

const tri = (a: Pt, b: Pt, c: Pt) => Math.abs(cross(a, b, c));

/** The largest-area quadrilateral with its corners on the hull vertices. */
function largestQuad(hull: Pt[]): Pt[] | null {
  let h = hull;
  if (h.length > 90) h = Array.from({ length: 90 }, (_, i) => hull[Math.floor((i * hull.length) / 90)]!);
  const n = h.length;
  if (n < 4) return null;
  let best = 0;
  let out: Pt[] | null = null;
  for (let i = 0; i < n; i++) {
    for (let k = i + 2; k < n; k++) {
      if (i === 0 && k === n - 1) continue;
      let a1 = 0;
      let j1 = -1;
      for (let j = i + 1; j < k; j++) {
        const a = tri(h[i]!, h[j]!, h[k]!);
        if (a > a1) [a1, j1] = [a, j];
      }
      let a2 = 0;
      let l2 = -1;
      for (let l = k + 1; l < n + i; l++) {
        const a = tri(h[k]!, h[l % n]!, h[i]!);
        if (a > a2) [a2, l2] = [a, l % n];
      }
      if (j1 >= 0 && l2 >= 0 && a1 + a2 > best) {
        best = a1 + a2;
        out = [h[i]!, h[j1]!, h[k]!, h[l2]!];
      }
    }
  }
  return out;
}

/** Corners as top-left, top-right, bottom-right, bottom-left (clockwise on screen). */
export function orderQuad(pts: Pt[]): Quad {
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  const byAngle = [...pts].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
  let first = 0;
  byAngle.forEach((p, i) => {
    if (p.x + p.y < byAngle[first]!.x + byAngle[first]!.y) first = i;
  });
  return [0, 1, 2, 3].map((k) => byAngle[(first + k) % 4]!) as Quad;
}

interface Line {
  p: Pt;
  d: Pt;
}

/** Total least squares line through the points (principal axis). */
function fitLine(pts: Pt[]): Line | null {
  if (pts.length < 4) return null;
  let mx = 0;
  let my = 0;
  for (const p of pts) {
    mx += p.x;
    my += p.y;
  }
  mx /= pts.length;
  my /= pts.length;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const p of pts) {
    const dx = p.x - mx;
    const dy = p.y - my;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return { p: { x: mx, y: my }, d: { x: Math.cos(theta), y: Math.sin(theta) } };
}

function intersect(a: Line, b: Line): Pt | null {
  const det = a.d.x * b.d.y - a.d.y * b.d.x;
  if (Math.abs(det) < 0.2) return null; // sides almost parallel: not a corner
  const t = ((b.p.x - a.p.x) * b.d.y - (b.p.y - a.p.y) * b.d.x) / det;
  return { x: a.p.x + t * a.d.x, y: a.p.y + t * a.d.y };
}

/** Mean of a[from..to] (inclusive), NaN when the range is empty. */
const mean = (a: number[], from: number, to: number) => {
  let s = 0;
  let n = 0;
  for (let i = Math.max(0, from); i <= Math.min(a.length - 1, to); i++) {
    s += a[i]!;
    n++;
  }
  return n ? s / n : NaN;
};

const magAt = (mag: Float32Array, w: number, h: number, x: number, y: number) => {
  const xi = Math.round(x);
  const yi = Math.round(y);
  return xi < 0 || yi < 0 || xi >= w || yi >= h ? 0 : mag[yi * w + xi]!;
};

/**
 * Snaps each side onto the strongest edge next to it (searching along the normal, away
 * from the rounded corners), fits a line per side and intersects neighbours: corners land
 * where the straight edges meet, even on cards with rounded corners.
 */
function refine(q: Quad, mag: Float32Array, lum: Float32Array, w: number, h: number, reach: number, edgeT: number): Quad {
  const lines: (Line | null)[] = [];
  for (let s = 0; s < 4; s++) {
    const a = q[s]!;
    const b = q[(s + 1) % 4]!;
    const len = dist(a, b);
    if (len < 8) return q;
    const nx = -(b.y - a.y) / len;
    const ny = (b.x - a.x) / len;
    const pts: Pt[] = [];
    const samples = Math.min(60, Math.max(12, Math.round(len / 3)));
    for (let k = 0; k <= samples; k++) {
      const t = 0.12 + (0.76 * k) / samples;
      const px = a.x + (b.x - a.x) * t;
      const py = a.y + (b.y - a.y) * t;
      // the normal points inside the card: scan from outside in and keep the first clear
      // edge, not the strongest one: a logo or text near the border can be stronger than
      // the card's outline, and a coloured stripe along the edge much weaker than its
      // inner side. A band darker than what lies outside it is a shadow: skip past it.
      const ms: number[] = [];
      const ls: number[] = [];
      for (let o = -reach; o <= reach; o += 0.5) {
        ms.push(magAt(mag, w, h, px + nx * o, py + ny * o));
        ls.push(magAt(lum, w, h, px + nx * o, py + ny * o));
      }
      const best = Math.max(...ms);
      if (best < edgeT) continue;
      const thr = Math.max(edgeT, best * 0.3);
      // each run of samples above the threshold is one edge, located at its maximum
      const peaks: number[] = [];
      const starts: number[] = [];
      for (let j = 0; j < ms.length; j++) {
        if (ms[j]! < thr) continue;
        starts.push(j);
        let top = j;
        while (j + 1 < ms.length && ms[j + 1]! >= thr) if (ms[++j]! > ms[top]!) top = j;
        peaks.push(top);
      }
      let pick = peaks[0]!;
      for (let k = 0; k + 1 < peaks.length; k++) {
        // an edge cut by the start of the window: what lies outside it is unknown
        if (starts[k] === 0) {
          pick = peaks[k + 1]!;
          continue;
        }
        const outside = mean(ls, peaks[k]! - 6, peaks[k]! - 2);
        const band = mean(ls, peaks[k]! + 2, peaks[k + 1]! - 2);
        if (Number.isNaN(outside) || Number.isNaN(band) || band > outside - 8) break;
        pick = peaks[k + 1]!;
      }
      const bo = -reach + pick * 0.5;
      pts.push({ x: px + nx * bo, y: py + ny * bo });
    }
    let line = fitLine(pts);
    if (line) {
      // one pass of outlier rejection (text or a logo close to the edge)
      const L = line;
      const res = (p: Pt) => Math.abs((p.x - L.p.x) * -L.d.y + (p.y - L.p.y) * L.d.x);
      const kept = pts.filter((p) => res(p) < 1.5);
      if (kept.length >= pts.length * 0.4) line = fitLine(kept) ?? line;
    }
    lines.push(line);
  }
  return q.map((p, i) => {
    const prev = lines[(i + 3) % 4];
    const cur = lines[i];
    const c = prev && cur ? intersect(prev, cur) : null;
    return c && dist(c, p) < reach * 3 ? c : p;
  }) as Quad;
}

/** Share of points along each side lying on an edge: the mean and the weakest side. */
function edgeSupport(q: Quad, mag: Float32Array, w: number, h: number, edgeT: number) {
  const per: number[] = [];
  for (let s = 0; s < 4; s++) {
    const a = q[s]!;
    const b = q[(s + 1) % 4]!;
    const len = dist(a, b);
    const nx = -(b.y - a.y) / len;
    const ny = (b.x - a.x) / len;
    let on = 0;
    const N = 40;
    for (let k = 0; k < N; k++) {
      const t = 0.08 + (0.84 * k) / (N - 1);
      const px = a.x + (b.x - a.x) * t;
      const py = a.y + (b.y - a.y) * t;
      let m = 0;
      for (let o = -1.5; o <= 1.5; o += 0.5) m = Math.max(m, magAt(mag, w, h, px + nx * o, py + ny * o));
      if (m >= edgeT) on++;
    }
    per.push(on / N);
  }
  return { mean: per.reduce((s, v) => s + v, 0) / 4, min: Math.min(...per) };
}

/** Plausible card outline: convex, roughly right angles, sensible size and shape. */
function plausible(q: Quad, w: number, h: number): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const c = cross(q[i]!, q[(i + 1) % 4]!, q[(i + 2) % 4]!);
    if (!c || (sign && Math.sign(c) !== sign)) return false;
    sign = Math.sign(c);
  }
  for (let i = 0; i < 4; i++) {
    const p = q[(i + 3) % 4]!;
    const c = q[i]!;
    const n = q[(i + 1) % 4]!;
    const cos = ((p.x - c.x) * (n.x - c.x) + (p.y - c.y) * (n.y - c.y)) / (dist(p, c) * dist(n, c));
    if (Math.abs(cos) > 0.6) return false; // corner outside ~53-127 degrees
  }
  const frac = quadArea(q) / (w * h);
  if (frac < 0.08 || frac > 0.97) return false;
  const sideA = (dist(q[0], q[1]) + dist(q[3], q[2])) / 2;
  const sideB = (dist(q[0], q[3]) + dist(q[1], q[2])) / 2;
  if (Math.max(sideA, sideB) / Math.min(sideA, sideB) > 3) return false;
  const m = Math.max(w, h) * 0.04;
  return q.every((p) => p.x > -m && p.y > -m && p.x < w + m && p.y < h + m);
}

/**
 * Finds the business card in a photo and returns its corners, or null when unsure (the
 * caller then falls back to the on-screen guide). Candidates come from two segmentations
 * (by brightness and by outline, each also eroded to detach objects touching the card)
 * and from `hint` (the guide the user framed the card in, or corners placed by hand)
 * snapped onto the nearby edges; the one whose four sides sit best on real edges wins.
 * `colour` (see `toChroma`) adds the edges between colours of similar brightness.
 * Expects a small image (~480 px), see `findCard`.
 */
const CHROMA_GAIN = 1.75;

export function detectCard(g: Gray, hint?: Quad, colour: Gray[] = []): Quad | null {
  const { width: w, height: h } = g;
  if (w < 20 || h < 20) return null;
  const blurR = Math.max(1, Math.round(Math.max(w, h) / 240));
  const b = boxBlur(g, blurR);
  const mag = gradient(b);
  // an edge in any colour channel counts as an edge; colour steps are smaller than
  // brightness steps for the same visible contrast, hence the gain
  for (const c of colour) {
    const cm = gradient(boxBlur(c, blurR));
    for (let i = 0; i < mag.length; i++) mag[i] = Math.max(mag[i]!, cm[i]! * CHROMA_GAIN);
  }
  const magHist = new Uint32Array(256);
  for (let i = 0; i < mag.length; i++) magHist[Math.min(255, mag[i]! | 0)]!++;
  // strong-edge level: Otsu on the gradient, never below what sensor noise produces
  const edgeT = Math.max(8, otsu(magHist));
  const reach = Math.max(3, Math.round(Math.max(w, h) / 80));
  const erodeBy = Math.max(2, Math.round(Math.max(w, h) / 160));

  let best: { q: Quad; score: number } | null = null;
  const lum = Float32Array.from(b.data);
  const consider = (start: Quad, firstReach: number, fill: (q: Quad) => number) => {
    let q = refine(start, mag, lum, w, h, firstReach, edgeT * 0.6);
    q = refine(q, mag, lum, w, h, reach, edgeT * 0.6);
    q = refine(q, mag, lum, w, h, reach, edgeT * 0.6);
    if (!plausible(q, w, h)) return;
    const support = edgeSupport(q, mag, w, h, edgeT * 0.6);
    if (support.min < 0.3 || support.mean < 0.55) return;
    const score = support.mean * (0.5 + 0.5 * fill(q));
    if (!best || score > best.score) best = { q, score };
  };

  const byBrightness = maskByBrightness(b);
  const byEdges = maskByEdges(mag, w, h, edgeT);
  for (const mask of [byBrightness, byEdges, erode(byBrightness, w, h, erodeBy), erode(byEdges, w, h, erodeBy)]) {
    const blob = centreBlob(mask, w, h);
    if (!blob) continue;
    const frac = blob.area / (w * h);
    // a blob running along the frame means background and card were not separated
    if (frac < 0.06 || frac > 0.95 || blob.onFrame > (w + h) * 0.5) continue;
    const corners = largestQuad(convexHull(blob.boundary));
    if (!corners) continue;
    // the blob should fill the outline: a quad far bigger than the blob is a bad fit
    consider(orderQuad(corners), reach * 2 + erodeBy, (q) => Math.min(1, blob.area / quadArea(q)));
  }
  if (hint && quadArea(hint) > w * h * 0.04) {
    // a framed card is usually within a tenth of the guide: search that far for its sides
    const size = Math.sqrt(quadArea(hint));
    consider(orderQuad(hint), Math.max(reach * 2, size * 0.12), () => 0.85);
  }
  const found = best as { q: Quad; score: number } | null;
  if (!found) return null;
  return found.q.map((p) => ({ x: Math.min(w, Math.max(0, p.x)), y: Math.min(h, Math.max(0, p.y)) })) as Quad;
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
