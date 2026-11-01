/** A stand-in Wupex server that answers like the documented API, with scripted trouble for tests. */
import Fastify from 'fastify';
import { randomBytes } from 'node:crypto';

export type WupexMode = 'ok' | 'slow_after_charge' | 'slow_before_charge' | 'insufficient' | 'error500' | 'no_serials';

export interface FakeOrder { id: number; orderName: string; orderDate: string; orderAmount: number; lines: { sku: string; codes: string[] }[] }

export async function startFakeWupex(opts: { apiKey?: string; slowMs?: number } = {}) {
  const apiKey = opts.apiKey ?? 'test-key';
  const state = {
    balance: 5000,
    orders: [] as FakeOrder[],
    next: [] as WupexMode[],
    nextId: 100,
    products: ['NETFLIX-USA-50USD', 'NETFLIX-USA-100USD', 'STEAM-USA-50USD', 'PSN-USA-50USD', 'GOOGLE-USA-50USD', 'APPLE-USA-50USD',
               'XBOX-USA-50USD', 'SPOTIFY-USA-30USD', 'PUBG-GLOBAL-50USD', 'RAZER-GLOBAL-50USD', 'NETFLIX-TUR-50USD']
      .map((sku, i) => ({ productCode: sku, productName: sku.replace(/-/g, ' '), price: Number(sku.match(/(\d+)USD/)![1]), available: 50,
                          enabled: true, discountRate: 0.03, productType: sku.split('-')[0], limit: 0, redeemed: 0, imageUrl: `https://img/${i}` })),
    calls: [] as string[]
  };
  const app = Fastify();
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
  app.addHook('onRequest', async (req, reply) => {
    state.calls.push(`${req.method} ${req.url.split('?')[0]}`);
    if (req.headers['x-api-key'] !== apiKey) return reply.status(401).send({ status: false, error: { code: 'UNAUTHORIZED', message: 'Invalid API key' } });
    if (req.headers['accept-language'] !== 'en-US') return reply.status(400).send({ status: false, error: { code: 'BAD_REQUEST', message: 'Accept-Language missing' } });
  });

  app.get('/api/customer/balance', async () => ({ data: { balance: state.balance, credit: 0, creditBalance: state.balance }, status: true }));

  app.post('/api/product/merchant/invited/list', async req => {
    const { page = 1, pageSize = 20 } = (req.body ?? {}) as any;
    const all = state.products, size = Math.min(100, pageSize);
    return { pageInfo: { totalPage: Math.ceil(all.length / size), totalCount: all.length, pageSize: size, currentPage: page },
             data: all.slice((page - 1) * size, page * size), status: true };
  });

  app.post('/api/order/pull-codes', async (req, reply) => {
    const lines = req.body as Array<{ merchant: string; sku: string; quantity: number }>;
    const mode = state.next.shift() ?? 'ok';
    if (!Array.isArray(lines) || !lines.every(l => l.merchant && l.sku && l.quantity > 0)) return reply.status(400).send({ status: false, error: { code: 'BAD_REQUEST', message: 'invalid body' } });
    if (mode === 'error500') return reply.status(500).send({ status: false, error: { code: 'INTERNAL', message: 'boom' } });
    if (mode === 'insufficient') return reply.status(422).send({ status: false, error: { code: 'INSUFFICIENT_STOCK', message: 'Requested quantity not available.' } });
    if (mode === 'slow_before_charge') { await sleep(opts.slowMs ?? 800); return reply.status(504).send({}); }
    const total = lines.reduce((s, l) => s + Number(l.sku.match(/(\d+)USD/)![1]) * 0.97 * l.quantity, 0);
    const order: FakeOrder = {
      id: ++state.nextId, orderName: 'A' + String(state.nextId).padStart(14, '0'), orderDate: new Date().toISOString().slice(0, 19),
      orderAmount: Math.round(total * 100) / 100,
      lines: lines.map(l => ({ sku: l.sku, codes: Array.from({ length: l.quantity }, () => randomBytes(6).toString('hex').toUpperCase()) }))
    };
    state.orders.push(order); state.balance -= order.orderAmount;
    if (mode === 'slow_after_charge') await sleep(opts.slowMs ?? 800);   // the client gives up; the order exists anyway
    const serials = mode === 'no_serials' ? [] : order.lines.flatMap(l => l.codes.map(c => ({ sku: l.sku, serialCode: c, serialNumber: 'SN-' + c.slice(0, 4) })));
    return reply.status(201).send({ data: { orderName: order.orderName, totalAmount: order.orderAmount, serials }, status: true });
  });

  app.post('/api/order/list', async req => {
    const { page = 1, pageSize = 20 } = (req.body ?? {}) as any;
    const sorted = [...state.orders].sort((a, b) => b.id - a.id);
    return { pageInfo: { totalPage: Math.max(1, Math.ceil(sorted.length / pageSize)), totalCount: sorted.length, pageSize, currentPage: page },
             data: sorted.slice((page - 1) * pageSize, page * pageSize).map(({ lines: _l, ...o }) => o), status: true };
  });

  app.get('/api/order/detail', async (req, reply) => {
    const o = state.orders.find(x => x.orderName === (req.query as any).orderName);
    if (!o) return reply.status(404).send({ status: false, error: { code: 'NOT_FOUND', message: 'order not found' } });
    return { data: { id: o.id, orderName: o.orderName, orderDate: o.orderDate, orderAmount: o.orderAmount,
      orderData: o.lines.map((l, i) => ({ rowId: i + 1, productCode: l.sku, productName: l.sku,
        serials: l.codes.map(c => ({ serialNumber: 'SN-' + c.slice(0, 4), serialCode: c, productId: i + 1, productName: l.sku, productSku: l.sku })) })) },
      status: true };
  });

  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address() as { port: number };
  return { url: `http://127.0.0.1:${addr.port}`, apiKey, state, close: () => app.close() };
}
