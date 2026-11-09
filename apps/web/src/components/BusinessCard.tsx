import { displayName, initials, type ContactInput } from '@cardvault/shared';
import { CloudArrowUp, Star } from '@phosphor-icons/react';

export const TONES = ['navy', 'sky', 'paper', 'graphite', 'ice', 'slate'] as const;
export type Tone = (typeof TONES)[number];

/** Stable tone per company, so cards of the same company share a colour. */
export function toneFor(key: string): Tone {
  let h = 0;
  for (const ch of key.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TONES[h % TONES.length]!;
}

interface Props {
  contact: Pick<ContactInput, 'firstName' | 'lastName' | 'company' | 'jobTitle' | 'favorite' | 'prefix'> &
    Partial<Pick<ContactInput, 'phones' | 'emails' | 'address'>>;
  pending?: boolean;
  tone?: Tone;
  compact?: boolean;
}

export function BusinessCard({ contact, pending, tone, compact }: Props) {
  const name = [contact.firstName, contact.lastName].filter(Boolean).join(' ');
  const t = tone ?? toneFor(contact.company || displayName(contact));
  return (
    <div className="bcard" data-tone={t === 'navy' ? undefined : t}>
      <span className="bcard-strip" aria-hidden="true" />
      <div className="bcard-head">
        <span className="bcard-company">{contact.company || name || 'Senza nome'}</span>
        <span className="inline">
          {contact.favorite && <Star size={18} weight="fill" className="bcard-fav" aria-label="Preferito" />}
          <span className="bcard-mono" aria-hidden="true">
            {initials(contact)}
          </span>
        </span>
      </div>
      {pending && (
        <span className="bcard-pending badge-sync" title="In attesa di sincronizzazione">
          <CloudArrowUp size={16} /> In attesa
        </span>
      )}
      {!compact && (
        <div className="bcard-body">
          <span className="bcard-name">{name ? [contact.prefix, name].filter(Boolean).join(' ') : contact.company || 'Senza nome'}</span>
          {contact.jobTitle && <span className="bcard-role">{contact.jobTitle}</span>}
          <span className="bcard-meta">
            {contact.phones?.[0] && <span>{contact.phones[0].value}</span>}
            {contact.address?.city && <span>{contact.address.city}</span>}
          </span>
        </div>
      )}
    </div>
  );
}
