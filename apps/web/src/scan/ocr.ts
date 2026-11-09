/**
 * On-device OCR. Tesseract runs in a Web Worker with engine, WASM core and the ita/eng
 * models served from our own origin (/ocr): no image or text ever leaves the device.
 */
import type { OcrLine } from '@cardvault/parser';
import { createWorker, OEM, PSM, type Worker } from 'tesseract.js';

export interface OcrProgress {
  stage: 'load' | 'recognize';
  progress: number; // 0..1
}

let workerPromise: Promise<Worker> | null = null;
let progressCb: ((p: OcrProgress) => void) | null = null;

function getWorker(): Promise<Worker> {
  workerPromise ??= createWorker(['ita', 'eng'], OEM.LSTM_ONLY, {
    workerPath: '/ocr/worker.min.js',
    corePath: '/ocr/core',
    langPath: '/ocr/lang',
    gzip: true,
    workerBlobURL: false, // same-origin worker file: works with a strict CSP
    logger: (m: { status: string; progress: number }) => {
      if (!progressCb) return;
      progressCb({ stage: m.status === 'recognizing text' ? 'recognize' : 'load', progress: m.progress ?? 0 });
    },
  })
    .then(async (w) => {
      await w.setParameters({
        tessedit_pageseg_mode: PSM.AUTO,
        preserve_interword_spaces: '1',
      });
      return w;
    })
    .catch((err) => {
      workerPromise = null;
      throw err;
    });
  return workerPromise;
}

/** Loads engine + models in the background (e.g. after login) so the first scan is fast. */
export function warmUpOcr() {
  void getWorker().catch(() => {});
}

interface TLine {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}
interface TBlock {
  paragraphs: Array<{ lines: TLine[] }>;
}

export async function recognize(image: HTMLCanvasElement, onProgress?: (p: OcrProgress) => void): Promise<OcrLine[]> {
  progressCb = onProgress ?? null;
  try {
    const worker = await getWorker();
    const { data } = await worker.recognize(image, {}, { blocks: true, text: true });
    const blocks = ((data as unknown as { blocks?: TBlock[] }).blocks ?? []) as TBlock[];
    const lines = blocks.flatMap((b) => b.paragraphs.flatMap((p) => p.lines));
    if (!lines.length) return data.text.split('\n').map((text) => ({ text }));
    return lines.map((l) => ({ text: l.text.trim(), confidence: l.confidence, height: l.bbox.y1 - l.bbox.y0 }));
  } finally {
    progressCb = null;
  }
}

export async function terminateOcr() {
  if (!workerPromise) return;
  const w = await workerPromise.catch(() => null);
  workerPromise = null;
  await w?.terminate();
}
