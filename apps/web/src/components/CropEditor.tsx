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

/**
 * Four draggable corners over the photo (pointer events: mouse, touch, pen).
 * Arrow keys move the focused corner for keyboard users.
 */
export function CropEditor({ image, quad, detected, onChange, onRotate, onAuto, onConfirm, busy }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const [displayW, setDisplayW] = useState(1);

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

  const k = image.width / displayW; // image px per CSS px
  const r = 14 * k;

  function toImage(e: RPointerEvent): Pt {
    const rect = wrapRef.current!.getBoundingClientRect();
    return {
      x: Math.min(image.width, Math.max(0, (e.clientX - rect.left) * k)),
      y: Math.min(image.height, Math.max(0, (e.clientY - rect.top) * k)),
    };
  }

  function move(i: number, p: Pt) {
    const next = quad.map((q, j) => (j === i ? p : q)) as Quad;
    onChange(next);
  }

  return (
    <div className="stack">
      <p className="muted small" role="status">
        {detected ? 'Bordi trovati automaticamente: controlla gli angoli.' : 'Trascina i quattro angoli sui bordi del biglietto.'}
      </p>
      <div
        ref={wrapRef}
        className="crop"
        onPointerMove={(e) => drag !== null && move(drag, toImage(e))}
        onPointerUp={() => setDrag(null)}
        onPointerCancel={() => setDrag(null)}
      >
        <canvas ref={canvasRef} aria-label="Foto del biglietto" role="img" />
        <svg viewBox={`0 0 ${image.width} ${image.height}`} preserveAspectRatio="none">
          <polygon className="crop-quad" points={quad.map((p) => `${p.x},${p.y}`).join(' ')} style={{ strokeWidth: 2 * k }} />
          {quad.map((p, i) => (
            <circle
              key={i}
              className="crop-handle"
              cx={p.x}
              cy={p.y}
              r={r}
              style={{ strokeWidth: 3 * k }}
              tabIndex={0}
              role="slider"
              aria-label={`Angolo ${CORNER_NAMES[i]}`}
              aria-valuetext={`${Math.round(p.x)}, ${Math.round(p.y)}`}
              onPointerDown={(e) => {
                (e.target as Element).setPointerCapture?.(e.pointerId);
                setDrag(i);
              }}
              onPointerMove={(e) => drag === i && move(i, toImage(e))}
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
      </div>
      <div className="spread">
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
