import { LoginSchema, PASSWORD_MIN, RegisterSchema, type AuthResponse } from '@cardvault/shared';
import { Eye, EyeSlash } from '@phosphor-icons/react';
import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useToast } from '../components/Toasts';
import { api, errorMessage, fieldErrors } from '../lib/api';
import { useSession } from '../lib/session';

function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <img src="/favicon.svg" alt="" width={64} height={64} />
          <div>
            <p className="eyebrow">CardVault</p>
            <h1>{title}</h1>
            {subtitle && <p className="muted" style={{ marginTop: '0.4rem' }}>{subtitle}</p>}
          </div>
        </div>
        <div className="panel">{children}</div>
        {footer}
      </div>
    </div>
  );
}

function Field({
  label,
  type = 'text',
  value,
  onChange,
  error,
  autoComplete,
  hint,
}: {
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  autoComplete?: string;
  hint?: string;
}) {
  const id = useId();
  const [show, setShow] = useState(false);
  const isPassword = type === 'password';
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div style={{ position: 'relative' }}>
        <input
          id={id}
          className="input"
          type={isPassword && show ? 'text' : type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          autoCapitalize={type === 'email' || isPassword ? 'none' : undefined}
          autoCorrect="off"
          spellCheck={false}
          required
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-e` : hint ? `${id}-h` : undefined}
          style={isPassword ? { paddingRight: '3rem' } : undefined}
        />
        {isPassword && (
          <button
            type="button"
            className="icon-btn"
            style={{ position: 'absolute', right: 0, top: 0 }}
            aria-label={show ? 'Nascondi password' : 'Mostra password'}
            aria-pressed={show}
            onClick={() => setShow(!show)}
          >
            {show ? <EyeSlash size={20} /> : <Eye size={20} />}
          </button>
        )}
      </div>
      {error ? (
        <span id={`${id}-e`} className="field-error">
          {error}
        </span>
      ) : (
        hint && (
          <span id={`${id}-h`} className="field-hint">
            {hint}
          </span>
        )
      )}
    </div>
  );
}

function zodErrors(issues: Array<{ path: PropertyKey[]; message: string }>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of issues) out[String(i.path[0])] ??= i.message;
  return out;
}

export function LoginPage() {
  const { signIn } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = LoginSchema.safeParse({ email, password });
    if (!parsed.success) return setErrors(zodErrors(parsed.error.issues));
    setErrors({});
    setError('');
    setBusy(true);
    try {
      signIn(await api.post<AuthResponse>('/auth/login', parsed.data));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title="Accedi"
      subtitle="I tuoi biglietti da visita, sempre con te."
      footer={
        <p className="muted small" style={{ textAlign: 'center', marginTop: '1.25rem' }}>
          Non hai un account? <Link to="/registrati">Registrati</Link>
        </p>
      }
    >
      <form className="stack" onSubmit={submit} noValidate>
        {error && (
          <div className="alert alert-error" role="alert">
            {error}
          </div>
        )}
        <Field label="Email" type="email" value={email} onChange={setEmail} error={errors.email} autoComplete="username" />
        <Field label="Password" type="password" value={password} onChange={setPassword} error={errors.password} autoComplete="current-password" />
        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'Accesso in corso…' : 'Accedi'}
        </button>
        <div className="auth-links">
          <Link to="/password-dimenticata">Password dimenticata?</Link>
          <Link to="/privacy">Privacy</Link>
        </div>
      </form>
    </AuthLayout>
  );
}

export function RegisterPage() {
  const { signIn } = useSession();
  const [form, setForm] = useState({ displayName: '', email: '', password: '', acceptPrivacy: false });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (v: string | boolean) => setForm({ ...form, [k]: v });

  async function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = RegisterSchema.safeParse(form);
    if (!parsed.success) return setErrors(zodErrors(parsed.error.issues));
    setErrors({});
    setError('');
    setBusy(true);
    try {
      signIn(await api.post<AuthResponse>('/auth/register', parsed.data));
    } catch (err) {
      setErrors(fieldErrors(err));
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title="Crea il tuo account"
      subtitle="Il testo dei biglietti viene letto sul tuo telefono: le foto non passano da servizi esterni."
      footer={
        <p className="muted small" style={{ textAlign: 'center', marginTop: '1.25rem' }}>
          Hai già un account? <Link to="/accedi">Accedi</Link>
        </p>
      }
    >
      <form className="stack" onSubmit={submit} noValidate>
        {error && (
          <div className="alert alert-error" role="alert">
            {error}
          </div>
        )}
        <Field label="Nome e cognome" value={form.displayName} onChange={set('displayName')} error={errors.displayName} autoComplete="name" />
        <Field label="Email" type="email" value={form.email} onChange={set('email')} error={errors.email} autoComplete="email" />
        <Field
          label="Password"
          type="password"
          value={form.password}
          onChange={set('password')}
          error={errors.password}
          autoComplete="new-password"
          hint={`Almeno ${PASSWORD_MIN} caratteri. Una frase lunga è più sicura di una parola complicata.`}
        />
        <label className="checkbox">
          <input type="checkbox" checked={form.acceptPrivacy} onChange={(e) => set('acceptPrivacy')(e.target.checked)} aria-invalid={!!errors.acceptPrivacy} />
          <span>
            Ho letto l'<Link to="/privacy">informativa privacy</Link> e accetto il trattamento dei dati per l'uso del servizio.
          </span>
        </label>
        {errors.acceptPrivacy && <span className="field-error">{errors.acceptPrivacy}</span>}
        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'Creazione…' : 'Crea account'}
        </button>
      </form>
    </AuthLayout>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post('/auth/forgot-password', { email });
      setSent(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title="Password dimenticata"
      footer={
        <p className="muted small" style={{ textAlign: 'center', marginTop: '1.25rem' }}>
          <Link to="/accedi">Torna all'accesso</Link>
        </p>
      }
    >
      {sent ? (
        <div className="alert alert-success" role="status">
          Se l'indirizzo è registrato riceverai un'email con il link per scegliere una nuova password. Il link vale 60 minuti.
        </div>
      ) : (
        <form className="stack" onSubmit={submit} noValidate>
          <p className="muted small">Inserisci l'email del tuo account: ti invieremo un link per reimpostare la password.</p>
          {error && (
            <div className="alert alert-error" role="alert">
              {error}
            </div>
          )}
          <Field label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" />
          <button className="btn btn-primary btn-block" disabled={busy || !email}>
            Invia link
          </button>
        </form>
      )}
    </AuthLayout>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password.length < PASSWORD_MIN) return setError(`La password deve avere almeno ${PASSWORD_MIN} caratteri`);
    if (password !== confirm) return setError('Le due password non coincidono');
    setBusy(true);
    setError('');
    try {
      await api.post('/auth/reset-password', { token, password });
      toast('Password aggiornata. Ora puoi accedere.');
      navigate('/accedi', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title="Nuova password">
      {!token ? (
        <div className="alert alert-error">
          Link non valido. <Link to="/password-dimenticata">Richiedine uno nuovo</Link>.
        </div>
      ) : (
        <form className="stack" onSubmit={submit} noValidate>
          {error && (
            <div className="alert alert-error" role="alert">
              {error}
            </div>
          )}
          <Field label="Nuova password" type="password" value={password} onChange={setPassword} autoComplete="new-password" hint={`Almeno ${PASSWORD_MIN} caratteri.`} />
          <Field label="Ripeti la password" type="password" value={confirm} onChange={setConfirm} autoComplete="new-password" />
          <button className="btn btn-primary btn-block" disabled={busy}>
            Salva password
          </button>
        </form>
      )}
    </AuthLayout>
  );
}
