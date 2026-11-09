/**
 * Vercel Function entry: the whole Fastify app behind /api/*, on the same domain as the PWA.
 * The instance (pool, migrations) is created once per warm container.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app';
import { loadConfig } from './config';
import { migrate } from './db/migrate';
import { createPool } from './db/pool';

let ready: Promise<FastifyInstance> | null = null;

async function init(): Promise<FastifyInstance> {
  const config = loadConfig();
  // serverless: many short-lived instances, keep few connections each
  const db = createPool({ ...config, DATABASE_POOL_MAX: Math.min(config.DATABASE_POOL_MAX, 3) });
  if (process.env.AUTO_MIGRATE !== 'false') await migrate(db);
  const app = await buildApp(config, db);
  await app.ready();
  return app;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  ready ??= init().catch((err) => {
    ready = null; // retry on the next request instead of caching the failure
    throw err;
  });
  try {
    const app = await ready;
    app.server.emit('request', req, res);
  } catch (err) {
    console.error('CardVault API non avviata:', err);
    res.statusCode = 503;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ statusCode: 503, code: 'NOT_CONFIGURED', message: 'Servizio non configurato: database o variabili mancanti.' }));
  }
}
