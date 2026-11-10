import { displayName, type Contact } from '@cardvault/shared';
import { CaretDown, CaretUp } from '@phosphor-icons/react';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useNavigate } from 'react-router';
import { useContactImage, type LetterIndex } from '../lib/contacts';
import { BusinessCard, toneFor } from './BusinessCard';

/** Degrees between two consecutive cards on the drum. */
const STEP_DEG = 15;
/** Cards rendered on each side of the front one. */
const WINDOW = 7;
/** Cards around the front one that show their real photo (the rest stay drawn). */
const PHOTO_WINDOW = 2;
/** Sideways swipe past this share of the card width sends the card to the back. */
const SEND_BACK_RATIO = 0.28;
const FLY_MS = 230;

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Index letter shown on the card tab: surname, else first name, else company (as the API sorts). */
export function indexLetter(c: Pick<Contact, 'lastName' | 'firstName' | 'company'>): string {
  const src = c.lastName || c.firstName || c.company || '#';
  const ch = src.normalize('NFD').replace(/[̀-ͯ]/g, '').charAt(0).toUpperCase();
  return /[A-Z]/.test(ch) ? ch : '#';
}

interface Props {
  contacts: Contact[];
  /** Called when the front card gets close to the end of what is loaded. */
  onNearEnd?: () => void;
  /** Where each letter starts (server index); without it the loaded cards are used. */
  letters?: LetterIndex[];
  /** Loads pages until at least `count` cards are available. */
  ensureLoaded?: (count: number) => Promise<void>;
}

/**
 * Rotary card file in the spirit of 1960s desk models: cards ride on a drum and flip
 * around its axis. The page scrolls normally over it; the A–Z tabs, the arrow buttons and
 * the keyboard turn the drum. Tapping the front card opens it; swiping it left or right
 * (or ← →) files it at the back, so the next card comes forward.
 */
