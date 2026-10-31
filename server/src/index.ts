import { loadConfig } from './config.js';
import { createContext } from './context.js';
import { migrate } from './db/migrate.js';
import { buildApp } from './http/app.js';
import { startWorker } from './worker.js';

const cfg = loadConfig();
const ctx = createContext(cfg);

await migrate(ctx.db, m => ctx.log(m));
const app = await buildApp(ctx);
const stopWorker = cfg.runWorker ? startWorker(ctx) : null;

await app.listen({ port: cfg.PORT, host: cfg.HOST });
ctx.log(`eCards API on :${cfg.PORT} · payments=${ctx.payments.name} · giftcards=${cfg.GIFTCARD_ADAPTER} · worker=${cfg.runWorker}`);

const shutdown = async (sig: string) => {
  ctx.log(`${sig}: shutting down`);
  await app.close();
  if (stopWorker) await stopWorker();
  await ctx.db.end();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
