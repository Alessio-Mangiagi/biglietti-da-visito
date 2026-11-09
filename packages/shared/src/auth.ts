import { z } from 'zod';

/** NIST SP 800-63B: at least 8 characters, checked against easily guessed values. */
export const PASSWORD_MIN = 8;

/** Most common leaked passwords and app-specific words (lower-case). */
const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password12', 'password123', 'passw0rd', 'qwertyui', 'qwerty123', 'qwertyuiop',
  'azertyui', 'asdfghjk', 'zxcvbnm1', 'iloveyou', 'sunshine', 'princess', 'football', 'baseball', 'superman',
  'whatever', 'trustno1', 'welcome1', 'welcome123', 'letmein1', 'admin123', 'administrator', 'changeme',
  'abc12345', 'abcd1234', 'qazwsxedc', '1q2w3e4r', '1q2w3e4r5t', 'zaq12wsx', 'monkey12', 'dragon12',
  'ciao1234', 'ciaociao', 'amore123', 'juventus', 'forzajuve', 'forzanapoli', 'forzamilan', 'forzainter',
  'napoli123', 'roma1234', 'milano123', 'italia123', 'cardvault', 'cardvault1', 'cosedil1', 'nexora123',
]);

/** Returns why a password is too easy to guess, or null when it is acceptable. */
export function weakPasswordReason(password: string, email?: string): string | null {
  const p = password.toLowerCase();
  if (COMMON_PASSWORDS.has(p)) return 'Password troppo comune: scegline una meno prevedibile';
  // a short block repeated: "aaaaaaaa", "10101010", "abcabcabc"
  for (let len = 1; len <= Math.min(4, p.length / 2); len++) {
    if (p.slice(0, len).repeat(Math.ceil(p.length / len)).slice(0, p.length) === p) {
      return 'Password troppo semplice: evita ripetizioni come 10101010';
    }
  }
  // straight runs: "12345678", "87654321", "abcdefgh"
  let up = 0;
  let down = 0;
  for (let i = 1; i < p.length; i++) {
    const d = p.charCodeAt(i) - p.charCodeAt(i - 1);
    if (d === 1) up++;
    if (d === -1) down++;
  }
  if (up === p.length - 1 || down === p.length - 1) return 'Password troppo semplice: evita sequenze come 12345678';
  if (new Set(p).size < 4) return 'Usa almeno 4 caratteri diversi';
  const local = (email?.split('@')[0] ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (local.length >= 4 && p.replace(/[^a-z0-9]/g, '').includes(local)) {
    return 'La password non deve contenere il tuo indirizzo email';
  }
  return null;
}

export const PasswordSchema = z
  .string()
  .min(PASSWORD_MIN, `La password deve avere almeno ${PASSWORD_MIN} caratteri`)
  .max(256, 'Password troppo lunga')
  .superRefine((v, ctx) => {
    const reason = weakPasswordReason(v);
    if (reason) ctx.addIssue({ code: 'custom', message: reason });
  });

export const EmailSchema = z.email('Email non valida').trim().toLowerCase().max(254);

export const RegisterSchema = z
  .object({
    email: EmailSchema,
    password: PasswordSchema,
    displayName: z.string().trim().min(1, 'Inserisci il tuo nome').max(120),
    acceptPrivacy: z.literal(true, { error: "Devi accettare l'informativa privacy" }),
  })
  .superRefine((v, ctx) => {
    const reason = weakPasswordReason(v.password, v.email);
    if (reason && !weakPasswordReason(v.password)) ctx.addIssue({ code: 'custom', path: ['password'], message: reason });
  });
export type RegisterInput = z.infer<typeof RegisterSchema>;

export const LoginSchema = z.object({
  email: EmailSchema,
  password: z.string().min(1, 'Inserisci la password').max(256),
});
export type LoginInput = z.infer<typeof LoginSchema>;

export const ForgotPasswordSchema = z.object({ email: EmailSchema });

export const ResetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  password: PasswordSchema,
});

export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: PasswordSchema,
});

export interface User {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
}

export const VerifyEmailSchema = z.object({ token: z.string().min(20).max(200) });

/** Registration when e-mail confirmation is on: no session until the link is opened. */
export interface RegisterPending {
  status: 'verification_sent';
}

export interface AuthResponse {
  accessToken: string;
  expiresIn: number;
  user: User;
}
