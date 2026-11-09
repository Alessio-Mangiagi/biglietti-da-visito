import { describe, expect, it } from 'vitest';
import { apply, detectCard, enhanceForOcr, homography, insetQuad, otsu, histogram, warpRGBA, warpSize, type Gray, type Quad } from '../src/scan/geometry';

const close = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe('homography', () => {
  it('maps the four corners exactly', () => {
    const from: Quad = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 60 }, { x: 0, y: 60 }];
    const to: Quad = [{ x: 12, y: 7 }, { x: 180, y: 20 }, { x: 170, y: 130 }, { x: 5, y: 110 }];
    const H = homography(from, to);
    from.forEach((p, i) => {
      const q = apply(H, p);
      close(q.x, to[i]!.x);
      close(q.y, to[i]!.y);
    });
  });
});

/** Synthetic photo: dark table, light rotated card with a dark "text" bar. */
function scene(w: number, h: number, quad: Quad): { rgba: Uint8ClampedArray; gray: Gray } {
  const rgba = new Uint8ClampedArray(w * h * 4);
  const inside = (x: number, y: number) => {
    // point-in-convex-polygon via cross products
    let sign = 0;
    for (let i = 0; i < 4; i++) {
      const a = quad[i]!;
      const b = quad[(i + 1) % 4]!;
      const c = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
      if (c !== 0) {
        if (sign && Math.sign(c) !== sign) return false;
        sign = Math.sign(c);
      }
    }
    return true;
  };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = inside(x, y) ? (y > h * 0.48 && y < h * 0.52 && x > w * 0.4 && x < w * 0.6 ? 40 : 235) : 35;
      const i = (y * w + x) * 4;
      rgba[i] = rgba[i + 1] = rgba[i + 2] = v;
      rgba[i + 3] = 255;
    }
  const g = new Uint8ClampedArray(w * h);
  for (let i = 0; i < w * h; i++) g[i] = rgba[i * 4]!;
  return { rgba, gray: { data: g, width: w, height: h } };
}

describe('detectCard', () => {
  it('finds the corners of a tilted light card on a dark background', () => {
    const quad: Quad = [{ x: 60, y: 50 }, { x: 330, y: 70 }, { x: 320, y: 235 }, { x: 50, y: 215 }];
    const found = detectCard(scene(400, 300, quad).gray);
    expect(found).not.toBeNull();
    found!.forEach((p, i) => {
      expect(Math.abs(p.x - quad[i]!.x)).toBeLessThan(4);
      expect(Math.abs(p.y - quad[i]!.y)).toBeLessThan(4);
    });
  });

  it('gives up on a uniform image', () => {
    const g = new Uint8ClampedArray(200 * 150).fill(128);
    expect(detectCard({ data: g, width: 200, height: 150 })).toBeNull();
  });
});

describe('warp', () => {
  it('straightens the card into a rectangle of the card ratio', () => {
    const quad: Quad = [{ x: 60, y: 50 }, { x: 330, y: 70 }, { x: 320, y: 235 }, { x: 50, y: 215 }];
    const { rgba } = scene(400, 300, quad);
    const { width, height } = warpSize(quad, 1600);
    expect(width / height).toBeGreaterThan(1.4);
    const out = warpRGBA({ data: rgba, width: 400, height: 300 }, quad, width, height);
    // corners of the output are card-coloured, not table-coloured
    for (const [x, y] of [[3, 3], [width - 4, 3], [3, height - 4], [width - 4, height - 4]] as const) {
      expect(out[(y * width + x) * 4]).toBeGreaterThan(200);
    }
  });

  it('builds a default inset quad', () => {
    expect(insetQuad(100, 50, 0.1)[2]).toEqual({ x: 90, y: 45 });
  });
});

describe('enhanceForOcr', () => {
  it('stretches contrast and inverts dark cards', () => {
    const data = new Uint8ClampedArray(1000);
    for (let i = 0; i < 1000; i++) data[i] = i < 900 ? 30 : 90; // dark stock, light text
    const out = enhanceForOcr({ data, width: 100, height: 10 });
    expect(out.data[0]).toBeGreaterThan(200); // background now light
    expect(out.data[999]).toBeLessThan(50); // text now dark
  });

  it('otsu splits a bimodal histogram between the modes', () => {
    const data = new Uint8ClampedArray(200);
    data.fill(20, 0, 100);
    data.fill(220, 100);
    const t = otsu(histogram(data));
    expect(t).toBeGreaterThanOrEqual(20);
    expect(t).toBeLessThan(220);
  });
});
