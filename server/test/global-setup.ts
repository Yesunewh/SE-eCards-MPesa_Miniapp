import pg from 'pg';
import { createPool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';

/** Fresh schema once per test run. */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? 'postgres://ecards:ecards@localhost:5432/ecards_test';
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  await c.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await c.end();
  const db = createPool(url);
  await migrate(db);
  await db.end();
}
