import { loadConfig } from '../config';
import { migrate } from './migrate';
import { createPool } from './pool';

const config = loadConfig();
const db = createPool(config);
try {
  const applied = await migrate(db, console.log);
  console.log(applied.length ? `${applied.length} migrazioni applicate` : 'Database già aggiornato');
} finally {
  await db.end();
}
