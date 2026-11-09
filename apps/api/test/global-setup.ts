import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import type { TestProject } from 'vitest/node';

let pg: EmbeddedPostgres | undefined;
let dir: string | undefined;

export async function setup(project: TestProject) {
  if (process.env.TEST_DATABASE_URL) {
    project.provide('databaseUrl', process.env.TEST_DATABASE_URL);
    return;
  }
  dir = mkdtempSync(join(tmpdir(), 'cardvault-pg-'));
  const port = 54_000 + Math.floor(Math.random() * 1000);
  pg = new EmbeddedPostgres({ databaseDir: dir, user: 'test', password: 'test', port, persistent: false });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('cardvault_test');
  project.provide('databaseUrl', `postgres://test:test@127.0.0.1:${port}/cardvault_test`);
}

export async function teardown() {
  await pg?.stop();
  if (dir) rmSync(dir, { recursive: true, force: true });
}

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}
