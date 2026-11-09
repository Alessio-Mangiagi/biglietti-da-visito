import {
  PHONE_TYPES,
  SOCIAL_LABELS,
  SOCIAL_NETWORKS,
  detectNetwork,
  type ContactInput,
  type PhoneType,
  type SocialNetwork,
} from '@cardvault/shared';
import type { ParsedField } from '@cardvault/parser';
import { Plus, Trash, Warning, X } from '@phosphor-icons/react';
import { useId, useState, type ReactNode } from 'react';
import { useEvents, useTags } from '../lib/contacts';

const PHONE_LABELS: Record<PhoneType, string> = {
  mobile: 'Cellulare',
  work: 'Ufficio',
  home: 'Casa',
  fax: 'Fax',
  other: 'Altro',
};

interface Props {
  value: ContactInput;
  onChange: (next: ContactInput) => void;
  /** Fields OCR is unsure about: highlighted until the user edits them. */
  uncertain?: Set<ParsedField>;
  errors?: Record<string, string>;
  /** Hide wallet-only fields (tags, meeting) for "Il mio biglietto". */
  selfCard?: boolean;
}

export function ContactForm({ value, onChange, uncertain = new Set(), errors = {}, selfCard }: Props) {
  const [touched, setTouched] = useState<Set<ParsedField>>(new Set());
  const set = <K extends keyof ContactInput>(key: K, v: ContactInput[K], field?: ParsedField) => {
    if (field && !touched.has(field)) setTouched(new Set(touched).add(field));
    onChange({ ...value, [key]: v });
  };
  const isUncertain = (f: ParsedField) => uncertain.has(f) && !touched.has(f);

  return (
    <div className="stack">
      <Section title="Persona">
        <div className="row-3">
          <Text label="Titolo" value={value.prefix} onChange={(v) => set('prefix', v, 'name')} placeholder="Ing., Dott.…" uncertain={isUncertain('name')} autoComplete="honorific-prefix" />
          <Text label="Nome" value={value.firstName} onChange={(v) => set('firstName', v, 'name')} uncertain={isUncertain('name')} error={errors.firstName} autoComplete="given-name" />
          <Text label="Cognome" value={value.lastName} onChange={(v) => set('lastName', v, 'name')} uncertain={isUncertain('name')} error={errors.lastName} autoComplete="family-name" />
        </div>
        <div className="row">
          <Text label="Azienda" value={value.company} onChange={(v) => set('company', v, 'company')} uncertain={isUncertain('company')} autoComplete="organization" />
          <Text label="Ruolo" value={value.jobTitle} onChange={(v) => set('jobTitle', v, 'jobTitle')} uncertain={isUncertain('jobTitle')} autoComplete="organization-title" />
        </div>
      </Section>

      <Section title="Contatti">
        <ListField
          label="Email"
          addLabel="Aggiungi email"
          uncertain={isUncertain('emails')}
          items={value.emails}
          error={Object.entries(errors).find(([k]) => k.startsWith('emails'))?.[1]}
          onChange={(emails) => set('emails', emails, 'emails')}
          render={(v, update) => (
            <input className="input" type="email" inputMode="email" autoComplete="email" value={v} onChange={(e) => update(e.target.value.trim())} aria-label="Email" />
          )}
          blank=""
        />
        <ListField
          label="Telefoni"
          addLabel="Aggiungi telefono"
          uncertain={isUncertain('phones')}
          items={value.phones}
          onChange={(phones) => set('phones', phones, 'phones')}
          blank={{ type: 'mobile' as PhoneType, value: '' }}
          render={(p, update) => (
            <div className="row" style={{ gridTemplateColumns: '8.5rem 1fr' }}>
              <select className="select" value={p.type} onChange={(e) => update({ ...p, type: e.target.value as PhoneType })} aria-label="Tipo di telefono">
                {PHONE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {PHONE_LABELS[t]}
                  </option>
                ))}
              </select>
              <input className="input" type="tel" inputMode="tel" autoComplete="tel" value={p.value} onChange={(e) => update({ ...p, value: e.target.value })} aria-label="Numero" />
            </div>
          )}
        />
        <Text label="Sito web" type="url" inputMode="url" value={value.website} onChange={(v) => set('website', v, 'website')} uncertain={isUncertain('website')} placeholder="www.esempio.it" />
        <ListField
          label="Social"
          addLabel="Aggiungi profilo"
          uncertain={isUncertain('socials')}
          items={value.socials}
          onChange={(socials) => set('socials', socials, 'socials')}
          blank={{ network: 'linkedin' as SocialNetwork, value: '' }}
          render={(s, update) => (
            <div className="row" style={{ gridTemplateColumns: '8.5rem 1fr' }}>
              <select className="select" value={s.network} onChange={(e) => update({ ...s, network: e.target.value as SocialNetwork })} aria-label="Social network">
                {SOCIAL_NETWORKS.map((n) => (
                  <option key={n} value={n}>
                    {SOCIAL_LABELS[n]}
                  </option>
                ))}
              </select>
              <input
                className="input"
                inputMode="url"
                value={s.value}
                placeholder="linkedin.com/in/…"
                aria-label="Indirizzo del profilo"
                onChange={(e) => update({ network: detectNetwork(e.target.value) ?? s.network, value: e.target.value })}
              />
            </div>
          )}
        />
      </Section>

      <Section title="Indirizzo" uncertain={isUncertain('address')}>
        <Text label="Via e numero" value={value.address.street} onChange={(v) => set('address', { ...value.address, street: v }, 'address')} autoComplete="street-address" />
        <div className="row-3">
          <Text label="CAP" value={value.address.postalCode} inputMode="numeric" onChange={(v) => set('address', { ...value.address, postalCode: v }, 'address')} autoComplete="postal-code" />
          <Text label="Città" value={value.address.city} onChange={(v) => set('address', { ...value.address, city: v }, 'address')} autoComplete="address-level2" />
          <Text label="Provincia" value={value.address.province} onChange={(v) => set('address', { ...value.address, province: v.toUpperCase() }, 'address')} autoComplete="address-level1" />
        </div>
        <Text label="Nazione" value={value.address.country} onChange={(v) => set('address', { ...value.address, country: v }, 'address')} autoComplete="country-name" />
      </Section>

      {!selfCard && (
        <Section title="Incontro e organizzazione">
          <MeetingFields value={value} set={set} />
          <TagsField tags={value.tags} onChange={(tags) => set('tags', tags)} />
          <label className="checkbox">
            <input type="checkbox" checked={value.favorite} onChange={(e) => set('favorite', e.target.checked)} />
            <span>Aggiungi ai preferiti</span>
          </label>
        </Section>
      )}

      <Section title="Note">
        <div className="field">
          <label htmlFor="notes" className="visually-hidden">
            Note
          </label>
          <textarea id="notes" className="textarea" value={value.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Argomenti discussi, prossimi passi…" />
        </div>
      </Section>
    </div>
  );
}

