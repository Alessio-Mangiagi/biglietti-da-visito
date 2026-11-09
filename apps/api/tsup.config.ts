import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts', 'src/db/migrate-cli.ts', 'src/vercel.ts'],
  format: 'esm',
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  clean: true,
  // workspace packages are TS sources: bundle them; real npm deps stay external
  noExternal: [/^@cardvault\//],
  publicDir: false,
  onSuccess: 'node scripts/copy-migrations.mjs',
});
