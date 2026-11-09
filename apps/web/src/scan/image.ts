import { detectCard, enhanceForOcr, insetQuad, scaleQuad, toGray, warpRGBA, warpSize, type Quad } from './geometry';

/**
 * iOS Safari refuses canvases above ~16.7 MP and runs out of memory well before:
 * every capture is brought down to this longest side first.
 */
export const MAX_SIDE = 2048;
/** Stored card photo: enough for ~300 dpi on an 85 mm card. */
export const STORE_SIDE = 1600;

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas non disponibile');
  return ctx;
}

function fitScale(w: number, h: number, max: number) {
  return Math.min(1, max / Math.max(w, h));
}

/** Decodes a photo (JPEG/PNG/HEIC where the browser supports it), EXIF orientation applied. */
export async function loadImage(file: Blob): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    const k = fitScale(img.naturalWidth, img.naturalHeight, MAX_SIDE);
    const c = makeCanvas(img.naturalWidth * k, img.naturalHeight * k);
    ctx2d(c).drawImage(img, 0, 0, c.width, c.height);
    return c;
  } catch {
    throw new Error('Immagine non leggibile. Usa una foto JPEG o PNG.');
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function captureVideo(video: HTMLVideoElement): HTMLCanvasElement {
  const k = fitScale(video.videoWidth, video.videoHeight, MAX_SIDE);
  const c = makeCanvas(video.videoWidth * k, video.videoHeight * k);
  ctx2d(c).drawImage(video, 0, 0, c.width, c.height);
  return c;
}

/**
 * Maps the on-screen guide frame to pixel coordinates of a frame captured from a
 * `<video style="object-fit: cover">`.
 */
export function guideToFrame(video: HTMLVideoElement, guide: DOMRect, frameW: number, frameH: number): Quad {
  const vr = video.getBoundingClientRect();
  const scale = Math.max(vr.width / video.videoWidth, vr.height / video.videoHeight);
  const shownW = video.videoWidth * scale;
  const shownH = video.videoHeight * scale;
  const offX = (shownW - vr.width) / 2;
  const offY = (shownH - vr.height) / 2;
  const k = frameW / video.videoWidth;
  const map = (x: number, y: number) => ({
    x: Math.min(frameW, Math.max(0, ((x - vr.left + offX) / scale) * k)),
    y: Math.min(frameH, Math.max(0, ((y - vr.top + offY) / scale) * k)),
  });
  return [map(guide.left, guide.top), map(guide.right, guide.top), map(guide.right, guide.bottom), map(guide.left, guide.bottom)];
}

/** Card corners: automatic detection on a small copy, otherwise `fallback` or a 6 % inset. */
export function findCard(c: HTMLCanvasElement, fallback?: Quad): { quad: Quad; detected: boolean } {
  const k = fitScale(c.width, c.height, 480);
  const small = makeCanvas(c.width * k, c.height * k);
  const sctx = ctx2d(small);
  sctx.drawImage(c, 0, 0, small.width, small.height);
  const quad = detectCard(toGray(sctx.getImageData(0, 0, small.width, small.height)));
  if (quad) return { quad: scaleQuad(quad, 1 / k), detected: true };
  return { quad: fallback ?? insetQuad(c.width, c.height), detected: false };
}

export function warp(c: HTMLCanvasElement, quad: Quad, maxSide = STORE_SIDE): HTMLCanvasElement {
  const src = ctx2d(c).getImageData(0, 0, c.width, c.height);
  const { width, height } = warpSize(quad, maxSide);
  const out = makeCanvas(width, height);
  ctx2d(out).putImageData(new ImageData(warpRGBA(src, quad, width, height), width, height), 0, 0);
  return out;
}

export function rotate(c: HTMLCanvasElement, deg: 90 | 180 | 270): HTMLCanvasElement {
  const swap = deg !== 180;
  const out = makeCanvas(swap ? c.height : c.width, swap ? c.width : c.height);
  const ctx = ctx2d(out);
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate((deg * Math.PI) / 180);
  ctx.drawImage(c, -c.width / 2, -c.height / 2);
  return out;
}

/** Grayscale, contrast-stretched copy for Tesseract; small cards are upscaled. */
export function ocrCanvas(c: HTMLCanvasElement): HTMLCanvasElement {
  const k = Math.max(c.width, c.height) < 1400 ? 1400 / Math.max(c.width, c.height) : 1;
  const base = makeCanvas(c.width * k, c.height * k);
  const bctx = ctx2d(base);
  bctx.imageSmoothingQuality = 'high';
  bctx.drawImage(c, 0, 0, base.width, base.height);
  const g = enhanceForOcr(toGray(bctx.getImageData(0, 0, base.width, base.height)));
  const rgba = new Uint8ClampedArray(g.data.length * 4);
  for (let i = 0; i < g.data.length; i++) {
    const v = g.data[i]!;
    rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = v;
    rgba[i * 4 + 3] = 255;
  }
  bctx.putImageData(new ImageData(rgba, base.width, base.height), 0, 0);
  return base;
}

export function toJpeg(c: HTMLCanvasElement, quality = 0.85): Promise<Blob> {
  return new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('Compressione immagine fallita'))), 'image/jpeg', quality),
  );
}

export function imageDataOf(c: HTMLCanvasElement, maxSide = 1000): ImageData {
  const k = fitScale(c.width, c.height, maxSide);
  if (k === 1) return ctx2d(c).getImageData(0, 0, c.width, c.height);
  const s = makeCanvas(c.width * k, c.height * k);
  const sctx = ctx2d(s);
  sctx.drawImage(c, 0, 0, s.width, s.height);
  return sctx.getImageData(0, 0, s.width, s.height);
}
