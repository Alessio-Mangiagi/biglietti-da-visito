import { z } from 'zod';

export const PASSWORD_MIN = 10;

export const PasswordSchema = z
  .string()
  .min(PASSWORD_MIN, `La password deve avere almeno ${PASSWORD_MIN} caratteri`)
  .max(256, 'Password troppo lunga');

export const EmailSchema = z.email('Email non valida').trim().toLowerCase().max(254);

export const RegisterSchema = z.object({
  email: EmailSchema,
  password: PasswordSchema,
  displayName: z.string().trim().min(1, 'Inserisci il tuo nome').max(120),
  acceptPrivacy: z.literal(true, { error: "Devi accettare l'informativa privacy" }),
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

export interface AuthResponse {
  accessToken: string;
  expiresIn: number;
  user: User;
}
