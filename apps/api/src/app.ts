import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { ZodError, type ZodType } from 'zod';
import type { Config } from './config';
import type { Db } from './db/pool';
import { HttpError, unauthorized } from './lib/errors';
import { AccessTokens } from './lib/jwt';
import { createMailer, type Mailer } from './lib/mailer';
import { accountRoutes } from './routes/account';
import { authRoutes } from './routes/auth';
import { contactRoutes } from './routes/contacts';
import { imageRoutes } from './routes/images';
import { transferRoutes } from './routes/transfer';

declare module 'fastify' {
  interface FastifyRequest {
    userId: string;
  }
  interface FastifyInstance {
    deps: Deps;
    authenticate: (req: FastifyRequest) => Promise<void>;
  }
}

export interface Deps {
  config: Config;
  db: Db;
  tokens: AccessTokens;
  mailer: Mailer;
}

export function parse<T>(schema: ZodType<T>, data: unknown): T {
  return schema.parse(data);
}

export const IMAGE_TYPES = ['image/jpeg', 'image/webp', 'image/png'] as const;

export async function buildApp(
  config: Config,
  db: Db,
  opts: { mailer?: Mailer; logger?: boolean; rateLimit?: boolean } = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      opts.logger === false
        ? false
        : {
            level: config.LOG_LEVEL,
            redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
            ...(config.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : {}),
          },
    trustProxy: config.TRUST_PROXY,
    bodyLimit: 256 * 1024,
  });

  const deps: Deps = {
    config,
    db,
    tokens: new AccessTokens(config.JWT_SECRET, config.ACCESS_TOKEN_TTL),
    mailer: opts.mailer ?? createMailer(config.SMTP_URL, config.MAIL_FROM, app.log),
  };
  app.decorate('deps', deps);
  app.decorateRequest('userId', '');

  await app.register(helmet, {
    // JSON API: no HTML is served, lock everything down
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: 'same-site' },
  });
  await app.register(cors, {
    origin: config.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    maxAge: 600,
  });
  await app.register(cookie);
  if (opts.rateLimit !== false) await app.register(rateLimit, {
    max: 300,
    timeWindow: '1 minute',
    keyGenerator: (req) => req.ip,
    errorResponseBuilder: (_req, ctx) => ({
      statusCode: 429,
      code: 'RATE_LIMITED',
      error: 'Too Many Requests',
      message: `Troppe richieste. Riprova tra ${Math.ceil(ctx.ttl / 1000)} secondi.`,
    }),
  });

  // raw image uploads (PUT /contacts/:id/images/:side) and vCard imports
  app.addContentTypeParser([...IMAGE_TYPES], { parseAs: 'buffer', bodyLimit: config.MAX_IMAGE_BYTES }, (_req, body, done) =>
    done(null, body),
  );
  app.addContentTypeParser(['text/vcard', 'text/x-vcard', 'text/directory'], { parseAs: 'string', bodyLimit: 5 * 1024 * 1024 }, (_req, body, done) =>
    done(null, body),
  );

  app.decorate('authenticate', async (req: FastifyRequest) => {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    const userId = token ? await deps.tokens.verify(token) : null;
    if (!userId) throw unauthorized('Sessione scaduta');
    req.userId = userId;
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      return reply.status(400).send({
        statusCode: 400,
        code: 'VALIDATION',
        message: err.issues[0]?.message ?? 'Dati non validi',
        issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    if (err instanceof HttpError) {
      return reply.status(err.statusCode).send({ statusCode: err.statusCode, code: err.code, message: err.message });
    }
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) req.log.error(err);
    const message =
      status === 413 ? 'File troppo grande' : status === 415 ? 'Formato non supportato' : status < 500 ? (err as Error).message : 'Errore interno del server';
    return reply.status(status).send({ statusCode: status, code: (err as { code?: string }).code, message });
  });

  app.get('/api/health', { config: { rateLimit: false } }, async () => {
    await db.query('SELECT 1');
    return { ok: true };
  });

  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(async (scoped) => {
    scoped.addHook('onRequest', scoped.authenticate);
    await scoped.register(contactRoutes);
    await scoped.register(imageRoutes);
    await scoped.register(transferRoutes);
    await scoped.register(accountRoutes);
  }, { prefix: '/api' });

  return app;
}
