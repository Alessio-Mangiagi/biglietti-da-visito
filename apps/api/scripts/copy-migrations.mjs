import { cpSync } from 'node:fs';
cpSync('src/db/migrations', 'dist/migrations', { recursive: true });
