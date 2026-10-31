import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { Db } from './pool.js';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../migrations');

/** Applies every migrations/NNN_name.sql not yet applied, each in its own transaction. */
export async function migrate(db: Db, log: (m: string) => void = () => {}): Promise<string[]> {
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const client = await db.connect();
  const applied: string[] = [];
  try {
    // one migrator at a time, even with several app instances starting together
    await client.query('SELECT pg_advisory_lock(7231001)');
    const done = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map(r => r.name));
    const files = (await readdir(DIR)).filter(f => /^\d{3}_.+\.sql$/.test(f)).sort();
    for (const f of files) {
      if (done.has(f)) continue;
      const sql = await readFile(path.join(DIR, f), 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations(name) VALUES ($1)', [f]);
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw new Error(`migration ${f} failed: ${(e as Error).message}`);
      }
      applied.push(f);
      log(`applied ${f}`);
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(7231001)').catch(() => {});
    client.release();
  }
  return applied;
}

// CLI: npm run migrate
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { createPool } = await import('./pool.js');
  const url = process.env.DATABASE_URL;
  if (!url) { console.error('DATABASE_URL is not set'); process.exit(1); }
  const db = createPool(url);
  try {
    const applied = await migrate(db, m => console.log(m));
    console.log(applied.length ? `${applied.length} migration(s) applied` : 'database is up to date');
  } finally {
    await db.end();
  }
}
