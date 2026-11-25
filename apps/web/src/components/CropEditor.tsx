import { ArrowClockwise, Check, MagicWand } from '@phosphor-icons/react';
import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import type { Pt, Quad } from '../scan/geometry';

interface Props {
  image: HTMLCanvasElement;
  quad: Quad;
  detected: boolean;
  onChange: (q: Quad) => void;
  onRotate: () => void;
  onAuto: () => void;
  onConfirm: () => void;
  busy?: boolean;
}

const CORNER_NAMES = ['in alto a sinistra', 'in alto a destra', 'in basso a destra', 'in basso a sinistra'];
/** A touch this close to a corner (CSS px) grabs it; anywhere else scrolls the page. */
const GRAB = 32;
const LOUPE = 120; // CSS px
const LOUPE_ZOOM = 2.5;

interface Drag {
  corner: number;
  /** corner minus pointer, in image px: the corner keeps its distance from the finger */
  dx: number;
  dy: number;
}

/**
 * Four draggable corners over the photo (pointer events: mouse, touch, pen). Only a touch
 * near a corner starts a drag; elsewhere the page scrolls as usual. While dragging, a loupe
 * shows the corner magnified (the finger hides it). Arrow keys move the focused corner.
 */
export function CropEditor({ image, quad, detected, onChange, onRotate, onAuto, onConfirm, busy }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const loupeRef = useRef<HTMLCanvasElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [displayW, setDisplayW] = useState(1);
  // read by the native touch listeners, which are registered once
  const live = useRef({ quad, image, dragging: false });
  live.current = { quad, image, dragging: drag !== null };

  useEffect(() => {
    const c = canvasRef.current!;
    c.width = image.width;
    c.height = image.height;
    c.getContext('2d')!.drawImage(image, 0, 0);
  }, [image]);

  useEffect(() => {
    const el = wrapRef.current!;
    const ro = new ResizeObserver(() => setDisplayW(el.clientWidth || 1));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /** Index of the corner within GRAB of a viewport point, if any. */
  function cornerAt(clientX: number, clientY: number): number | null {
    const el = wrapRef.current;
    if (!el) return null;
    const { quad: q, image: img } = live.current;
    const rect = el.getBoundingClientRect();
    const scale = img.width / (rect.width || 1);
    const x = (clientX - rect.left) * scale;
    const y = (clientY - rect.top) * scale;
    let best: number | null = null;
    let bestD = GRAB * scale;
    q.forEach((p, i) => {
      const d = Math.hypot(p.x - x, p.y - y);
      if (d <= bestD) [best, bestD] = [i, d];
    });
    return best;
  }

  // Scrolling is decided at touchstart: cancel it only for a touch that grabs a corner
  // (touch-action alone cannot tell a corner from the rest of the photo).
  useEffect(() => {
    const el = wrapRef.current!;
    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (e.touches.length === 1 && t && cornerAt(t.clientX, t.clientY) !== null) e.preventDefault();
    };
    const onMove = (e: TouchEvent) => {
      if (live.current.dragging) e.preventDefault();
    };
    el.addEventListener('touchstart', onStart, { passive: false });
    el.addEventListener('touchmove', onMove, { passive: false });
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
    };
  }, []);

  const k = image.width / displayW; // image px per CSS px
  const r = 12 * k;

  function toImage(e: RPointerEvent): Pt {
    const rect = wrapRef.current!.getBoundingClientRect();
    return { x: (e.clientX - rect.left) * k, y: (e.clientY - rect.top) * k };
  }

  function move(i: number, p: Pt) {
    const clamped = { x: Math.min(image.width, Math.max(0, p.x)), y: Math.min(image.height, Math.max(0, p.y)) };
    onChange(quad.map((q, j) => (j === i ? clamped : q)) as Quad);
  }

  function onPointerDown(e: RPointerEvent<HTMLDivElement>) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const i = cornerAt(e.clientX, e.clientY);
    if (i === null) return; // not a corner: let the page scroll
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const p = toImage(e);
    setDrag({ corner: i, dx: quad[i]!.x - p.x, dy: quad[i]!.y - p.y });
  }

  function onPointerMove(e: RPointerEvent<HTMLDivElement>) {
    if (!drag) return;
    const p = toImage(e);
    move(drag.corner, { x: p.x + drag.dx, y: p.y + drag.dy });
  }

  // loupe: the dragged corner magnified, with the two sides meeting there
  useEffect(() => {
    const c = loupeRef.current;
    if (!drag || !c) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const size = Math.round(LOUPE * dpr);
    if (c.width !== size) c.width = c.height = size;
    const ctx = c.getContext('2d')!;
    const p = quad[drag.corner]!;
    const src = (LOUPE / LOUPE_ZOOM) * k; // image px shown across the loupe
    const sx = p.x - src / 2;
    const sy = p.y - src / 2;
    const toL = (q: Pt) => ({ x: ((q.x - sx) / src) * size, y: ((q.y - sy) / src) * size });
    ctx.fillStyle = '#1b1d20';
    ctx.fillRect(0, 0, size, size);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, sx, sy, src, src, 0, 0, size, size);
    const c0 = toL(p);
    ctx.lineWidth = 2 * dpr;
    ctx.strokeStyle = '#198fd9';
    ctx.beginPath();
    for (const n of [quad[(drag.corner + 3) % 4]!, quad[(drag.corner + 1) % 4]!]) {
      const q = toL(n);
      ctx.moveTo(c0.x, c0.y);
      ctx.lineTo(q.x, q.y);
    }
    ctx.stroke();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5 * dpr;
    ctx.beginPath();
    ctx.moveTo(c0.x - 9 * dpr, c0.y);
    ctx.lineTo(c0.x + 9 * dpr, c0.y);
    ctx.moveTo(c0.x, c0.y - 9 * dpr);
    ctx.lineTo(c0.x, c0.y + 9 * dpr);
    ctx.stroke();
  }, [drag, quad, image, k]);

  const dragged = drag ? quad[drag.corner]! : null;
  // keep the loupe away from the finger: opposite side, and below when the corner is high up
  const loupeSide = dragged && dragged.x < image.width / 2 ? 'right' : 'left';
  const loupeLow = dragged && dragged.y < image.height * 0.45;

  return (
    <div className="stack">
      <p className="muted small" role="status">
        {detected ? 'Bordi trovati automaticamente: controlla gli angoli.' : 'Trascina i quattro angoli sui bordi del biglietto.'}
      </p>
      <div
        ref={wrapRef}
        className={`crop${drag ? ' is-dragging' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => setDrag(null)}
        onPointerCancel={() => setDrag(null)}
        onLostPointerCapture={() => setDrag(null)}
      >
        <canvas ref={canvasRef} aria-label="Foto del biglietto" role="img" />
        <svg viewBox={`0 0 ${image.width} ${image.height}`} preserveAspectRatio="none">
          <polygon className="crop-quad" points={quad.map((p) => `${p.x},${p.y}`).join(' ')} style={{ strokeWidth: 2 * k }} />
          {quad.map((p, i) => (
            <circle
              key={i}
              className={`crop-handle${drag?.corner === i ? ' is-active' : ''}`}
              cx={p.x}
              cy={p.y}
              r={drag?.corner === i ? r * 0.6 : r}
              style={{ strokeWidth: 3 * k }}
              tabIndex={0}
              role="slider"
              aria-label={`Angolo ${CORNER_NAMES[i]}`}
              aria-valuetext={`${Math.round(p.x)}, ${Math.round(p.y)}`}
              onKeyDown={(e) => {
                const step = (e.shiftKey ? 20 : 4) * k;
                const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
                if (!d) return;
                e.preventDefault();
                move(i, { x: p.x + d[0]!, y: p.y + d[1]! });
              }}
            />
          ))}
        </svg>
        {drag && <canvas ref={loupeRef} className={`crop-loupe ${loupeSide}${loupeLow ? ' low' : ''}`} aria-hidden="true" />}
      </div>
      <div className="spread crop-actions">
        <div className="inline">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onRotate}>
            <ArrowClockwise size={18} /> Ruota
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onAuto}>
            <MagicWand size={18} /> Rileva bordi
          </button>
        </div>
        <button type="button" className="btn btn-primary" onClick={onConfirm} disabled={busy}>
          <Check size={18} /> Conferma
        </button>
      </div>
    </div>
  );
}
