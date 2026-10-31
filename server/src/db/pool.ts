import pg from 'pg';

// BIGINT (int8) as JS number: our largest values (santim totals) stay far below 2^53.
pg.types.setTypeParser(20, v => Number(v));
// NUMERIC as number (rates, VAT)
pg.types.setTypeParser(1700, v => Number(v));
// DATE as plain 'YYYY-MM-DD' string, not a Date shifted by the server time zone
pg.types.setTypeParser(1082, v => v);

export type Db = pg.Pool;
export type Tx = pg.PoolClient;
export type Queryable = pg.Pool | pg.PoolClient;

export function createPool(connectionString: string): Db {
  return new pg.Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000 });
}

/** Runs fn in a transaction; rolls back on any error. */
export async function withTx<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const tx = await db.connect();
  try {
    await tx.query('BEGIN');
    const out = await fn(tx);
    await tx.query('COMMIT');
    return out;
  } catch (e) {
    await tx.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    tx.release();
  }
}

export async function one<T = any>(q: Queryable, sql: string, params: unknown[] = []): Promise<T> {
  const r = await q.query(sql, params);
  if (r.rows.length !== 1) throw new Error(`expected one row, got ${r.rows.length}`);
  return r.rows[0] as T;
}

export async function maybeOne<T = any>(q: Queryable, sql: string, params: unknown[] = []): Promise<T | null> {
  const r = await q.query(sql, params);
  return (r.rows[0] as T) ?? null;
}

export async function many<T = any>(q: Queryable, sql: string, params: unknown[] = []): Promise<T[]> {
  const r = await q.query(sql, params);
  return r.rows as T[];
}
