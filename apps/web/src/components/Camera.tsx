import { Camera as CameraIcon, Images, X } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import type { Quad } from '../scan/geometry';
import { captureVideo, guideToFrame, loadImage } from '../scan/image';

export interface Capture {
  canvas: HTMLCanvasElement;
  /** Guide frame in canvas pixels (camera only). */
  guide?: Quad;
}

interface Props {
  side: 'front' | 'back';
  onCapture: (c: Capture) => void;
  onClose: () => void;
  onError: (msg: string) => void;
}

type CamState = 'starting' | 'live' | 'unavailable';

/**
 * Full-screen camera with a card-shaped guide. On iOS the <video> must be `playsInline`
 * and muted, the page must be served over HTTPS, and the stream is stopped on unmount so
 * the camera indicator turns off. Without camera access, the native picker is used.
 */
export function Camera({ side, onCapture, onClose, onError }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const guideRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraFileRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<CamState>('starting');
  const [reason, setReason] = useState('');

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    (async () => {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setReason('La fotocamera in diretta richiede una connessione sicura (HTTPS).');
        setState('unavailable');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        });
        if (cancelled) return stream.getTracks().forEach((t) => t.stop());
        const v = videoRef.current!;
        v.srcObject = stream;
        await v.play();
        setState('live');
      } catch (err) {
        const name = (err as DOMException).name;
        setReason(
          name === 'NotAllowedError'
            ? 'Accesso alla fotocamera negato. Puoi abilitarlo nelle impostazioni del browser, oppure scattare con la fotocamera del telefono.'
            : 'Fotocamera non disponibile su questo dispositivo.',
        );
        setState('unavailable');
      }
    })();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  function shoot() {
    const v = videoRef.current;
    const g = guideRef.current;
    if (!v || !g || !v.videoWidth) return;
    const canvas = captureVideo(v);
    onCapture({ canvas, guide: guideToFrame(v, g.getBoundingClientRect(), canvas.width, canvas.height) });
  }

  async function pick(file: File | undefined) {
    if (!file) return;
    try {
      onCapture({ canvas: await loadImage(file) });
    } catch (err) {
      onError((err as Error).message);
    }
  }

  const label = side === 'front' ? 'Fronte' : 'Retro';

  return (
    <div className="scanner" role="dialog" aria-modal="true" aria-label={`Scansione ${label.toLowerCase()}`}>
      <div className="scanner-top">
        <button type="button" className="icon-btn" aria-label="Chiudi scansione" onClick={onClose}>
          <X size={26} />
        </button>
        <span className="scanner-side">{label}</span>
        <span style={{ width: 44 }} />
      </div>

      <div className="viewfinder">
        <video ref={videoRef} playsInline muted autoPlay aria-hidden="true" />
        {state !== 'unavailable' && (
          <div ref={guideRef} className="guide">
            <div className="guide-corners" />
            <p className="guide-hint">
              {state === 'starting' ? 'Avvio fotocamera…' : 'Inquadra il biglietto dentro la cornice'}
            </p>
          </div>
        )}
        {state === 'unavailable' && (
          <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', padding: '1.5rem' }}>
            <div className="stack" style={{ maxWidth: 360, textAlign: 'center', justifyItems: 'center' }}>
              <CameraIcon size={48} />
              <p>{reason}</p>
              <button type="button" className="btn btn-primary" onClick={() => cameraFileRef.current?.click()}>
                <CameraIcon size={18} /> Scatta una foto
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="scanner-bottom">
        <button type="button" className="icon-btn" aria-label="Scegli dalla galleria" onClick={() => fileRef.current?.click()}>
          <Images size={28} />
        </button>
        <button type="button" className="shutter" aria-label={`Scatta ${label.toLowerCase()}`} onClick={shoot} disabled={state !== 'live'} />
        <span style={{ width: 44 }} />
      </div>

      <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => void pick(e.target.files?.[0])} />
      {/* native camera app: iOS returns a JPEG even for HEIC captures */}
      <input ref={cameraFileRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => void pick(e.target.files?.[0])} />
    </div>
  );
}
