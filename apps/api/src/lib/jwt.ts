import { SignJWT, jwtVerify } from 'jose';

const ISSUER = 'cardvault';
/** Every token names what it is for: a capability link must never work as an API session. */
const ACCESS_AUDIENCE = 'api';

export interface AccessClaims {
  userId: string;
  /** issued-at, seconds */
  iat: number;
}

export class AccessTokens {
  private key: Uint8Array;
  constructor(
    secret: string,
    private ttlSeconds: number,
  ) {
    this.key = new TextEncoder().encode(secret);
  }

  sign(userId: string): Promise<string> {
    return new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuer(ISSUER)
      .setAudience(ACCESS_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${this.ttlSeconds}s`)
      .sign(this.key);
  }

  /** Claims of a valid API access token, or null for anything else (expired, other audience…). */
  async verify(token: string): Promise<AccessClaims | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, { issuer: ISSUER, audience: ACCESS_AUDIENCE, algorithms: ['HS256'] });
      return typeof payload.sub === 'string' && typeof payload.iat === 'number' ? { userId: payload.sub, iat: payload.iat } : null;
    } catch {
      return null;
    }
  }

  /** Short-lived capability URL token, e.g. to open a vCard by top-level navigation (iOS). */
  signScoped(userId: string, scope: string, resource: string, ttlSeconds: number): Promise<string> {
    if (scope === ACCESS_AUDIENCE) throw new Error('scope riservato');
    return new SignJWT({ scope, res: resource })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuer(ISSUER)
      .setAudience(scope)
      .setIssuedAt()
      .setExpirationTime(`${ttlSeconds}s`)
      .sign(this.key);
  }

  async verifyScoped(token: string, scope: string): Promise<{ userId: string; resource: string } | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, { issuer: ISSUER, audience: scope, algorithms: ['HS256'] });
      if (typeof payload.sub !== 'string' || typeof payload.res !== 'string') return null;
      return { userId: payload.sub, resource: payload.res };
    } catch {
      return null;
    }
  }

  get ttl() {
    return this.ttlSeconds;
  }
}