function Section({ title, children, uncertain }: { title: string; children: ReactNode; uncertain?: boolean }) {
  return (
    <fieldset className={`panel stack${uncertain ? ' uncertain-section' : ''}`} style={{ border: '1px solid var(--border)', margin: 0 }}>
      <legend className="eyebrow" style={{ padding: '0 0.4rem' }}>
        {title}
        {uncertain && <UncertainBadge />}
      </legend>
      {children}
    </fieldset>
  );
}

export function UncertainBadge() {
  return (
    <span className="uncertain-badge">
      <Warning size={12} weight="bold" aria-hidden="true" /> Da verificare
    </span>
  );
}

interface TextProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  uncertain?: boolean;
  error?: string;
  type?: string;
  placeholder?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  autoComplete?: string;
  list?: string;
}

export function Text({ label, value, onChange, uncertain, error, type = 'text', placeholder, inputMode, autoComplete, list }: TextProps) {
  const id = useId();
  return (
    <div className={`field${uncertain ? ' uncertain' : ''}`}>
      <label htmlFor={id}>
        {label}
        {uncertain && <UncertainBadge />}
      </label>
      <input
        id={id}
        className="input"
        type={type}
        value={value}
        placeholder={placeholder}
        inputMode={inputMode}
        autoComplete={autoComplete ?? 'off'}
        list={list}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-err` : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      {error && (
        <span id={`${id}-err`} className="field-error">
          {error}
        </span>
      )}
    </div>
  );
}

function ListField<T>({
  label,
  addLabel,
  items,
  onChange,
  render,
  blank,
  uncertain,
  error,
}: {
  label: string;
  addLabel: string;
  items: T[];
  onChange: (items: T[]) => void;
  render: (item: T, update: (v: T) => void) => ReactNode;
  blank: T;
  uncertain?: boolean;
  error?: string;
}) {
  return (
    <div className={`field${uncertain ? ' uncertain' : ''}`} role="group" aria-label={label}>
      <span className="label">
        {label}
        {uncertain && <UncertainBadge />}
      </span>
      {items.map((item, i) => (
        <div key={i} className="inline" style={{ flexWrap: 'nowrap' }}>
          <div style={{ flex: 1, minWidth: 0 }}>{render(item, (v) => onChange(items.map((x, j) => (j === i ? v : x))))}</div>
          <button type="button" className="icon-btn" aria-label={`Rimuovi ${label.toLowerCase()} ${i + 1}`} onClick={() => onChange(items.filter((_, j) => j !== i))}>
            <Trash size={20} />
          </button>
        </div>
      ))}
      {error && <span className="field-error">{error}</span>}
      <div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange([...items, blank])}>
          <Plus size={16} /> {addLabel}
        </button>
      </div>
    </div>
  );
}

function MeetingFields({ value, set }: { value: ContactInput; set: <K extends keyof ContactInput>(k: K, v: ContactInput[K]) => void }) {
  const events = useEvents();
  const listId = useId();
  return (
    <div className="row">
      <Text label="Luogo o evento" value={value.metAt} onChange={(v) => set('metAt', v)} placeholder="SAIE Bologna, cantiere…" list={listId} />
      <datalist id={listId}>
        {events.data?.map((e) => <option key={e} value={e} />)}
      </datalist>
      <div className="field">
        <label htmlFor="metOn">Data incontro</label>
        <input id="metOn" className="input" type="date" value={value.metOn ?? ''} onChange={(e) => set('metOn', e.target.value || null)} />
      </div>
    </div>
  );
}

function TagsField({ tags, onChange }: { tags: string[]; onChange: (t: string[]) => void }) {
  const [draft, setDraft] = useState('');
  const suggestions = useTags();
  const listId = useId();
  const add = (raw: string) => {
    const t = raw.trim().replace(/,$/, '');
    if (t && !tags.some((x) => x.toLowerCase() === t.toLowerCase())) onChange([...tags, t]);
    setDraft('');
  };
  return (
    <div className="field">
      <label htmlFor={`${listId}-in`}>Tag</label>
      {tags.length > 0 && (
        <div className="inline">
          {tags.map((t) => (
            <span key={t} className="chip" aria-pressed="true">
              {t}
              <button type="button" className="icon-btn" style={{ width: 24, height: 24 }} aria-label={`Rimuovi tag ${t}`} onClick={() => onChange(tags.filter((x) => x !== t))}>
                <X size={14} />
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        id={`${listId}-in`}
        className="input"
        value={draft}
        list={listId}
        placeholder="Scrivi e premi Invio"
        enterKeyHint="done"
        onChange={(e) => (e.target.value.endsWith(',') ? add(e.target.value) : setDraft(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add(draft);
          }
        }}
        onBlur={() => draft && add(draft)}
      />
      <datalist id={listId}>
        {suggestions.data?.map((s) => <option key={s.tag} value={s.tag} />)}
      </datalist>
    </div>
  );
}
