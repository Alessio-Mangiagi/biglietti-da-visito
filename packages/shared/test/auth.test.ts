import { describe, expect, it } from 'vitest';
import { PasswordSchema, RegisterSchema, weakPasswordReason } from '../src';

describe('password policy', () => {
  it.each(['10101010', 'aaaaaaaa', 'abcabcabc', '12345678', '87654321', 'abcdefgh', 'Password1', 'qwertyuiop', '11223311'])(
    'rejects %s',
    (pw) => expect(weakPasswordReason(pw)).not.toBeNull(),
  );

  it.each(['Cantiere-Etna26', 'mela verde lunga', 'xK9#p2Lm', 'nexora2026!'])('accepts %s', (pw) => {
    expect(weakPasswordReason(pw)).toBeNull();
    expect(PasswordSchema.safeParse(pw).success).toBe(true);
  });

  it('requires at least 8 characters', () => {
    expect(PasswordSchema.safeParse('xK9#p2L').success).toBe(false);
  });

  it('rejects passwords containing the e-mail name', () => {
    const r = RegisterSchema.safeParse({ email: 'a.mangiagi@nexora.srl', password: 'Amangiagi!7', displayName: 'A', acceptPrivacy: true });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(['password']);
  });
});
