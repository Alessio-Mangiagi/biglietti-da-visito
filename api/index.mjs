// Vercel Function: every /api/* request is rewritten here (see vercel.json).
// The Fastify app is pre-bundled by `pnpm --filter @cardvault/api build`.
export { default } from '../apps/api/dist/vercel.js';