export function Rolodex({ contacts: source, onNearEnd, letters, ensureLoaded }: Props) {
  const navigate = useNavigate();
  // cards filed at the back with a sideways swipe, in the order they were moved (this visit only)
  const [sentBack, setSentBack] = useState<string[]>([]);
  const contacts = useMemo(() => {
    if (!sentBack.length) return source;
    const back = new Set(sentBack);
    const byId = new Map(source.map((c) => [c.id, c]));
    const moved = sentBack.map((id) => byId.get(id)).filter((c): c is Contact => !!c);
    return [...source.filter((c) => !back.has(c.id)), ...moved];
  }, [source, sentBack]);
  const [swipeX, setSwipeX] = useState(0);
  const [swiping, setSwiping] = useState(false);
  const [flying, setFlying] = useState<0 | 1 | -1>(0);
  const [announce, setAnnounce] = useState('');
  const [pos, setPos] = useState(0); // fractional index of the card facing the user
  const posRef = useRef(0);
  const target = useRef(0);
  const raf = useRef<number | null>(null);
  const swipeXRef = useRef(0);
  const drag = useRef<{ x: number; y: number; t: number; vx: number; moved: boolean; id: number; el: HTMLElement } | null>(null);
  const lastTick = useRef(0);
  const max = Math.max(0, contacts.length - 1);
  const current = Math.min(max, Math.max(0, Math.round(pos)));

  const apply = useCallback((p: number) => {
    posRef.current = p;
    setPos(p);
    const idx = Math.round(p);
    if (idx !== lastTick.current) {
      lastTick.current = idx;
      // the little "clack" of a card dropping past the rod (Android; iOS ignores it)
      if (!reducedMotion()) navigator.vibrate?.(4);
    }
  }, []);

  const animate = useCallback(() => {
    const step = () => {
      const d = target.current - posRef.current;
      if (Math.abs(d) < 0.002) {
        apply(target.current);
        raf.current = null;
        return;
      }
      // long jumps (A–Z) spin fast at first, then settle like the short ones
      apply(posRef.current + d * (Math.abs(d) > 6 ? 0.22 : 0.16));
      raf.current = requestAnimationFrame(step);
    };
    if (raf.current === null) raf.current = requestAnimationFrame(step);
  }, [apply]);

  const goTo = useCallback(
    (i: number) => {
      target.current = Math.min(max, Math.max(0, Math.round(i)));
      if (reducedMotion()) apply(target.current);
      else animate();
    },
    [max, animate, apply],
  );

  useEffect(() => () => void (raf.current !== null && cancelAnimationFrame(raf.current)), []);
  // keep the drum inside the list when it shrinks (filters)
  useEffect(() => {
    if (posRef.current > max) goTo(max);
  }, [max, goTo]);
  useEffect(() => {
    if (contacts.length && current >= contacts.length - 5) onNearEnd?.();
  }, [current, contacts.length, onNearEnd]);

  // ------------------------------------------------------------- A–Z tabs
  const tabs = useMemo(() => {
    if (letters?.length) return letters;
    const seen = new Map<string, LetterIndex>();
    source.forEach((c, i) => {
      const l = indexLetter(c);
      const t = seen.get(l);
      if (t) t.count++;
      else seen.set(l, { letter: l, offset: i, count: 1 });
    });
    return [...seen.values()];
  }, [letters, source]);
  const [jumping, setJumping] = useState<string | null>(null);

  async function jumpTo(tab: LetterIndex) {
    setJumping(tab.letter);
    try {
      await ensureLoaded?.(tab.offset + 1);
    } finally {
      setJumping(null);
    }
    // the swiped-back cards moved: look the letter up in the order shown
    const i = contactsRef.current.findIndex((c) => indexLetter(c) === tab.letter);
    if (i >= 0) {
      goTo(i);
      setAnnounce(`Lettera ${tab.letter}: ${displayName(contactsRef.current[i]!)}`);
    }
  }
  const contactsRef = useRef(contacts);
  contactsRef.current = contacts;

  // ---------------------------------------------------------------- input
  // vertical movement belongs to the page (touch-action: pan-y); only sideways swipes are ours
  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    drag.current = { x: e.clientX, y: e.clientY, t: performance.now(), vx: 0, moved: false, id: e.pointerId, el: e.currentTarget };
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 8) return;
      if (Math.abs(dy) >= Math.abs(dx)) {
        drag.current = null; // a scroll: let the page have it
        return;
      }
      // capture only once it is a swipe: a plain tap must still reach the card's click
      d.moved = true;
      d.el.setPointerCapture?.(d.id);
      setSwiping(true);
    }
    const now = performance.now();
    d.vx = (dx - swipeXRef.current) / Math.max(1, now - d.t); // px per ms
    d.t = now;
    swipeXRef.current = dx;
    setSwipeX(dx);
  }

  function onPointerUp() {
    const d = drag.current;
    drag.current = null;
    if (!d?.moved) return;
    setSwiping(false);
    const dx = swipeXRef.current;
    const far = Math.abs(dx) > d.el.clientWidth * SEND_BACK_RATIO;
    const flick = Math.abs(d.vx) > 0.6 && Math.sign(d.vx) === Math.sign(dx);
    if (far || flick) sendToBack(dx < 0 ? -1 : 1);
    else resetSwipe();
    // the click that follows a swipe must not open the card
    swallowClick.current = true;
    setTimeout(() => (swallowClick.current = false), 0);
  }
  const swallowClick = useRef(false);

  function onKeyDown(e: KeyboardEvent) {
    const moves: Record<string, number> = { ArrowDown: 1, ArrowUp: -1, PageDown: 5, PageUp: -5 };
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      sendToBack(e.key === 'ArrowLeft' ? -1 : 1);
    } else if (e.key in moves) {
      e.preventDefault();
      goTo(target.current + moves[e.key]!);
    } else if (e.key === 'Home') {
      e.preventDefault();
      goTo(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      goTo(max);
    } else if (e.key === 'Enter' && contacts[current]) {
      navigate(`/contatti/${contacts[current].id}`, { viewTransition: true });
    } else if (/^[a-z]$/i.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const tab = tabs.find((t) => t.letter === e.key.toUpperCase());
      if (tab) void jumpTo(tab);
    }
  }

  function resetSwipe() {
    swipeXRef.current = 0;
    setSwipeX(0);
  }

  /** Files the front card at the back of the drum; the next card comes forward. */
  function sendToBack(dir: 1 | -1) {
    // the card the drum is heading to (it may still be turning after a key press)
    const card = contacts[Math.min(max, Math.max(0, Math.round(target.current)))];
    if (!card || contacts.length < 2 || flying) return resetSwipe();
    const finish = () => {
      setSentBack((s) => [...s.filter((id) => id !== card.id), card.id]);
      setFlying(0);
      resetSwipe();
      setAnnounce(`${displayName(card)} spostato in fondo`);
    };
    if (!reducedMotion()) navigator.vibrate?.(8);
    if (reducedMotion()) return finish();
    setFlying(dir);
    setTimeout(finish, FLY_MS);
  }

  function onCardClick(i: number, id: string) {
    if (swallowClick.current) return;
    if (i === current) navigate(`/contatti/${id}`, { viewTransition: true });
    else goTo(i);
  }

  const front = contacts[current];
  const frontLetter = front ? indexLetter(front) : null;

  return (
    <div className="rolodex-wrap">
      {tabs.length > 1 && (
        <nav className="rolo-index" aria-label="Vai alla lettera">
          {tabs.map((t) => (
            <button
              key={t.letter}
              type="button"
              aria-current={t.letter === frontLetter ? 'true' : undefined}
              aria-label={`Lettera ${t.letter === '#' ? 'numeri e simboli' : t.letter}, ${t.count} ${t.count === 1 ? 'biglietto' : 'biglietti'}`}
              aria-busy={jumping === t.letter || undefined}
              onClick={() => void jumpTo(t)}
            >
              {t.letter}
            </button>
          ))}
        </nav>
      )}

      <div
        className="rolodex"
        role="group"
        aria-roledescription="schedario rotante"
        aria-label="Biglietti: scorri di lato per mandare la carta in fondo, usa le lettere o le frecce per girare"
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          drag.current = null;
          setSwiping(false);
          resetSwipe();
        }}
        onKeyDown={onKeyDown}
      >
        <div className="rolodex-stage">
          {contacts.map((c, i) => {
            const off = i - pos;
            if (Math.abs(off) > WINDOW) return null;
            const angle = off * STEP_DEG; // >0: leaning back behind the front card, <0: flipped past
            const isFront = i === current;
            const hidden = angle < -80;
            // sideways: follows the finger with a slight tilt, then flies off the screen
            const dx = isFront ? (flying ? flying * window.innerWidth : swipeX) : 0;
            const tilt = isFront ? (flying ? flying * 18 : swipeX * 0.04) : 0;
            const sideways = dx !== 0 || flying !== 0;
            const baseOpacity = hidden ? 0 : off < 0 ? Math.max(0, 1 + off * 2.2) : Math.max(0.35, 1 - off * 0.09);
            return (
              <button
                key={c.id}
                type="button"
                className={`rolo-card${isFront ? ' is-front' : ''}`}
                data-accent={toneFor(c.company || displayName(c))}
                style={{
                  // the front card sits a hair closer than the one behind (no z-fighting); tilts while swiped
                  transform: sideways
                    ? `translateZ(4px) translateX(${dx}px) rotateZ(${tilt}deg) rotateX(${angle}deg)`
                    : `${isFront ? 'translateZ(2px) ' : ''}rotateX(${angle}deg)`,
                  transition: isFront && !swiping ? `transform ${FLY_MS}ms ease-out, opacity ${FLY_MS}ms ease-out` : undefined,
                  zIndex: 1000 - Math.round(Math.abs(off) * 10) - (off < 0 ? 500 : 0),
                  // a card flipped past fades out within half a step so it never veils the front one
                  opacity: isFront && flying ? 0 : baseOpacity,
                  viewTransitionName: isFront && !sideways ? `card-${c.id}` : undefined,
                  // cards already flipped past lean over the front one: never let them take a tap
                  pointerEvents: off < -0.5 ? 'none' : undefined,
                }}
                tabIndex={-1}
                aria-hidden={!isFront}
                onClick={() => onCardClick(i, c.id)}
              >
                <span className="rolo-tab" aria-hidden="true">
                  {indexLetter(c)}
                </span>
                <RoloFace contact={c} photo={Math.abs(i - current) <= PHOTO_WINDOW} />
                {isFront && <span className="visually-hidden">Apri il contatto</span>}
              </button>
            );
          })}
        </div>

        {/* the hardware: drum rod, knobs, base */}
        <div className="rolodex-rod" aria-hidden="true" />
        <div className="rolodex-knob left" aria-hidden="true" />
        <div className="rolodex-knob right" aria-hidden="true" />
        <div className="rolodex-base" aria-hidden="true" />
      </div>

      <div className="rolodex-controls">
        <button type="button" className="icon-btn" aria-label="Biglietto precedente" disabled={current === 0} onClick={() => goTo(target.current - 1)}>
          <CaretUp size={22} />
        </button>
        <span className="rolodex-count" aria-live="polite">
          {front ? (
            <>
              <strong>{displayName(front)}</strong>
              <span className="muted small">
                {' '}
                · {current + 1} di {contacts.length}
              </span>
            </>
          ) : null}
        </span>
        <button type="button" className="icon-btn" aria-label="Biglietto successivo" disabled={current >= max} onClick={() => goTo(target.current + 1)}>
          <CaretDown size={22} />
        </button>
      </div>
      <p className="rolodex-hint muted small">Scorri la carta di lato per passare alla successiva, tocca una lettera per saltare.</p>
      <span className="visually-hidden" role="status">
        {announce}
      </span>
    </div>
  );
}

/**
 * The card face: the real photo of the business card when there is one (only near the
 * front, photos are fetched on demand), otherwise the drawn card. Both get the paper finish.
 */
const RoloFace = memo(function RoloFace({ contact, photo }: { contact: Contact; photo: boolean }) {
  const img = useContactImage(contact.id, 'front', photo && contact.hasFront, contact.updatedAt);
  if (img.url) {
    return (
      <span className="bcard bcard-photo">
        <img src={img.url} alt="" draggable={false} />
        <span className="visually-hidden">{displayName(contact)}</span>
      </span>
    );
  }
  return <BusinessCard contact={contact} />;
});
