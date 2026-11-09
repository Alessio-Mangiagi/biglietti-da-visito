import { hash, verify } from '@node-rs/argon2';

// OWASP 2024 baseline for Argon2id: m=19 MiB, t=2, p=1
const OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (password: string) => hash(password, OPTIONS);

export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  try {
    return await verify(stored, password);
  } catch {
    return false;
  }
}

/** Hash computed once and verified against when the e-mail is unknown, so timing does not leak it. */
let dummy: Promise<string> | undefined;
export async function burnPasswordCheck(password: string): Promise<void> {
  dummy ??= hashPassword('cardvault-timing-equaliser');
  await verifyPassword(await dummy, password);
}
