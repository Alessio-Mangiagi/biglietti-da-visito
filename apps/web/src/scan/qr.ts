import { parseQrPayload, type ParseResult } from '@cardvault/parser';
import jsQR from 'jsqr';

/** Looks for a vCard/MECARD QR code. jsQR everywhere: iOS has no BarcodeDetector. */
export function findContactQr(img: ImageData): ParseResult | null {
  const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
  return code?.data ? parseQrPayload(code.data) : null;
}
