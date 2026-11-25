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

/** Harder synthetic photos: background, card tone, noise, uneven light, rounded corners, a logo. */
function photo(
  quad: Quad,
  o: { bg: number; card: number; noise?: number; light?: number; round?: number; logo?: boolean; clutter?: boolean; shadow?: boolean },
): Gray {
  const w = 480;
  const h = 360;
  let seed = 11;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const depth = (x: number, y: number) => {
    let m = Infinity;
    for (let i = 0; i < 4; i++) {
      const a = quad[i]!;
      const b = quad[(i + 1) % 4]!;
      m = Math.min(m, ((b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x)) / Math.hypot(b.x - a.x, b.y - a.y));
    }
    return m;
  };
  const r = o.round ?? 0;
  const inside = (x: number, y: number) => {
    const d = depth(x, y);
    if (d < 0) return false;
    // rounded corners: cut a quarter circle at each corner
    return !r || quad.every((c) => Math.hypot(x - c.x, y - c.y) > r * 0.45 || d > r * 0.6);
  };
  const data = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = o.bg;
      if (inside(x, y)) {
        v = o.card;
        // a dark logo starting just inside the left edge
        if (o.logo && x > quad[0].x + 14 && x < quad[0].x + 90 && y > 150 && y < 210) v = 255 - o.card;
      } else if (o.clutter && (x < 60 || (y > 330 && x > 150 && x < 300))) v = o.bg + 90;
      // soft drop shadow down and to the right, fading over ~10 px
      else if (o.shadow && depth(x - 5, y - 5) > -12) v = o.bg - 30 * Math.exp(Math.min(0, depth(x - 5, y - 5)) / 4);
      data[y * w + x] = v + (x / w - 0.5) * (o.light ?? 0) + (rnd() - 0.5) * (o.noise ?? 10);
    }
  return { data, width: w, height: h };
}

describe('detectCard on harder photos', () => {
  const card: Quad = [{ x: 105, y: 92 }, { x: 382, y: 78 }, { x: 392, y: 252 }, { x: 112, y: 268 }];
  const near = (found: Quad | null, eps = 3) => {
    expect(found).not.toBeNull();
    found!.forEach((p, i) => {
      expect(Math.abs(p.x - card[i]!.x)).toBeLessThan(eps);
      expect(Math.abs(p.y - card[i]!.y)).toBeLessThan(eps);
    });
  };

  it('white card on a light desk with uneven light', () => near(detectCard(photo(card, { bg: 170, card: 225, light: 80, noise: 30 }))));
  it('rounded corners: the corners land where the straight sides meet', () => near(detectCard(photo(card, { bg: 60, card: 235, round: 16 }))));
  it('a dark logo next to the edge does not pull the side inwards', () => near(detectCard(photo(card, { bg: 50, card: 230, logo: true }))));
  it('dark card on a light table', () => near(detectCard(photo(card, { bg: 215, card: 45 }))));
  it('light card on a light table with a soft shadow', () => near(detectCard(photo(card, { bg: 200, card: 238, shadow: true, noise: 16 }))));
  it('a navy stripe along the edge, as dark as the desk, stays on the card (colour edges)', () => {
    // in gray the stripe matches the desk; only the blue-yellow channel sets them apart
    const lum = photo(card, { bg: 50, card: 240, noise: 8 });
    const by = photo(card, { bg: 125, card: 127, noise: 4 });
    for (let y = 0; y < 360; y++)
      for (let x = 0; x < 480; x++) {
        const i = y * 480 + x;
        // the stripe: the first 16 px of the card from its left side
        const a = card[0];
        const b = card[3];
        const t = (y - a.y) / (b.y - a.y);
        const left = a.x + (b.x - a.x) * t;
        if (t > 0.02 && t < 0.98 && x >= left + 1 && x < left + 16) {
          lum.data[i] = 55;
          by.data[i] = 167;
        }
      }
    near(detectCard(lum, undefined, [by]));
  });
  it('snaps the guide frame onto the card among other objects', () => {
    const guide = card.map((p, i) => ({ x: p.x + (i % 2 ? 14 : -12), y: p.y + (i < 2 ? -10 : 13) })) as Quad;
    near(detectCard(photo(card, { bg: 70, card: 225, clutter: true }), guide));
  });
  it('gives up on noise instead of inventing a card', () => {
    expect(detectCard(photo(card, { bg: 128, card: 128, noise: 60 }))).toBeNull();
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
