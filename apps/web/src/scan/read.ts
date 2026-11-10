import { parseCard, type ParseResult } from '@cardvault/parser';
import { imageDataOf, ocrCanvas, rotate } from './image';
import { recognize, type OcrProgress } from './ocr';
import { findContactQr } from './qr';

/** How many useful fields a parse found — used to pick the better orientation. */
export const score = (r: ParseResult) =>
  (r.contact.firstName || r.contact.lastName ? 2 : 0) +
  (r.contact.company ? 1 : 0) +
  r.contact.emails.length * 2 +
  r.contact.phones.length * 2 +
  (r.contact.website ? 1 : 0);

/**
 * Reads one cropped side: a vCard QR wins over OCR; a poor result is retried upside
 * down (cards are often shot the wrong way round).
 */
export async function readCard(canvas: HTMLCanvasElement, report?: (p: OcrProgress) => void, onFlip?: () => void): Promise<ParseResult> {
  const qr = findContactQr(imageDataOf(canvas));
  if (qr) return qr;
  let best = parseCard(await recognize(ocrCanvas(canvas), report));
  if (score(best) < 3) {
    onFlip?.();
    const flipped = parseCard(await recognize(ocrCanvas(rotate(canvas, 180)), report));
    if (score(flipped) > score(best)) best = flipped;
  }
  return best;
}
