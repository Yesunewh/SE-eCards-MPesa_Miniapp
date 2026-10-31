import type { Queryable } from '../db/pool.js';
import type { Ctx } from '../context.js';

export type JobHandler = (ctx: Ctx, payload: any) => Promise<void>;

/** Thrown by a handler to retry later without counting as an error (e.g. "still pending"). */
export class RetryLater extends Error {
  constructor(public delaySecs: number, message = 'retry later') { super(message); }
}

export async function enqueue(
  q: Queryable, type: string, payload: Record<string, unknown> = {},
  opts: { dedupeKey?: string; delaySecs?: number; maxAttempts?: number } = {}
): Promise<void> {
  await q.query(
    `INSERT INTO jobs (type, payload, dedupe_key, run_at, max_attempts)
     VALUES ($1, $2, $3, now() + make_interval(secs => $4), $5)
     ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL AND status = 'queued' DO NOTHING`,
    [type, payload, opts.dedupeKey ?? null, opts.delaySecs ?? 0, opts.maxAttempts ?? 8]
  );
}

/** Claims one ready job. Jobs sharing a dedupe key never run at the same time. */
async function claim(ctx: Ctx, types: string[]) {
  const r = await ctx.db.query(
    `UPDATE jobs SET status = 'running', locked_at = now(), attempts = attempts + 1
     WHERE id = (
       SELECT j.id FROM jobs j
       WHERE j.status = 'queued' AND j.run_at <= now() AND j.type = ANY($1)
         AND (j.dedupe_key IS NULL OR NOT EXISTS (
               SELECT 1 FROM jobs r WHERE r.status = 'running' AND r.dedupe_key = j.dedupe_key))
       ORDER BY j.run_at, j.id
       FOR UPDATE SKIP LOCKED LIMIT 1)
     RETURNING id, type, payload, attempts, max_attempts`,
    [types]
  );
  return r.rows[0] as { id: number; type: string; payload: any; attempts: number; max_attempts: number } | undefined;
}

/** Runs one job. Returns false when nothing was ready. */
export async function runOne(ctx: Ctx, handlers: Record<string, JobHandler>): Promise<boolean> {
  const job = await claim(ctx, Object.keys(handlers));
  if (!job) return false;
  try {
    await handlers[job.type]!(ctx, job.payload);
    await ctx.db.query(`UPDATE jobs SET status = 'done', locked_at = NULL WHERE id = $1`, [job.id]);
  } catch (e) {
    const err = e as Error;
    const later = e instanceof RetryLater;
    const dead = !later && job.attempts >= job.max_attempts;
    // exponential backoff: 5s, 10s, 20s … capped at 15 min
    const delay = later ? (e as RetryLater).delaySecs : Math.min(900, 5 * 2 ** (job.attempts - 1));
    await ctx.db.query(
      `UPDATE jobs SET status = $2, locked_at = NULL, last_error = $3,
              run_at = now() + make_interval(secs => $4),
              attempts = CASE WHEN $5 THEN attempts - 1 ELSE attempts END
       WHERE id = $1`,
      [job.id, dead ? 'dead' : 'queued', err.message.slice(0, 1000), delay, later]
    ).catch(async x => {
      // another job with the same dedupe key was queued meanwhile: this one can finish
      if ((x as any).code === '23505') await ctx.db.query(`UPDATE jobs SET status='done', locked_at=NULL, last_error=$2 WHERE id=$1`, [job.id, 'superseded']);
      else throw x;
    });
    if (!later) ctx.log(`job ${job.type}#${job.id} failed (attempt ${job.attempts}): ${err.message}`);
  }
  return true;
}

/** Runs ready jobs until none is left (tests and one-off scripts). */
export async function drain(ctx: Ctx, handlers: Record<string, JobHandler>, max = 500): Promise<number> {
  let n = 0;
  while (n < max && await runOne(ctx, handlers)) n++;
  return n;
}

/** Jobs left 'running' by a crashed process go back to the queue after 10 minutes. */
export async function releaseStuck(ctx: Ctx): Promise<number> {
  const r = await ctx.db.query(
    `UPDATE jobs SET status = 'queued', locked_at = NULL, last_error = 'released after crash'
     WHERE status = 'running' AND locked_at < now() - interval '10 minutes'
       AND NOT EXISTS (SELECT 1 FROM jobs q WHERE q.status = 'queued' AND q.dedupe_key = jobs.dedupe_key)`
  );
  return r.rowCount ?? 0;
}
