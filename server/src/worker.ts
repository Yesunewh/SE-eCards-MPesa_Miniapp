import type { Ctx } from './context.js';
import type { JobHandler } from './services/jobs.js';
import { drain, enqueue, releaseStuck, runOne } from './services/jobs.js';
import { fulfilOrder, reconcileProviderOrder, retryWaitingJob } from './services/fulfilment.js';
import { checkPaymentJob, expireOrdersJob } from './services/payments.js';
import { sendNotificationJob } from './services/notifications.js';

export const HANDLERS: Record<string, JobHandler> = {
  fulfil_order: async (ctx, p) => { await fulfilOrder(ctx, p.orderId); },
  reconcile_provider_order: reconcileProviderOrder,
  check_payment: checkPaymentJob,
  send_notification: sendNotificationJob,
  expire_orders: async ctx => { await expireOrdersJob(ctx); },
  retry_waiting: async ctx => { await retryWaitingJob(ctx); }
};

/** Runs queued jobs until there are none (tests). */
export const drainJobs = (ctx: Ctx) => drain(ctx, HANDLERS);

/** Background loop: polls the jobs table and schedules the periodic jobs. Returns a stop function. */
export function startWorker(ctx: Ctx, opts: { pollMs?: number } = {}): () => Promise<void> {
  let stopped = false;
  let tick = 0;
  const loop = (async () => {
    while (!stopped) {
      try {
        if (tick % 60 === 0) {   // about once a minute
          await enqueue(ctx.db, 'expire_orders', {}, { dedupeKey: 'expire_orders' });
          await releaseStuck(ctx);
        }
        if (tick % 300 === 0) await enqueue(ctx.db, 'retry_waiting', {}, { dedupeKey: 'retry_waiting' });
        tick++;
        let n = 0;
        while (!stopped && n < 50 && await runOne(ctx, HANDLERS)) n++;
      } catch (e) {
        ctx.log(`worker error: ${(e as Error).message}`);
      }
      await new Promise(r => setTimeout(r, opts.pollMs ?? 1000));
    }
  })();
  return async () => { stopped = true; await loop; };
}
